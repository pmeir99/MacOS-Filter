"""Measure packaged Vision's people-only decisions against COCO128-seg person polygons."""
import base64
from collections import Counter
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import statistics
import struct
import subprocess
import sys
import time
from zipfile import ZipFile
from PIL import Image, ImageChops, ImageDraw

host, archive = sys.argv[1:]
counts = Counter()
elapsed, warm = [], []
missed, extra = [], []
intersection = union = relevant = predicted = 0

def infer(process, data, request_id):
    request = dict(protocolVersion=1, action="segment", modeOverride="peopleOnly",
                   requestID=request_id, imageData=base64.b64encode(data).decode())
    body = json.dumps(request).encode()
    start = time.perf_counter()
    process.stdin.write(struct.pack("<I",len(body)) + body)
    process.stdin.flush()
    length, = struct.unpack("<I",process.stdout.read(4))
    result = json.loads(process.stdout.read(length))
    ms = (time.perf_counter()-start)*1000
    assert result.get("ok") and result["requestID"]==request_id, result.get("error")
    return result, ms

def foreground(mask):
    return mask.histogram()[255]

with ZipFile(archive) as dataset, subprocess.Popen(
        [host,"chrome-extension://"+"a"*32+"/"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
    files = set(dataset.namelist())
    images = sorted(name for name in files if "/images/" in name and name.endswith(".jpg") and "__MACOSX/" not in name)
    assert len(images)==128, len(images)
    for name in images:
        label = name.replace("/images/","/labels/")[:-4]+".txt"
        data = dataset.read(name)
        with Image.open(BytesIO(data)) as photo:
            size = photo.size
        truth = Image.new("L",size)
        lines = dataset.read(label).decode().splitlines() if label in files else []
        for line in lines:
            fields=line.split()
            if not fields or fields[0]!="0": continue
            points=list(map(float,fields[1:]))
            assert len(points)>=6 and len(points)%2==0
            coords=[(x*size[0],y*size[1]) for x,y in zip(points[::2],points[1::2])]
            ImageDraw.Draw(truth).polygon(coords,fill=255)
        image_id = PurePosixPath(name).stem
        answer, ms = infer(process,data,image_id)
        elapsed.append(ms)
        found = answer["personDetected"]
        actual = bool(truth.getbbox())
        counts[(actual,found)]+=1
        if actual and not found: missed.append(image_id)
        if found and not actual: extra.append(image_id)
        detected = Image.new("L",size)
        if found:
            detected=Image.open(BytesIO(base64.b64decode(answer["maskData"]))).convert("RGBA").getchannel("A")
            detected=detected.resize(size,Image.Resampling.BILINEAR).point(lambda x:255 if x>=128 else 0)
        intersection+=foreground(ImageChops.darker(truth,detected))
        union+=foreground(ImageChops.lighter(truth,detected))
        relevant+=foreground(truth)
        predicted+=foreground(detected)
        again,ms=infer(process,data,image_id+"-repeat")
        assert again.get("maskData")==answer.get("maskData") and again["personDetected"]==found
        warm.append(ms)
    process.stdin.close()
    process.wait(timeout=20)
summary = dict(images=len(images),true_positive=counts[True,True],true_negative=counts[False,False],
               false_positive=extra,false_negative=missed,foreground_iou=round(intersection/max(1,union),3),
               foreground_precision=round(intersection/max(1,predicted),3),foreground_recall=round(intersection/max(1,relevant),3),
               native_uncached_ms_p50=round(statistics.median(elapsed),1),native_uncached_ms_p95=round(sorted(elapsed)[121],1),
               native_cached_ms_p50=round(statistics.median(warm),1))
print("COCO128-seg benchmark",json.dumps(summary),flush=True)
Path("silhouette-benchmark.json").write_text(json.dumps(summary,indent=2)+"\n")
assert relevant and predicted and counts[True,True] and counts[False,False], "Missing meaningful benchmark coverage"
