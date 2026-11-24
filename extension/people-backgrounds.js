// CSS backgrounds are independent image layers. Never filter the element that
// owns them: on feed cards that would also filter labels and touch targets.
globalThis.PeopleBackgrounds = (() => {
  const selector = '[style*="background" i],[role="img"]';
  const placeholder = "linear-gradient(transparent, transparent)";
  function create() {
    const records = new Map(), queue = new Set(), classCandidates = new Set();
    let idle = null;
    let active = 0, stopped = false;
    function write(el, record, value) {
      el.style.setProperty("background-image",value,"important");
      record.applied = el.style.getPropertyValue("background-image");
    }
    function restore(el, record) {
      if (record.applied && el.style.getPropertyValue("background-image") === record.applied) {
        if (record.inline) el.style.setProperty("background-image",record.inline,record.priority);
        else el.style.removeProperty("background-image");
      }
      record.applied = "";
    }
    function forget(el) {
      const record = records.get(el);
      if (!record) return;
      records.delete(el); queue.delete(el);
      restore(el,record);
      delete el.dataset.macosFilterBackground;
      delete el.dataset.macosFilterBackgroundReason;
      delete el.dataset.macosFilterBackgroundStage;
    }
    async function localBytes(url) {
      if (/^data:image\/(?:png|jpeg|webp|avif|gif);base64,/i.test(url)) {
        if (url.length > 11184850) throw Error("Image exceeds local transport budget.");
        return url.slice(url.indexOf(",")+1);
      }
      const source = new URL(url);
      if (source.protocol!=="blob:" && source.origin!==location.origin) return null;
      const response = await fetch(url,source.protocol==="blob:" ? {} :
        {cache:"only-if-cached",mode:"same-origin",redirect:"error"});
      if (!response.ok || !/^image\//i.test(response.headers.get("content-type") || "")) throw Error("Uncached image");
      const blob = await response.blob();
      if (blob.size>8*1024*1024) throw Error("Image exceeds local transport budget.");
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result.split(",")[1]);
        reader.onerror=()=>reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }
    async function run(el, record) {
      const current = () => !stopped && el.isConnected && records.get(el)===record;
      try {
        el.dataset.macosFilterBackgroundStage="read";
        const bytes = await localBytes(record.url);
        if (!current()) return;
        el.dataset.macosFilterBackgroundStage="analysis";
        const response = await MacOSFilterHelpers.requestAnalysis({type:"filterImage",background:true,
          ...(bytes ? {imageData:bytes} : {thumbnail:record.url})},current);
        if (!current()) return;
        if (response?.retry) {
          setTimeout(()=>{if(current()){queue.add(el);pump();}},300);
          return;
        }
        if (response?.ok && response.personDetected && response.maskData) {
          el.dataset.macosFilterBackgroundStage="paint";
          const painted=await BackgroundPaint.render(bytes || response.sourceBytes,response.maskData,response.settings);
          el.dataset.macosFilterBackgroundStage="decode";
          await BackgroundPaint.decode(painted);
          if (!current()) return;
          write(el,record,'url("'+painted+'")');
          el.dataset.macosFilterBackground="people-masked";
        } else {
          restore(el,record);
          if (response?.error) el.dataset.macosFilterBackgroundReason=response.error;
          el.dataset.macosFilterBackground=response?.ok && response.personDetected===false ? "no-person-detected" : "unscanned";
        }
      } catch (error) {
        if (current()) {restore(el,record);el.dataset.macosFilterBackground="unscanned";el.dataset.macosFilterBackgroundReason=error.message;}
      } finally {
        if (current()) delete el.dataset.macosFilterBackgroundStage;
      }
    }
    function pump() {
      while (!stopped && active<2 && queue.size) {
        const el=queue.values().next().value;
        queue.delete(el);
        active++;
        run(el,records.get(el)).finally(()=>{active--;pump();});
      }
    }
    function inspect(el, classChanged=false) {
      if (!(el instanceof HTMLElement) || !el.isConnected) return;
      let old=records.get(el);
      if (!old && !el.matches(selector) && !el.hasAttribute("class")) return;
      if (old?.applied && el.style.getPropertyValue("background-image")===old.applied) {
        if (!classChanged) return;
        forget(el);
        old=null;
      }
      const value=getComputedStyle(el).backgroundImage;
      const match=/^url\("([^"]+)"\)$/.exec(value);
      if (match && old?.url===match[1]) return;
      if (old) forget(el);
      if (!match) return;
      const record={url:match[1],inline:el.style.getPropertyValue("background-image"),
        priority:el.style.getPropertyPriority("background-image"),applied:""};
      records.set(el,record);
      write(el,record,placeholder);
      el.dataset.macosFilterBackground="scanning";
      queue.add(el);pump();
    }
    function drainClasses() {
      idle=null;
      // Inspect ordinary stylesheet backgrounds without monopolizing a feed's render tick.
      const start=performance.now();
      let count=0;
      for (const el of classCandidates) {
        classCandidates.delete(el);
        inspect(el);
        if (++count>=64 || performance.now()-start>=5) break;
      }
      if (classCandidates.size) idle=setTimeout(drainClasses,0);
    }
    return {
      scan(root) {
        inspect(root);
        root.querySelectorAll?.(selector).forEach(el=>inspect(el));
        for (const el of root.querySelectorAll?.("[class]") || []) {
          if (el instanceof HTMLElement && !el.matches(selector)) classCandidates.add(el);
        }
        if (classCandidates.size && idle===null) drainClasses();
      },
      inspect, forget,
      remove(root) {forget(root);root.querySelectorAll?.("[data-macos-filter-background]").forEach(forget);},
      stop() {stopped=true;if(idle!==null) clearTimeout(idle);classCandidates.clear();queue.clear();for (const el of records.keys()) forget(el);}
    };
  }
  return {create};
})();
