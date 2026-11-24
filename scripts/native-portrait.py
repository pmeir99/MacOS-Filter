"""Check actual framed host responses on scikit-image's NASA astronaut portrait."""
import base64
import io
import json
import struct
import subprocess
import sys
import time
import statistics
import resource
from pathlib import Path
from PIL import Image

photo = base64.b64encode(Path(sys.argv[2]).read_bytes()).decode()
host = subprocess.Popen([sys.argv[1], "chrome-extension://" + "a"*32 + "/"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

def request(mode, ident, settings=None):
    payload = dict(protocolVersion=1, action="segment", requestID=ident, imageData=photo, modeOverride=mode)
    if settings is not None:
        payload.update(action="segmentWithPolicy", settings=settings)
        del payload["modeOverride"]
    body = json.dumps(payload).encode()
    host.stdin.write(struct.pack("<I",len(body)) + body)
    host.stdin.flush()
    size, = struct.unpack("<I",host.stdout.read(4))
    response = json.loads(host.stdout.read(size))
    assert response["ok"] and response["requestID"] == ident, response.get("error")
    return response

try:
    for mode in ("faces","allPeople"):
        start = time.perf_counter()
        first = request(mode,mode)
        uncached_ms = (time.perf_counter()-start)*1000
        mask = Image.open(io.BytesIO(base64.b64decode(first["maskData"]))).convert("RGBA")
        alpha = mask.getchannel("A").resize((512,512))
        assert alpha.getpixel((222,110)) > 140, (mode,"missed face center")
        assert alpha.getpixel((500,5)) < 100, (mode,"covered background")
        if mode == "faces":
            assert alpha.getpixel((175,300)) < 100, "Face mode covered torso"
        warm_ms = []
        for iteration in range(10):
            start = time.perf_counter()
            repeat = request(mode,mode+str(iteration))
            warm_ms.append((time.perf_counter()-start)*1000)
            assert repeat["maskData"] == first["maskData"]
        print(f"{mode}: first {uncached_ms:.1f} ms, cached median {statistics.median(warm_ms):.1f} ms",flush=True)
    assert request("entireImage","full")["coverWholeImage"]
finally:
    host.stdin.close()
    host.wait(timeout=15)
    print(f'Peak child RSS {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1048576:.1f} MiB')

# Exercise the production worker through the packaged host and verify both
# positive and negative pixels on the same photographed face.
host = subprocess.Popen([sys.argv[1], "chrome-extension://" + "a"*32 + "/"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
try:
    browser = dict(enabled=True, mode="skin", overlayStyle="solid", overlayColor="#123456", opacity=1, includeFace=True)
    skin = request("skin","skin",browser)
    alpha = Image.open(io.BytesIO(base64.b64decode(skin["maskData"]))).convert("RGBA").getchannel("A").resize((512,512))
    assert alpha.getpixel((220,108)) > 80, "skin provider missed portrait face"
    assert alpha.getpixel((500,5)) < 80, "skin provider masked background"
    browser["includeFace"] = False
    without_face = request("skin","no-face",browser)
    other = Image.open(io.BytesIO(base64.b64decode(without_face["maskData"]))).convert("RGBA").getchannel("A").resize((512,512))
    assert other.getpixel((220,108)) < 80, "Browser setting to exclude facial skin was ignored"
    browser.update(mode="policy", blockThreshold=0.95, fullLevel=7)
    decision = request("policy","levels",browser)
    assert decision.get("coverWholeImage"), "Browser whole-image cutoff was ignored"
    assert decision.get("maskData") or decision.get("coverWholeImage")
finally:
    host.stdin.close()
    host.wait(timeout=30)
