"""Run the packaged extension against its real Mac host in a disposable Chromium profile."""
import base64
import hashlib
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
import time
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
        elif url.path == "/gallery":
            wiki = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/A.jpg/250px-A.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail"
            xphoto = "https://pbs.twimg.com/media/fixture?format=jpg&name=small"
            host = self.headers.get("Host")
            photo = wiki if host=="en.wikipedia.org" else xphoto
            bg_style = f"background-image:url('{photo}')" if host=="x.com" else ""
            css_background = f".bg{{background-image:url('{photo}')}}" if host!="x.com" else ""
            body = f"""<!doctype html><style>
              *{{box-sizing:border-box}} body{{margin:0;background:#e1f0e2}}main{{display:flex;gap:4px}}
              img,.bg,figure{{width:180px;height:180px;display:block;margin:0}}
              figure{{position:relative;clip-path:circle(48%);overflow:hidden}}
              button{{appearance:none;border:0;border-radius:0;box-shadow:none;position:absolute;right:38px;top:90px;background:#61327a;color:white;z-index:2}}
              .bg{{position:relative;background-size:cover;background-position:center}}
              {css_background}
            </style><main>
              <figure><picture><source srcset="{photo}"><img id="subject" src="/coffee.png"></picture><button>Save</button></figure>
              <img id="still" loading="lazy" alt="blocked test phrase" src="/coffee.png">
              <div class="bg" id="bg" style="{bg_style}"><button>Details</button></div>
              <div id="shadow"><template shadowrootmode="open"><img id="inside" width="120" height="120" src="/portrait.png"></template></div>
            </main><img id="pair" width="512" height="256" style="width:512px;height:256px" src="/pair.png">""".encode()
            mime = "text/html"
        elif url.path == "/pair.png":
            face = Image.open(portrait).convert("RGB").resize((256,256))
            pair = Image.new("RGB",(512,256))
            pair.paste(face,(0,0)); pair.paste(face.transpose(Image.Transpose.FLIP_LEFT_RIGHT),(256,0))
            buf = BytesIO(); pair.save(buf,format="PNG"); body=buf.getvalue()
            mime = "image/png"
        elif url.path in ["/coffee.png","/portrait.png"] or url.path.startswith(("/wikipedia/","/media/")):
            body = (coffee if url.path=="/coffee.png" else portrait).read_bytes()
            mime = "image/png"
            requests.append((self.headers.get("Host"), self.headers.get("Sec-Fetch-Dest"), self.headers.get("Cookie")))
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
    # Trust only the generated fixture key, including requests from the MV3 worker.
    public_key=subprocess.check_output(["openssl","x509","-in",str(cert),"-pubkey","-noout"])
    der=subprocess.check_output(["openssl","pkey","-pubin","-outform","DER"],input=public_key)
    spki=base64.b64encode(hashlib.sha256(der).digest()).decode()
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
        ctx=pw.chromium.launch_persistent_context(str(profile),channel="chromium",
            args=[f"--disable-extensions-except={extension}",f"--load-extension={extension}",
                  "--no-proxy-server","--disable-quic",f"--ignore-certificate-errors-spki-list={spki}",
                  f"--host-resolver-rules=MAP www.google.com 127.0.0.1:{port},MAP encrypted-tbn0.gstatic.com 127.0.0.1:{port},MAP en.wikipedia.org 127.0.0.1:{port},MAP thumb.wikimedia.org 127.0.0.1:{port},MAP x.com 127.0.0.1:{port},MAP pbs.twimg.com 127.0.0.1:{port}"])
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
            print("Image decisions:",page.locator("img").evaluate_all("imgs=>imgs.map(i=>[i.id,i.dataset.macosFilterStatus,i.dataset.macosFilterReason])"),flush=True)
            print("Thumbnail requests:",requests,flush=True)
            worker=ctx.service_workers[0]
            diagnostics=worker.evaluate("""async ([page,url]) => {
              const result={mode:current?.mode, eligible:GoogleThumbnails.eligible(url,page)};
              try { const imageData=await GoogleThumbnails.read(url);
                result.bytes=imageData.length;
                const {siteRules,...analysis}=current;
                const answer=await scheduledAnalysis(imageData,{mode:"personBlur",analysis});
                result.native={ok:answer.ok,personDetected:answer.personDetected,error:answer.error};
              } catch(e){result.error=e.message;}
              return result;
            }""",[page.url,thumbnail("portrait")])
            print("Worker diagnostics:",diagnostics,flush=True)
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
        def setting(key, value):
            options.evaluate("""async ([key,value])=>{const r=await chrome.runtime.sendMessage({type:'editSettings',key,value});if(!r.ok)throw Error(r.error);}""",[key,value])
        setting("enabled",False)
        setting("mode","peopleOnly")
        setting("overlayStyle","blur")
        setting("siteRules.products","blocked test phrase")
        for domain in ["en.wikipedia.org","x.com"]:
            page.goto("https://"+domain+"/gallery")
            subject=page.locator("#subject")
            subject.evaluate("img=>img.decode()")
            page.locator("#inside").evaluate("img=>img.decode()")
            page.locator("#still").evaluate("img=>img.decode()")
            page.locator("#pair").evaluate("img=>img.decode()")
            page.locator("#bg").evaluate("async el=>{const i=new Image();i.src=getComputedStyle(el).backgroundImage.slice(5,-2);await i.decode()}")
            def snap(selector):
                return Image.open(BytesIO(page.locator(selector).screenshot())).convert("RGB")
            selectors=["figure","#still","#bg","#inside","#pair","figure button","#bg button"]
            baseline={key:snap(key) for key in selectors}
            bounds={key:page.locator(key).bounding_box() for key in selectors}
            before_requests=len(requests)
            setting("publicMedia",False)
            setting("enabled",True)
            page.wait_for_selector('#subject[data-macos-filter-status="unscanned"]')
            assert not ImageChops.difference(baseline["figure"],snap("figure")).getbbox()
            assert not any(dest=="empty" and host in ["thumb.wikimedia.org","pbs.twimg.com"]
                           for host,dest,cookie in requests[before_requests:]),"CDN read without opt-in"
            t0=time.perf_counter()
            setting("publicMedia",True)
            for selector in ["#subject","#inside","#pair"]:
                page.wait_for_selector(selector+'[data-macos-filter-status="people-masked"]',timeout=45000)
            page.wait_for_selector('#still[data-macos-filter-status="no-person-detected"]')
            page.wait_for_selector('#bg[data-macos-filter-background="people-masked"]')
            print(f"{domain} fixture: gallery decisions after settings save in {(time.perf_counter()-t0)*1000:.0f} ms",flush=True)
            assert all(page.locator(key).bounding_box()==bounds[key] for key in selectors)
            for key in ["figure button","#bg button"]:
                assert page.locator(key).evaluate("el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el}")
            for key in ["#still","figure button","#bg button"]:
                assert not ImageChops.difference(baseline[key],snap(key)).getbbox(),key
            for key in ["figure","#bg","#inside","#pair"]:
                delta=ImageChops.difference(baseline[key],snap(key))
                assert delta.getbbox(),key
                assert not delta.crop((0,0,5,5)).getbbox(),(key,"background changed")
            pair_delta=ImageChops.difference(baseline["#pair"],snap("#pair"))
            assert pair_delta.crop((100,45,125,70)).getbbox() and pair_delta.crop((386,45,411,70)).getbbox(),"missed one of two faces"
            figure_delta=ImageChops.difference(baseline["figure"],snap("figure"))
            assert figure_delta.crop((70,29,90,52)).getbbox(),"portrait face remained unchanged"
            assert not figure_delta.crop((14,30,35,45)).getbbox(),"background beside subject changed"
            proof=Path("silhouette-comparison");proof.mkdir(exist_ok=True)
            baseline["figure"].save(proof/(domain+"-before.png"))
            snap("figure").save(proof/(domain+"-after.png"))
            # Recycle one element from a human to a blob containing a non-person.
            page.locator("#pair").evaluate("""async img=>{const res=await fetch('/coffee.png');img.src=URL.createObjectURL(await res.blob());}""")
            page.wait_for_selector('#pair[data-macos-filter-status="no-person-detected"]')
            assert page.locator("#pair").get_attribute("data-macos-filter-overlay") is None
            assert any(host in ["thumb.wikimedia.org","pbs.twimg.com"] and dest=="empty" and cookie is None
                       for host,dest,cookie in requests)
            if domain=="x.com":
                batch = page.evaluate("""async () => {
                  const area=document.createElement('section');
                  const begin=performance.now(); const elapsed=[];
                  const done=new Promise((resolve,reject)=>{
                    const timer=setTimeout(()=>{watch.disconnect();reject(Error('Batch timed out'))},45000);
                    const watch=new MutationObserver(()=>{
                      for(const img of area.children){
                        if(!img.hasAttribute('data-mf-reviewed') || img.dataset.timed) continue;
                        const expected=img.alt==='portrait'?'people-masked':'no-person-detected';
                        if(img.dataset.macosFilterStatus!==expected){clearTimeout(timer);watch.disconnect();reject(Error(img.dataset.macosFilterStatus));return;}
                        img.dataset.timed='yes';elapsed.push(performance.now()-begin);
                      }
                      if(elapsed.length===24){clearTimeout(timer);watch.disconnect();requestAnimationFrame(()=>requestAnimationFrame(resolve));}
                    });
                    watch.observe(area,{subtree:true,attributes:true,attributeFilter:['data-mf-reviewed']});
                  });
                  for(let n=0;n<24;n++){const img=new Image(64,64);img.alt=n%2?'portrait':'coffee';img.src='/'+img.alt+'.png';area.append(img)}
                  document.body.append(area);await done;area.remove();
                  return {images:elapsed.length,median_ms:Math.round(elapsed[11]),last_paint_ms:Math.round(performance.now()-begin)};
                }""")
                print("24-image cached-source gallery (browser wall clock):",batch,flush=True)
            # Change the same image between browser-decoded still formats and compare each final verdict.
            for fmt in ["JPEG","WEBP","AVIF"]:
                buf=BytesIO()
                Image.open(portrait).convert("RGB").save(buf,format=fmt)
                value="data:image/"+fmt.lower()+";base64,"+base64.b64encode(buf.getvalue()).decode()
                page.locator("#pair").evaluate("(img,src)=>{img.src=src}",value)
                page.wait_for_selector('#pair[data-macos-filter-status="people-masked"]')
                page.locator("#pair").evaluate("img=>{img.src='/coffee.png'}")
                page.wait_for_selector('#pair[data-macos-filter-status="no-person-detected"]')
            if domain=="x.com":
                setting("overlayColor","#334455")
                setting("overlayStyle","solid")
                page.wait_for_function(r"""()=>{const el=document.querySelector('#subject'),ref=el.style.filter.match(/#(mf-[\w-]+)/);return ref && document.getElementById(ref[1])?.querySelector('feFlood[flood-color="#334455"]') && el.dataset.macosFilterStatus==='people-masked'}""")
                assert snap("figure").getpixel((78,39))==(51,68,85)
                assert not ImageChops.difference(baseline["#still"],snap("#still")).getbbox()
            setting("enabled",False)
            page.wait_for_selector('#bg[data-macos-filter-background]',state="detached")
            assert not ImageChops.difference(baseline["figure"],snap("figure")).getbbox()
        print("Silhouettes passed: face, pair, background pixels, no-person, rounded clip, buttons, CSS background, shadow DOM, responsive picture, lazy image and recycled blob.",flush=True)
        ctx.close()
    finally:
        server.shutdown()
        for path,original in previous.items():
            if original is None: path.unlink(missing_ok=True)
            else: path.write_bytes(original)
