"""Compare the packaged native runtime with the build-time reference on the same real pixels."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

app, portrait = map(Path, sys.argv[1:])
models = app/"Contents/Resources/PolicyModels"
photo = base64.b64encode(portrait.read_bytes()).decode()
cases = [
    {"mode":"skin", "includeFace":True},
    {"mode":"skin", "includeFace":False},
    {"mode":"policy", "fullLevel":7, "maskLevel":7},
    {"mode":"policy", "fullLevel":1, "maskLevel":7},
]
payload = "".join(json.dumps({"imageData":photo,"boxes":[[0,0,1,1]],"settings":s})+"\n" for s in cases)

def evaluate(command):
    response = subprocess.run(command+[str(models)],input=payload,text=True,capture_output=True,timeout=120,check=True)
    rows=[json.loads(line) for line in response.stdout.splitlines()]
    assert len(rows)==len(cases)
    return rows

def alpha(row):
    img=Image.open(io.BytesIO(base64.b64decode(row["mask"]))).convert("RGBA")
    return np.asarray(img)[:,:,3] >= 128

native=evaluate([str(app/"Contents/MacOS/PolicyWorker")])
reference=evaluate([sys.executable,"scripts/policy-worker.py"])
for case,got,want in zip(cases,native,reference):
    assert bool(got.get("full"))==bool(want.get("full")), (case,got.keys(),want.keys())
    if got.get("full"):
        continue
    a,b=alpha(got),alpha(want)
    intersection,union=np.logical_and(a,b).sum(),np.logical_or(a,b).sum()
    overlap=intersection/union if union else 1.0
    print("Photograph mask IoU",case,round(overlap,3),flush=True)
    assert overlap>=0.75,(case,overlap)
