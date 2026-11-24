"""Run the packaged extension against its real Mac host in a disposable Chromium profile."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
from urllib.parse import parse_qs, urlparse

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

app, portrait, coffee = map(Path, sys.argv[1:])
extension_id = "jepaaemencfhlepcbinpekgnpfacdlpo"
identifiers = {"portrait": portrait, "coffee": coffee}
requests = []

def thumbnail(name):
    return "https://encrypted-tbn0.gstatic.com/images?q=tbn:" + name + "&s"

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/search":
            body = ('<body style="background:white;margin:0"><main style="display:flex">' +
                    ''.join(f'<img id="{name}" alt="{name}" width="180" height="180" src="{thumbnail(name)}">'
                            for name in identifiers) + '</main></body>').encode()
            mime = "text/html"
        elif url.path == "/images":
            name = parse_qs(url.query)["q"][0].removeprefix("tbn:")
            # No CORS header. The page can display these pixels but cannot read them.
            body = identifiers[name].read_bytes()
            mime = "image/png"
            requests.append((name, self.headers.get("Sec-Fetch-Dest"), self.headers.get("Cookie")))
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
    root = Path(temp)
    extension = root / "extension"
    shutil.copytree(app/"Contents/Resources/Extension", extension)
    manifest = extension/"manifest.json"
    cfg = json.loads(manifest.read_text())
    cfg["host_permissions"] = cfg.pop("optional_host_permissions")
    manifest.write_text(json.dumps(cfg))
    host = {"name":"com.pmeir99.macos_filter","description":"CI native host","type":"stdio",
            "path":str((app/"Contents/MacOS/FilterHost").resolve()),
            "allowed_origins":[f"chrome-extension://{extension_id}/"]}
    profile = root/"profile"
    # The CI runner is disposable. Restore any registrations installed by the update smoke test.
    support = Path.home()/"Library/Application Support"
    previous = {}
    server = ThreadingHTTPServer(("127.0.0.1",0),Fixture)
    cert, key = root/"fixture.crt", root/"fixture.key"
    subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-subj","/CN=www.google.com",
                    "-days","1","-keyout",str(key),"-out",str(cert)],check=True,stderr=subprocess.DEVNULL)
    tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert,key)
    server.socket=tls.wrap_socket(server.socket,server_side=True)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        for directory in [profile,support/"Chromium",support/"Google/Chrome for Testing",support/"Google/Chrome"]:
            registration=directory/"NativeMessagingHosts/com.pmeir99.macos_filter.json"
            previous[registration]=registration.read_bytes() if registration.exists() else None
            registration.parent.mkdir(parents=True,exist_ok=True)
            registration.write_text(json.dumps(host))
        port=server.server_port
        ctx=pw.chromium.launch_persistent_context(str(profile),channel="chromium",ignore_https_errors=True,
            args=[f"--disable-extensions-except={extension}",f"--load-extension={extension}",
                  "--no-proxy-server","--disable-quic",
                  f"--host-resolver-rules=MAP www.google.com 127.0.0.1:{port},MAP encrypted-tbn0.gstatic.com 127.0.0.1:{port}"])
        options=ctx.new_page()
        options.goto(f"chrome-extension://{extension_id}/options.html")
        options.locator("#enabled").wait_for()
        options.locator("#enabled").uncheck()
        options.wait_for_function("chrome.storage.local.get('enabled').then(v=>v.enabled===false)")
        options.get_by_label("What to cover",exact=True).select_option("personBlur")
        options.wait_for_function("chrome.storage.local.get('policy').then(v=>JSON.parse(v.policy).mode==='personBlur')")
        page=ctx.new_page()
        page.goto("https://www.google.com/search?q=fixture")
        page.locator("img").evaluate_all("images=>Promise.all(images.map(img=>img.decode()))")
        def capture():
            return {name:Image.open(BytesIO(page.locator("#"+name).screenshot())).convert("RGB") for name in identifiers}
        before=capture()
        bounds=[page.locator("#"+name).bounding_box() for name in identifiers]
        options.locator("#enabled").check()
        try:
            page.wait_for_selector('#portrait[data-macos-filter-status="person-detected"]',timeout=45000)
            page.wait_for_selector('#coffee[data-macos-filter-status="no-person-detected"]',timeout=45000)
        except Exception:
            print("Image decisions:",page.locator("img").evaluate_all("imgs=>imgs.map(i=>[i.id,i.dataset.macosFilterStatus])"),flush=True)
            print("Thumbnail requests:",requests,flush=True)
            print("Helper status:",options.locator("#helperStatus").inner_text(),flush=True)
            raise
        after=capture()
        assert ImageChops.difference(before["portrait"],after["portrait"]).getbbox()
        assert page.locator("feGaussianBlur").count()==1
        assert ImageChops.difference(before["coffee"],after["coffee"]).getbbox() is None
        assert page.locator("#coffee").get_attribute("data-macos-filter-overlay") is None
        assert bounds==[page.locator("#"+name).bounding_box() for name in identifiers]
        for name in identifiers:
            assert any(n==name and dest=="empty" and cookie is None for n,dest,cookie in requests), requests
        print("Real Chrome extension + packaged Vision host: portrait blurred; coffee unchanged pixel-for-pixel; layout preserved; credential-free CDN fallback passed.",flush=True)
        ctx.close()
    finally:
        server.shutdown()
        for path,original in previous.items():
            if original is None: path.unlink(missing_ok=True)
            else: path.write_bytes(original)
