"""Local inference over stdin/stdout. Model files are shipped in the app."""
import base64, io, json, sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, ImageFilter, ImageChops

root = Path(sys.argv[1])
bank = np.load(root/"prompts.npy",allow_pickle=False)
options = ort.SessionOptions()
options.intra_op_num_threads = 3
sessions = {}
def model(name):
    if name not in sessions:
        sessions[name] = ort.InferenceSession(str(root/(name+".onnx")),options,providers=["CPUExecutionProvider"])
    return sessions[name]

def scores(image):
    frame = ImageOps.fit(image,(224,224),method=Image.Resampling.BICUBIC)
    pixels = np.asarray(frame,dtype=np.float32)/255
    pixels = (pixels - np.array([.48145466,.4578275,.40821073],np.float32))/np.array([.26862954,.26130258,.27577711],np.float32)
    session = model("vision")
    v = session.run(["image_embeds"],{session.get_inputs()[0].name:pixels.transpose(2,0,1)[None]})[0].reshape(-1)
    result = bank @ (v / np.linalg.norm(v))
    if not np.isfinite(result).all(): raise ValueError("invalid embedding")
    return result

def region(image,skin,face):
    session = model("skin")
    x=np.asarray(image.resize((256,256),Image.Resampling.BILINEAR),dtype=np.float32)[None]/255
    logits=session.run(None,{session.get_inputs()[0].name:x})[0]
    if logits.shape!=(1,256,256,6) or not np.isfinite(logits).all(): raise ValueError("invalid segmentation")
    labels=logits[0].argmax(-1)
    keep=((labels==2) | ((labels==3) & face)) if skin else labels!=0
    return Image.fromarray(keep.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(3)).resize(image.size,Image.Resampling.BILINEAR)

def analyze(req):
    image=ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(req["imageData"],validate=True)))).convert("RGB")
    image.thumbnail((768,768))
    width,height=image.size
    boxes=req.get("boxes",[])
    if len(boxes)>12: return {"full":True}
    policy=req["settings"]
    mode=policy["mode"]
    products=policy.get("products") or []
    scene=scores(image) if products else None
    if products:
        rank=int(np.argmax(scene[9:13]))
        if rank<3 and ["underwear","adult","menstrual"][rank] in products:
            return {"full":True}
    mask=Image.new("L",image.size)
    levels=[]
    for coords in boxes or [[0,0,1,1]]:
        x,y,w,h=coords
        box=(max(0,int(x*width)),max(0,int(y*height)),min(width,int(np.ceil((x+w)*width))),min(height,int(np.ceil((y+h)*height))))
        crop=image.crop(box)
        target=policy.get("appearance") or "all"
        if mode=="policy" or target!="all":
            score=scene if scene is not None and crop.size==image.size else scores(crop)
            level=int(np.argmax(score[:7]))+1
            levels.append(level)
            if mode=="policy" and level<=int(policy.get("fullLevel") or 2): return {"full":True,"levels":levels}
            # Uncertain presentation stays covered under either selection.
            delta=float(score[7]-score[8])
            if target=="masculine" and delta < -0.025: continue
            if target=="feminine" and delta > 0.025: continue
            if mode=="policy" and level>int(policy.get("maskLevel") or 5): continue
        piece=region(crop,mode=="skin" or policy.get("paintSkin",False),policy.get("includeFace",True))
        if not piece.getbbox() and boxes: return {"full":True}
        mask.paste(ImageChops.lighter(mask.crop(box),piece),box)
    rgba=Image.new("RGBA",image.size,"white")
    rgba.putalpha(mask)
    out=io.BytesIO()
    rgba.save(out,format="PNG")
    return {"mask":base64.b64encode(out.getvalue()).decode(),"levels":levels}

for line in sys.stdin.buffer:
    try: reply=analyze(json.loads(line))
    except Exception: reply={"error":"local policy analysis failed"}
    print(json.dumps(reply,separators=(",",":")),flush=True)
