"""Run python3 filter-check.py and open the printed URL in Chrome. Ctrl+C stops it."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import struct
import zlib

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

def picture():
    row = b"\0" + bytes([242,143,61])*100 + bytes([60,150,120])*100
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B",200,100,8,2,0,0,0))
            + chunk(b"IDAT",zlib.compress(row*100)) + chunk(b"IEND",b""))

PAGE = """<!doctype html><meta charset="utf-8"><title>MacOS Filter check</title>
<style>body{font:16px system-ui;max-width:780px;margin:2em auto;padding:0 16px}figure{position:relative;width:200px;height:100px;overflow:hidden;border-radius:16px;margin:0}img{display:block;width:100%;height:100%;object-fit:cover}figure button{position:absolute;top:8px;right:8px}td{padding:5px}input,select,button{font:inherit}input{max-width:100%}</style>
<h1>MacOS Filter check</h1><figure><img src="/photo.png" alt="qa sample product"><button id="save">Save</button></figure>
<p>Sample text: garden <strong>lantern</strong>. Control text: garden path.</p>
<button id="recycle">Remove and reinsert image</button>
<label>Choose a local portrait <input type="file" id="file" accept="image/png,image/jpeg"></label>
<p id="info"></p><h2>Test results</h2><p>Set the indicated mode in the app or extension. Save website rules and reload this page after changes.</p>
<table><tbody id="rows"></tbody></table><button id="export">Download results</button>
<script>
const cases=[
["1. Baseline","Filtering off. Both colors and the Save button appear."],
["2. Whole cover","Entire image, solid, black, 100%. Colors disappear, corners stay rounded, Save still responds."],
["3. Recycling","Press Remove and reinsert. The image should still be covered."],
["4. Text","Add garden lantern as a global phrase. The split phrase is covered; garden path stays visible."],
["5. Face","Choose Faces and a local portrait. The face should be covered. Log missed or extra areas."],
["6. People","Choose All detected people. Reselect the same portrait after reloading. Check each person and the background."],
["7. Page opening","Try placeholders and then loading screen. Reload after each change. Check for flashes and layout movement."],
["8. Site override","With global Faces, add 127.0.0.1 as Entire image. Reload and reselect the portrait. Expect full cover."],
["9. Restart","Record your settings, quit the Mac app and Chrome, reopen both. Verify settings, extension ID, rules and filtering."],
["10. Restore","Turn the extension off. Reload. Remove any QA rules. Check the original image and text return."]];
const results=JSON.parse(localStorage.getItem("qa-results")||"{}");
for(const [id,instruction] of cases){
 const tr=rows.insertRow();tr.insertCell().textContent=id+" — "+instruction;
 const select=document.createElement("select"),note=document.createElement("input");
 for(const name of ["Untested","Pass","Fail","Intermittent","Blocked"])select.add(new Option(name));
 select.value=results[id]?.status||"Untested";note.placeholder="Expected / actual / frequency";note.value=results[id]?.note||"";
 tr.insertCell().append(select);tr.insertCell().append(note);
 function save(){results[id]={status:select.value,note:note.value};localStorage.setItem("qa-results",JSON.stringify(results))}
 select.onchange=save;note.oninput=save;
}
document.getElementById("save").onclick=()=>info.textContent="Save button responded.";
recycle.onclick=()=>{const img=document.querySelector("img"),p=img.parentNode;img.remove();setTimeout(()=>p.prepend(img),200)};
file.onchange=()=>{if(file.files[0])document.querySelector("img").src=URL.createObjectURL(file.files[0])};
document.getElementById("export").onclick=()=>{const a=document.createElement("a");a.download="filter-check.json";a.href=URL.createObjectURL(new Blob([JSON.stringify({testedAt:new Date().toISOString(),referenceBuild:"c28cc7d",browser:navigator.userAgent,results},null,2)]));a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
</script>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/","/photo.png"):
            self.send_error(404)
            return
        photo = self.path == "/photo.png"
        data = picture() if photo else PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type","image/png" if photo else "text/html; charset=utf-8")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    with HTTPServer(("127.0.0.1",8765),Handler) as server:
        print("Open http://127.0.0.1:8765 in Chrome. Keep this Terminal open.",flush=True)
        server.serve_forever()
