import os, shutil, tempfile, threading, json, re, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

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
</style><main><figure><img src="PHOTO"><button>Save</button></figure><aside>Product details</aside></main><p>example <strong>phrase</strong></p>""".replace("PHOTO",photo_url)
output = Path("layout-comparison")
output.mkdir(exist_ok=True)

image_requests = []
class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        if self.path == "/local-photo.png":
            image_requests.append(self.path)
            self.send_header("Content-Type","image/png")
            self.send_header("Cache-Control","no-store")
            self.end_headers()
            self.wfile.write(encoded.getvalue())
            return
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        page_html = fixture
        if self.path == "/local-test":
            page_html = fixture.replace(photo_url,"/local-photo.png")
        if self.path == "/foreign-test":
            foreign = f"http://localhost:{self.server.server_port}/local-photo.png"
            page_html = fixture.replace(photo_url,foreign)
        self.wfile.write(page_html.encode())

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
    # Supply a deterministic native response for mask alignment only. The first
    # comparison still runs against the real disconnected-host fallback.
    sw_file=extension / "service-worker.js"
    sw_file.write_text(sw_file.read_text().replace("function nativeRequest(action, imageData, profile) {",
        """async function nativeRequest(action, imageData, profile) {
          if (action === 'subscribe') {
            return {ok:true,settings:globalThis.fixtureSettings || {enabled:false}};
          }
          const {fixtureMask}=await chrome.storage.local.get('fixtureMask');
          if (fixtureMask && action === 'segmentWithPolicy') {
            await new Promise(resolve=>setTimeout(resolve,40));
            return {ok:true,maskData:fixtureMask,personDetected:profile?.analysis?.mode==="peopleOnly" ? true : undefined};
          }
        """))
    ctx = pw.chromium.launch_persistent_context(str(Path(tmp) / "profile"), channel="chromium",
        executable_path=os.environ.get("CHROMIUM_PATH"),
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"])
    worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    page = ctx.new_page()
    page.on("pageerror",lambda error: print("Options page error:",error,flush=True))
    base = worker.url.rsplit("/", 1)[0]
    page.goto(base + "/popup.html")
    settings = {"enabled":False, "mode":"allPeople", "opacity":1, "overlayColor":"#000000",
                "overlayStyle":"solid", "blurRadius":8,
                "siteRules":{"phrases":"example phrase", "blocked":"localhost"}}
    def push():
        worker.evaluate("s => { globalThis.fixtureSettings=s; return serialize(() => applySettings(s)); }", settings)
    def enable(value):
        settings["enabled"] = value
        push()
    push()
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
    sample.wait_for_function("Array.from(CSS.highlights.get('mf-phrases') || []).some(range=>range.toString()==='example phrase')")
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
    sample.evaluate("""async () => {
      const img=document.querySelector('img'), parent=img.parentElement;
      img.remove(); await new Promise(resolve=>setTimeout(resolve,25));
      parent.prepend(img);
    }""")
    sample.wait_for_selector("img[data-macos-filter-overlay]")
    _,recycled=capture("recycled-card")
    assert recycled.getpixel((60,62))==(0,0,0)
    mask=Image.new("RGBA",(160,90),(0,0,0,0))
    mask.paste((255,255,255,255),(0,0,80,90))
    buffer=BytesIO()
    mask.save(buffer,format="PNG")
    page.evaluate("mask => chrome.storage.local.set({fixtureMask:mask})",base64.b64encode(buffer.getvalue()).decode())
    sample.reload()
    sample.wait_for_selector("img[data-macos-filter-overlay]")
    # The test mask covers the left half after the image is center-cropped.
    partial_boxes,partial=capture("partial")
    assert partial_boxes == before
    assert partial.getpixel((65,62)) == (0,0,0)
    assert partial.getpixel((137,75)) == a.getpixel((137,75))
    assert ImageChops.difference(a,partial).crop(bounds).getbbox() is None
    # Fine stripes lose contrast only inside the selected half. Compare against
    # the exact same uncensored frame, including the overlapping Save button.
    stripes=Image.new("RGB",(160,90),"white")
    for i in range(0,160,4):
        stripes.paste((0,0,0),(i,0,i+2,90))
    buf=BytesIO()
    stripes.save(buf,format="PNG")
    stripe_url="data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()
    enable(False)
    sample.locator("img").evaluate("(img,url)=>img.src=url",stripe_url)
    _,stripe_before=capture("blur-original")
    settings["overlayStyle"]="blur"
    enable(True)
    sample.reload()
    sample.locator("img").evaluate("(img,url)=>img.src=url",stripe_url)
    sample.wait_for_selector("img[data-macos-filter-overlay]")
    _,blurred=capture("blur-mask")
    low,high=blurred.crop((55,55,82,77)).convert("L").getextrema()
    assert high-low<40,(low,high)
    assert ImageChops.difference(blurred,stripe_before).crop((115,55,145,77)).getbbox() is None
    assert ImageChops.difference(blurred,stripe_before).crop(bounds).getbbox() is None
    settings["overlayStyle"]="solid"
    settings["siteRules"]["presentation"]="loading"
    push()
    sample.goto(url+"/local-test",wait_until="domcontentloaded")
    sample.wait_for_function("getComputedStyle(document.body).opacity==='0'")
    sample.wait_for_function("document.documentElement.hasAttribute('data-mf-page-ready')")
    assert sample.evaluate("getComputedStyle(document.body).opacity") == "1"
    _, captured=capture("local-capture")
    assert captured.getpixel((65,62))==(0,0,0)
    assert captured.getpixel((137,75))==a.getpixel((137,75))
    assert len(image_requests)==1, image_requests
    sample.goto(url+"/foreign-test")
    sample.wait_for_selector('img[data-macos-filter-status="blocked-local-filter-error"]')
    sample.wait_for_function("document.documentElement.hasAttribute('data-mf-page-ready')")
    _,foreign=capture("unreadable-cross-origin")
    assert foreign.getpixel((65,62))==(0,0,0) and foreign.getpixel((137,75))==(0,0,0)
    assert len(image_requests)==2, image_requests
    page.reload()
    page.wait_for_function("chrome.storage.local.get('siteRules').then(v=>v.siteRules.presentation==='loading')")
    page.evaluate("chrome.storage.local.remove('fixtureMask')")

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
    settings["siteRules"].update({"profiles":[{"site":"127.0.0.1","mode":"entireImage","cutoff":0.7}],"excluded":"localhost"})
    push()
    page.goto(f"http://localhost:{server.server_port}")
    assert page.locator("p").inner_text() == "example phrase"
    assert page.locator("[data-macos-filter-overlay]").count() == 0
    page.goto(base + "/popup.html")
    assert page.evaluate("chrome.storage.local.get('siteRules').then(v=>v.siteRules.profiles[0].mode)")=="entireImage"
    page.evaluate("mask => chrome.storage.local.set({fixtureMask:mask})",base64.b64encode(buffer.getvalue()).decode())
    sample.goto(url)
    sample.wait_for_selector("img[data-macos-filter-overlay]")
    assert not sample.locator("feImage").count()
    settings["siteRules"]["profiles"]=[]
    push()
    sample.evaluate("(src) => { for(let i=0;i<96;i++){ const img=new Image();img.src=src;document.body.append(img); } }",photo_url)
    sample.wait_for_function("document.querySelectorAll('img[data-mf-reviewed]').length===97")
    assert sample.locator('img[data-macos-filter-status="blocked-local-filter-error"]').count()==0
    assert sample.locator("feImage").count()==97
    # Verify the actual options page, per-field autosave, and restoration on reload.
    page.goto(base+"/options.html")
    page.wait_for_function("!document.querySelector('#fields').disabled || document.querySelector('#status').textContent.length>0")
    assert not page.locator("#fields").is_disabled(), page.locator("#status").inner_text()
    page.get_by_label("Mask style",exact=True).select_option("blur")
    page.wait_for_function("chrome.storage.local.get('policy').then(v=>JSON.parse(v.policy).overlayStyle==='blur')")
    page.reload()
    assert page.get_by_label("Mask style",exact=True).input_value()=="blur"
    page.get_by_label("Blocked domains",exact=True).fill("bad domain")
    page.wait_for_function("document.querySelector('#status').textContent.startsWith('Unsaved')")
    assert page.evaluate("chrome.storage.local.get('siteRules').then(v=>v.siteRules.blocked)")=="localhost"
    page.get_by_label("Blocked domains",exact=True).fill("localhost")
    # A malformed PNG must fall back to opaque black even under an existing site invert filter.
    page.evaluate("chrome.storage.local.set({fixtureMask:'bad-data'})")
    sample.goto(url)
    sample.locator("img").evaluate("img=>img.style.filter='invert(1)'")
    sample.wait_for_selector('img[data-macos-filter-status="blocked-local-filter-error"]')
    _,failed=capture("invalid-mask")
    assert failed.getpixel((65,62))==(0,0,0) and failed.getpixel((137,75))==(0,0,0)
    sample.locator("img").evaluate("img=>img.style.filter='sepia(1)'")
    sample.wait_for_function("document.querySelector('img').style.filter==='brightness(0)'")
    page.locator("#enabled").uncheck()
    sample.wait_for_function("document.querySelector('img').style.filter==='sepia(1)'")
    # Exercise a CSS-defined background through the actual MV3 background painter.
    settings.update(mode="peopleOnly",enabled=True,overlayStyle="solid",overlayColor="#112233")
    page.evaluate("mask=>chrome.storage.local.set({fixtureMask:mask})",base64.b64encode(buffer.getvalue()).decode())
    push()
    sample.goto(url)
    sample.evaluate("""src=>{
        const css=document.createElement('style');css.textContent='.class-photo{width:160px;height:90px;background-image:url("'+src+'")}';
        const card=document.createElement('div');card.className='class-photo';document.head.append(css);document.body.append(card);
    }""",photo_url)
    card=sample.locator(".class-photo")
    try:
        sample.wait_for_selector('.class-photo[data-macos-filter-background="people-masked"]',timeout=10000)
    except Exception:
        print("CSS paint:",card.evaluate("el=>[el.dataset.macosFilterBackground,el.dataset.macosFilterBackgroundReason,getComputedStyle(el).backgroundImage.slice(0,80)]"),flush=True)
        raise
    painted=Image.open(BytesIO(card.screenshot())).convert("RGB")
    assert painted.getpixel((32,40))==(17,34,51) and painted.getpixel((130,40))==(255,136,51)
    # Run the production popup document against the real active website tab.
    # A same-extension frame keeps the toolbar UI inspectable in headless CI.
    assert cfg["action"]["default_popup"]=="popup.html" and cfg["options_ui"]["open_in_tab"]
    settings["siteRules"]["excluded"]=""
    push()
    sample.evaluate("""src=>{const f=document.createElement('iframe');f.id='embedded';f.src=src;document.body.append(f)}""",url.replace("127.0.0.1","localhost"))
    embedded=sample.frame_locator("#embedded")
    embedded.locator("img[data-macos-filter-overlay]").wait_for()
    harness=ctx.new_page()
    harness.goto(base+"/blocked.html")
    sample.bring_to_front()
    harness.evaluate("""()=>{const f=document.createElement('iframe');f.id='toolbar';f.style.cssText='position:fixed;inset:0 auto auto 0;width:336px;height:440px;border:0;z-index:10';f.src=chrome.runtime.getURL('popup.html');document.body.append(f)}""")
    popup=harness.frame_locator("#toolbar")
    popup.get_by_role("heading",name="127.0.0.1").wait_for()
    popup.get_by_label("Filter this site").uncheck()
    sample.wait_for_function("document.documentElement.hasAttribute('data-mf-paused')")
    embedded.locator("html[data-mf-paused]").wait_for(state="attached")
    expect(page.get_by_label("Excluded domains")).to_have_value(re.compile(r"127\.0\.0\.1"))
    assert popup.get_by_label("What to cover").is_disabled()
    popup.get_by_label("Filter this site").check()
    sample.wait_for_function("!document.documentElement.hasAttribute('data-mf-paused')")
    embedded.locator("img[data-macos-filter-overlay]").wait_for()
    popup.get_by_label("What to cover").select_option("entireImage")
    expect(page.locator("#profiles select")).to_have_value("entireImage")
    popup.get_by_label("What to cover").select_option("")
    expect(page.locator("#profiles select")).to_have_count(0)
    harness.bring_to_front()
    height=popup.locator("main").evaluate("el=>Math.ceil(el.getBoundingClientRect().height)")
    clip={"x":0,"y":0,"width":336,"height":height}
    harness.screenshot(path=str(output/"toolbar-light.png"),clip=clip)
    harness.emulate_media(color_scheme="dark")
    harness.screenshot(path=str(output/"toolbar-dark.png"),clip=clip)
    assert ImageChops.difference(Image.open(output/"toolbar-light.png").convert("RGB"),
                                Image.open(output/"toolbar-dark.png").convert("RGB")).getbbox()
    with ctx.expect_page() as opened:
        popup.get_by_role("button",name="Open extension").click()
    page=opened.value
    page.wait_for_url(base+"/options.html")
    expect(page.get_by_role("heading",name="Filter settings")).to_be_visible()
    expect(page.locator("#fields")).to_be_enabled()
    page.bring_to_front()
    page.set_viewport_size({"width":980,"height":760})
    page.screenshot(path=str(output/"settings-light.png"))
    page.emulate_media(color_scheme="dark")
    page.screenshot(path=str(output/"settings-dark.png"))
    page.set_viewport_size({"width":390,"height":700})
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    print("Popup site pause/resume, profile/default, full-page launch, live settings sync and responsive layouts passed.",flush=True)
    ctx.close()
server.shutdown()
