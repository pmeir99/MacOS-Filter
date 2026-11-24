"""Check actual framed host responses on scikit-image's NASA astronaut portrait."""
import base64
import io
import json
import struct
import subprocess
import sys
from pathlib import Path
from PIL import Image

photo = base64.b64encode(Path(sys.argv[2]).read_bytes()).decode()
host = subprocess.Popen([sys.argv[1], "chrome-extension://" + "a"*32 + "/"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

def request(mode, ident):
    body = json.dumps(dict(protocolVersion=1, action="segment", requestID=ident,
                           imageData=photo, modeOverride=mode)).encode()
    host.stdin.write(struct.pack("<I",len(body)) + body)
    host.stdin.flush()
    size, = struct.unpack("<I",host.stdout.read(4))
    response = json.loads(host.stdout.read(size))
    assert response["ok"] and response["requestID"] == ident, response.get("error")
    return response

try:
    for mode in ("faces","allPeople"):
        first = request(mode,mode)
        mask = Image.open(io.BytesIO(base64.b64decode(first["maskData"]))).convert("RGBA")
        alpha = mask.getchannel("A").resize((512,512))
        assert alpha.getpixel((222,110)) > 140, (mode,"missed face center")
        assert alpha.getpixel((500,5)) < 100, (mode,"covered background")
        if mode == "faces":
            assert alpha.getpixel((175,300)) < 100, "Face mode covered torso"
        repeat = request(mode,mode+"-repeat")
        assert repeat["maskData"] == first["maskData"]
    assert request("entireImage","full")["coverWholeImage"]
finally:
    host.stdin.close()
    host.wait(timeout=15)
