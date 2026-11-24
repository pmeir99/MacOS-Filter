import os, shutil, tempfile, threading, json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

from PIL import Image, ImageChops
from io import BytesIO
import base64

photo = Image.new("RGB",(160,90),"#ff8833")
encoded = BytesIO()
photo.save(encoded,format="PNG")
photo_url = "data:image/png;base64," + base64.b64encode(encoded.getvalue()).decode()
fixture = """<!doctype html><meta charset=utf-8><style>
body{margin:30px;background:#eef1f5;font:18px system-ui}main{display:grid;grid-template-columns:180px 1fr;gap:18px}
figure{position:relative;margin:0;width:120px;height:60px;border-radius:14px;overflow:hidden;transform:translateX(8px)}
img{display:block;width:120px;height:60px;object-fit:cover}
button{position:absolute;top:6px;right:6px;background:white;color:black;border:0;z-index:1}
</style><main><figure><img src="PHOTO"><button>Save</button></figure><aside>Product details</aside></main><p>example phrase</p>""".replace("PHOTO",photo_url)
output = Path("layout-comparison")
output.mkdir(exist_ok=True)

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(fixture.encode())

server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
threading.Thread(target=server.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
    extension = Path(tmp) / "extension"
    shutil.copytree("extension", extension)
    # Exercise the post-permission state using an isolated, pre-granted test manifest.
    manifest = extension / "manifest.json"
    cfg = json.loads(manifest.read_text())
    cfg["host_permissions"] = cfg.pop("optional_host_permissions")
    manifest.write_text(json.dumps(cfg))
    ctx = pw.chromium.launch_persistent_context(str(Path(tmp) / "profile"), channel="chromium",
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"])
    worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    page = ctx.new_page()
    base = worker.url.rsplit("/", 1)[0]
    page.goto(base + "/rules.html")
    page.locator("#phrases").fill("example phrase")
    page.locator("#blocked").fill("localhost")
    page.locator("button").click()
    page.wait_for_function("document.querySelector('output').value.startsWith('Saved')")
    def enable(value):
        result = page.evaluate("value => chrome.runtime.sendMessage({type:'setEnabled',enabled:value})",value)
        assert result["ok"], result
    sample = ctx.new_page()
    sample.set_viewport_size({"width":640,"height":240})
    url=f"http://127.0.0.1:{server.server_port}"
    sample.goto(url)
    def capture(name):
        sample.locator("img").evaluate("img=>img.decode()")
        boxes=[sample.locator(sel).bounding_box() for sel in ["main","figure","img","button","aside","p"]]
        png=sample.screenshot(path=str(output/(name+".png")))
        return boxes,Image.open(BytesIO(png)).convert("RGB")
    before,a=capture("unfiltered")
    enable(True)
    sample.reload()
    sample.wait_for_selector("img[data-macos-filter-overlay]")
    after,b=capture("filtered")
    assert before==after, (before,after)
    # Phrase filtering changes text too. Compare the product row separately.
    delta=ImageChops.difference(a,b)
    delta.save(output/"difference.png")
    row=delta.crop((0,0,640,100))
    assert row.getbbox() == (38,30,158,90), row.getbbox()
    assert b.getpixel((60,62))==(0,0,0)
    assert a.getpixel((60,62))==(255,136,51)
    assert b.getpixel((38,30))==a.getpixel((38,30))
    box=before[3]
    bounds=tuple(round(v) for v in (box["x"],box["y"],box["x"]+box["width"],box["y"]+box["height"]))
    assert delta.crop(bounds).getbbox() is None
    sample.locator("button").click()
    enable(False)
    sample.wait_for_selector("img[data-macos-filter-overlay]",state="detached")
    restored,c=capture("restored")
    assert before==restored and ImageChops.difference(a,c).getbbox() is None
    enable(True)
    page.goto(f"http://localhost:{server.server_port}")
    assert page.url == base + "/blocked.html", page.url
    page.goto(f"http://127.0.0.1:{server.server_port}")
    page.wait_for_selector("[data-macos-filter-overlay]",state="attached")
    rect = page.locator("img").bounding_box()
    assert rect["width"] == 120 and rect["height"] == 60
    assert page.locator("[data-macos-filter-overlay]").bounding_box() == rect
    page.goto(base + "/rules.html")
    page.locator("#excluded").fill("localhost")
    page.locator("button").click()
    page.wait_for_function("document.querySelector('output').value.startsWith('Saved')")
    page.goto(f"http://localhost:{server.server_port}")
    assert page.locator("p").inner_text() == "example phrase"
    assert page.locator("[data-macos-filter-overlay]").count() == 0
    ctx.close()
server.shutdown()
