import os, shutil, tempfile, threading, json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b'<p>example phrase</p><img width="120" height="60" src="data:image/png;base64,AA==">')

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
