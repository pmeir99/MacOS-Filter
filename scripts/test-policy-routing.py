"""Deterministic checks of policy routing, independent of model accuracy."""
import base64, importlib.util, io, sys
from pathlib import Path
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location("worker",Path(__file__).with_name("policy-worker.py"))
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
image=Image.new("RGB",(32,16),"gray")
buf=io.BytesIO()
image.save(buf,format="PNG")
req={"imageData":base64.b64encode(buf.getvalue()).decode(),
     "boxes":[[0,0,1,1]],"settings":{"mode":"policy","fullLevel":2,"maskLevel":5}}
v=np.zeros(13)
worker.scores=lambda image:v
worker.region=lambda image,skin,face:Image.new("L",image.size,255)
def result():
    item=worker.analyze(req)
    if item.get("full"): return "block"
    alpha=Image.open(io.BytesIO(base64.b64decode(item["mask"]))).getchannel("A")
    return "mask" if alpha.getbbox() else "clear"

for level in range(1,8):
    v[:]=0;v[level-1]=1
    assert result()==("block" if level<=2 else "mask" if level<=5 else "clear")
for target,own,other in (("masculine",7,8),("feminine",8,7)):
    req["settings"]["appearance"]=target
    v[:]=0;v[3]=1;v[own]=1
    assert result()=="mask"
    v[own]=0;v[other]=1
    assert result()=="clear"
    v[other]=0
    assert result()=="mask"
    v[0]=2;v[other]=1
    assert result()=="block"
for i,name in enumerate(("underwear","adult","menstrual")):
    v[:]=0;v[6]=1;v[i+9]=1
    req["settings"]["products"]=[name]
    assert result()=="block"
    req["settings"]["products"]=[]
    assert result()=="clear"
print("Seven levels, both presentation targets, uncertainty, full-block precedence and three product families passed.")
