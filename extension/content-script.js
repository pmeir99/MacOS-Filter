(() => {
  if (globalThis.__macOSFilterBootstrap) return;
  const state = { active: false, stop: null };
  globalThis.__macOSFilterBootstrap = state;

  function startFiltering(silhouettes) {
    if (state.active) return;
    state.active = true;

    let stopped = false;
    const originalVisibility = new WeakMap();
    const currentURL = new WeakMap();
    const attempts = new WeakMap();
    const decoding = new WeakMap();
    const delays = new WeakMap();
    const overlays = new WeakMap();
    const watched = new Set();
    const backgrounds = silhouettes ? PeopleBackgrounds.create() : null;
    const roots = new Map();

    function hideImage(image) {
      image.removeAttribute('data-mf-reviewed');
      if (!originalVisibility.has(image)) {
        originalVisibility.set(image, {
          value: image.style.getPropertyValue("visibility"),
          priority: image.style.getPropertyPriority("visibility")
        });
      }
      image.style.setProperty("visibility", "hidden", "important");
    }

    function restoreImage(image) {
      image.setAttribute('data-mf-reviewed','');
      const original = originalVisibility.get(image);
      if (original) {
        if (original.value) image.style.setProperty("visibility", original.value, original.priority);
        else image.style.removeProperty("visibility");
        originalVisibility.delete(image);
      }
    }

    const svgNS = "http://www.w3.org/2000/svg";
    function svg(name, attributes) {
      const element = document.createElementNS(svgNS, name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    }
    const sizes = new ResizeObserver(entries => {
      for (const {target} of entries) setMaskGeometry(target);
    });

    function removeOverlay(image) {
      const layer = overlays.get(image);
      if (!layer) return;
      if (image.style.getPropertyValue("filter") === layer.applied) {
        if (layer.original) image.style.setProperty("filter", layer.original, layer.priority);
        else image.style.removeProperty("filter");
      }
      if (layer.frozen && image.style.getPropertyValue("content") === layer.frozen) {
        if (layer.previousContent) image.style.setProperty("content",layer.previousContent,layer.contentPriority);
        else image.style.removeProperty("content");
      }
      if (layer.black && image.style.getPropertyValue("background-color") === layer.black) {
        if (layer.background) image.style.setProperty("background-color", layer.background, layer.backgroundPriority);
        else image.style.removeProperty("background-color");
      }
      sizes.unobserve(image);
      layer.svg?.remove();
      overlays.delete(image);
      watched.delete(image);
      image.removeAttribute("data-macos-filter-overlay");
    }

    function finishCoverTransition(image) {
      for (const animation of image.getAnimations()) {
        if (animation instanceof CSSTransition && ["filter","background-color"].includes(animation.transitionProperty)) {
          animation.finish();
        }
      }
    }

    function composeFilter(author, reference) {
      const mask="url("+JSON.stringify(reference)+")";
      if (author==="none") return mask;
      return silhouettes ? mask+" "+author : author+" "+mask;
    }

    function syncLayer(image) {
      const layer=overlays.get(image);
      if (!layer) return;
      // Sites may replace inline styles while recycling or animating a card.
      // Preserve their newest declarations so pausing restores the current design.
      if (image.style.getPropertyValue("filter") !== layer.applied) {
        layer.original=image.style.getPropertyValue("filter");
        layer.priority=image.style.getPropertyPriority("filter");
        const author=getComputedStyle(image).filter;
        const filter=layer.black ? "brightness(0)" :
          composeFilter(author,layer.reference);
        image.style.setProperty("filter",filter,"important");
        layer.applied=image.style.getPropertyValue("filter");
        finishCoverTransition(image);
      }
      if (layer.black && image.style.getPropertyValue("background-color")!==layer.black) {
        layer.background=image.style.getPropertyValue("background-color");
        layer.backgroundPriority=image.style.getPropertyPriority("background-color");
        image.style.setProperty("background-color","#000","important");
      }
      setMaskGeometry(image);
    }
    function setMaskGeometry(image) {
      const layer = overlays.get(image);
      if (!layer?.mask) return;
      const style = getComputedStyle(image);
      const x = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const y = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      const borderBox = style.boxSizing === "border-box";
      const width = parseFloat(style.width) - (borderBox ? x+parseFloat(style.paddingRight)+parseFloat(style.borderRightWidth) : 0);
      const height = parseFloat(style.height) - (borderBox ? y+parseFloat(style.paddingBottom)+parseFloat(style.borderBottomWidth) : 0);
      const g = MacOSFilterHelpers.maskGeometry(width,height,image.naturalWidth,image.naturalHeight,style.objectFit,style.objectPosition);
      if (!g) {
        // A hidden/zero-size image may become visible later, at which point resize reruns.
        if (width > 0 && height > 0) coverOnFailure(image, "Unsupported image crop.");
        return;
      }
      for (const [key,value] of Object.entries({x,y,width,height})) layer.clip.setAttribute(key,value);
      for (const [key,value] of Object.entries({x:x+g.left,y:y+g.top,width:g.width,height:g.height})) layer.mask.setAttribute(key,value);
    }

    function placeOverlay(image, result) {
      removeOverlay(image);
      const original=image.style.getPropertyValue("filter"), priority=image.style.getPropertyPriority("filter");
      const previous=getComputedStyle(image).filter;
      if (MacOSFilterHelpers.shouldCoverWholeImage(result) && result.settings.overlayStyle === "solid" &&
          result.settings.opacity === 1 && result.settings.overlayColor.toLowerCase() === "#000000") {
        const background=image.style.getPropertyValue("background-color"), backgroundPriority=image.style.getPropertyPriority("background-color");
        image.style.setProperty("background-color","#000","important");
        image.style.setProperty("filter","brightness(0)","important");
        finishCoverTransition(image);
        overlays.set(image,{original,priority,applied:image.style.getPropertyValue("filter"),background,backgroundPriority,
          black:image.style.getPropertyValue("background-color")});
        watched.add(image);
        image.setAttribute("data-macos-filter-overlay","true");
        return;
      }
      const id = "mf-" + Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
      const resource = svg("svg",{width:0,height:0,"aria-hidden":"true"});
      resource.style.cssText="position:absolute!important;width:0!important;height:0!important;pointer-events:none!important";
      const filter = svg("filter",{id,x:"0%",y:"0%",width:"100%",height:"100%","color-interpolation-filters":"sRGB"});
      const partial = !MacOSFilterHelpers.shouldCoverWholeImage(result);
      const blur = result.settings.overlayStyle === "blur";
      filter.append(blur ? svg("feGaussianBlur",{in:"SourceGraphic",stdDeviation:result.settings.blurRadius || 16,edgeMode:"duplicate",result:"paint"})
                         : svg("feFlood",{"flood-color":result.settings.overlayColor,"flood-opacity":result.settings.opacity,result:"paint"}));
      let mask, clip;
      if (partial) {
        mask=svg("feImage",{href:"data:image/png;base64,"+result.maskData,preserveAspectRatio:"none",result:"rawRegion"});
        clip=svg("feFlood",{"flood-color":"white",result:"contentBox"});
        if (silhouettes) filter.append(svg("feComposite",{in:"paint",in2:"SourceGraphic",operator:"atop",result:"paintOnSource"}));
        filter.append(mask,clip,svg("feComposite",{in:"rawRegion",in2:"contentBox",operator:"in",result:"region"}),svg("feComposite",{in:silhouettes?"paintOnSource":"paint",in2:"region",operator:"in",result:"selected"}));
      }
      if (partial && (blur || silhouettes)) {
        filter.append(svg("feComposite",{in:"SourceGraphic",in2:"region",operator:"out",result:"uncovered"}),
                      svg("feComposite",{in:"selected",in2:"uncovered",operator:"arithmetic",k2:1,k3:1}));
      } else if (!blur) {
        filter.append(svg("feComposite",{in:partial?"selected":"paint",in2:"SourceGraphic",operator:"over"}));
      }
      resource.append(filter);
      const root = image.getRootNode();
      (root instanceof ShadowRoot ? root : document.documentElement).append(resource);
      const documentURL = location.href.split("#")[0];
      const reference = (document.baseURI.split("#")[0] === documentURL ? "" : documentURL) + "#" + id;
      image.style.setProperty("filter",composeFilter(previous,reference),"important");
      const previousContent=image.style.getPropertyValue("content"), contentPriority=image.style.getPropertyPriority("content");
      let frozen;
      if (partial && result.snapshot && !silhouettes) {
        image.style.setProperty("content",'url("'+result.snapshot+'")',"important");
        frozen=image.style.getPropertyValue("content");
      }
      finishCoverTransition(image);
      overlays.set(image,{clip,reference,frozen,previousContent,contentPriority,svg:resource,mask,original,priority,applied:image.style.getPropertyValue("filter")});
      image.setAttribute("data-macos-filter-overlay","true");
      watched.add(image);
      if (partial) sizes.observe(image);
      setMaskGeometry(image);
    }

    function coverOnFailure(image, errorMessage) {
      if (stopped) return;
      if (silhouettes) {
        removeOverlay(image);
        image.dataset.macosFilterStatus = "unscanned";
        image.dataset.macosFilterReason = errorMessage || "Local analysis unavailable.";
        restoreImage(image);
        return;
      }
      placeOverlay(image, {
        ok: false,
        coverWholeImage: true,
        settings: { overlayColor: "#000000", overlayStyle: "solid", opacity: 1 }
      });
      image.dataset.macosFilterStatus = "blocked-local-filter-error";
      const knownReasons = {
        "Failed to fetch":"thumbnail-fetch-failed",
        "Google thumbnail unavailable.":"thumbnail-unavailable",
        "Google thumbnail exceeds the local budget.":"thumbnail-too-large",
        "This thumbnail is outside the permitted Google Search source.":"unsupported-thumbnail",
        "Person detection unavailable.":"detector-unavailable",
        "Image exceeds local capture budget.":"capture-size-limit"
      };
      image.dataset.macosFilterReason = knownReasons[errorMessage] || "local-analysis-error";
      restoreImage(image);
    }

    async function processImage(image) {
      if (stopped || !(image instanceof HTMLImageElement) || !image.isConnected) return;
      const url = image.currentSrc || image.src;
      if (!url || currentURL.get(image) === url) return;
      const attempt = Symbol();
      attempts.set(image,attempt);
      currentURL.set(image, url);
      delete image.dataset.macosFilterReason;
      hideImage(image);
      if (silhouettes) image.dataset.macosFilterStatus="scanning";
      removeOverlay(image);

      try {
        const message = {type:"filterImage", description:[image.alt,image.title,image.getAttribute("aria-label")].filter(Boolean).join(" ").slice(0,4096)};
        let result = silhouettes ? {needsPixels:true,personMode:true} : await chrome.runtime.sendMessage(message);
        if (result?.needsPixels) {
          if (stopped || attempts.get(image)!==attempt || !image.isConnected || (image.currentSrc || image.src) !== url) return;
          let snapshot;
          if ((!silhouettes || url.length <= 4_000_000) && /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(url)) {
            message.imageData=url.slice(url.indexOf(",")+1);
          } else {
            const width=image.naturalWidth, height=image.naturalHeight;
            if (!width || !height || (!silhouettes && width*height>4000000)) throw Error("Image exceeds local capture budget.");
            const canvas=document.createElement("canvas");
            const scale = silhouettes ? Math.min(1,1536/Math.max(width,height)) : 1;
            canvas.width=Math.max(1,Math.round(width*scale)); canvas.height=Math.max(1,Math.round(height*scale));
            canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
            try {
              if (silhouettes) {
                const blob=await new Promise((resolve,reject)=>canvas.toBlob(
                  value=>value ? resolve(value) : reject(Error("Local capture failed.")),"image/png"));
                snapshot=await new Promise((resolve,reject)=>{
                  const reader=new FileReader();
                  reader.onload=()=>resolve(reader.result);
                  reader.onerror=()=>reject(reader.error);
                  reader.readAsDataURL(blob);
                });
              } else snapshot=canvas.toDataURL("image/png");
              message.imageData=snapshot.slice(snapshot.indexOf(",")+1);
            } catch (error) {
              if (error.name !== "SecurityError" || !result.personMode) throw error;
              message.thumbnail=url;
            }
          }
          if (message.imageData?.length>11184812) throw Error("Image exceeds local transport budget.");
          result=await chrome.runtime.sendMessage(message);
          if (result && !silhouettes) result.snapshot=snapshot;
        }
        if (stopped || attempts.get(image)!==attempt || !image.isConnected || (image.currentSrc || image.src)!==url || currentURL.get(image) !== url) return;
        if (result?.retry) {
          // Release the snapshot before retrying. Keep the image gated while other tabs drain.
          const delay = Math.min((delays.get(image) || 150) * 2, 4000);
          delays.set(image, delay);
          setTimeout(() => {
            if (stopped || attempts.get(image) !== attempt || !image.isConnected) return;
            currentURL.delete(image);
            enqueue(image);
          }, delay);
          return;
        }
        delays.delete(image);
        if (result && result.ok === true && result.settings && result.settings.enabled === false) {
          removeOverlay(image);
          delete image.dataset.macosFilterStatus;
          restoreImage(image);
          return;
        }
        if (!result || !result.settings || result.ok !== true) {
          coverOnFailure(image, result && result.error);
          return;
        }
        result.settings = MacOSFilterHelpers.normalizeSettings(result.settings);
        if (result.personDetected === false) {
          removeOverlay(image);
          image.dataset.macosFilterStatus = "no-person-detected";
          restoreImage(image);
          return;
        }
        if (MacOSFilterHelpers.shouldCoverWholeImage(result)) {
          placeOverlay(image, { ...result, coverWholeImage: true });
          if (result.coverWholeImage) image.dataset.macosFilterStatus = result.personDetected ? "person-detected" : "covered-by-fallback";
        } else {
          // Keep the original gated if the local mask is malformed or Chrome cannot decode it.
          const mask = new Image();
          mask.src = "data:image/png;base64," + result.maskData;
          await mask.decode();
          if (stopped || attempts.get(image)!==attempt || !image.isConnected || (image.currentSrc || image.src)!==url) return;
          placeOverlay(image, result);
          if (silhouettes && overlays.get(image)?.mask) image.dataset.macosFilterStatus = "people-masked";
          else if (!silhouettes) delete image.dataset.macosFilterStatus;
        }
        restoreImage(image);
      } catch (error) {
        if (!stopped && attempts.get(image)===attempt && image.isConnected && currentURL.get(image) === url) {
          coverOnFailure(image, error && error.message);
        }
      }
    }

    // Keep DOM references in the backlog. Only two images per frame can hold
    // capture buffers or wait for native inference at any time.
    const pending = new Set();
    const nearby = new Set();
    let running = 0, scheduled = false;
    const proximity = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && pending.has(entry.target)) nearby.add(entry.target);
        else nearby.delete(entry.target);
      }
      schedule();
    }, {rootMargin: "200px"});
    function schedule() {
      if (scheduled || stopped || running >= 2 || !pending.size) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        while (!stopped && running < 2 && pending.size) {
          const image = nearby.values().next().value || pending.values().next().value;
          pending.delete(image);
          nearby.delete(image);
          proximity.unobserve(image);
          running++;
          processImage(image).finally(() => { running--; schedule(); });
        }
      }, 0);
    }
    function enqueue(image) {
      if (!image.isConnected || currentURL.get(image) === (image.currentSrc || image.src)) return;
      hideImage(image);
      if (!pending.has(image)) {
        pending.add(image);
        proximity.observe(image);
      }
      schedule();
    }

    function watchImage(image) {
      if (!(image instanceof HTMLImageElement)) return;
      if (image.complete && image.naturalWidth>0) {
        enqueue(image);
        return;
      }
      hideImage(image);
      const url=image.currentSrc || image.getAttribute("src");
      // A dynamically inserted img may briefly be complete before the browser
      // has selected or decoded its candidate. Let load/error settle that state.
      if (!silhouettes && image.complete) {coverOnFailure(image,"Image could not be decoded.");return;}
      if (!url && !image.srcset && !image.parentElement?.matches("picture")) {
        removeOverlay(image);
        delete image.dataset.macosFilterStatus;
        restoreImage(image);
        return;
      }
      if (!url || !image.complete || decoding.get(image)===url) return;
      decoding.set(image,url);
      const current=()=>!stopped && image.isConnected && decoding.get(image)===url &&
        (image.currentSrc || image.getAttribute("src"))===url;
      image.decode().then(()=>{
        if (current() && image.naturalWidth) enqueue(image);
      },()=>{
        if (current() && image.complete && !image.naturalWidth) coverOnFailure(image,"Image could not be decoded.");
      }).finally(()=>{if(decoding.get(image)===url) decoding.delete(image);});
    }

    function forget(image) {
      decoding.delete(image);
      pending.delete(image); nearby.delete(image); proximity.unobserve(image);
      attempts.delete(image);
      currentURL.delete(image);
      removeOverlay(image);
      restoreImage(image);
      image.removeAttribute("data-mf-reviewed");
    }

    function scan(node) {
      backgrounds?.scan(node);
      if (silhouettes && node.querySelectorAll) {
        const observeShadow = element => {
          const root=element.shadowRoot;
          if (!root || roots.has(root)) return;
          observeRoot(root);
          scan(root);
        };
        if (node instanceof Element) observeShadow(node);
        for (const element of node.querySelectorAll("*")) observeShadow(element);
      }
      if (node instanceof HTMLImageElement) watchImage(node);
      if (node.querySelectorAll) node.querySelectorAll("img").forEach(watchImage);
    }

    function mutations(records) {
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach(scan);
          record.removedNodes.forEach(node => {
            backgrounds?.remove(node);
            if (node instanceof HTMLImageElement) {
              forget(node);
              if (node.isConnected) watchImage(node);
            }
            if (node.querySelectorAll) node.querySelectorAll("img").forEach(image => {
              forget(image);
              if (image.isConnected) watchImage(image);
            });
          });
        } else if (record.type === "attributes" && ["style","class","role"].includes(record.attributeName)) {
          const target=record.target;
          backgrounds?.inspect(target,record.attributeName==="class");
          if (overlays.has(target)) syncLayer(target);
          else if (target instanceof HTMLElement && target.childElementCount) {
            target.querySelectorAll("img[data-macos-filter-overlay]").forEach(setMaskGeometry);
          }
        } else if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
          attempts.delete(record.target);
          currentURL.delete(record.target);
          watchImage(record.target);
        }
      }
      if (silhouettes && records.some(record=>record.removedNodes.length)) {
        for (const [root,observer] of roots) {
          if (!(root instanceof ShadowRoot) || root.host.isConnected) continue;
          observer.disconnect();
          root.removeEventListener("load",loaded,true);
          root.removeEventListener("error",failed,true);
          root.querySelectorAll("img").forEach(forget);
          backgrounds?.remove(root);
          roots.delete(root);
        }
      }
    }
    function observeRoot(root) {
      const observer=new MutationObserver(mutations);
      roots.set(root,observer);
      root.addEventListener("load",loaded,true);
      root.addEventListener("error",failed,true);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src","srcset","alt","title","aria-label","style","class","role"]
      });
    }

    // Initial on-screen images gate the page. Later images keep individual placeholders.
    let releaseTimer;
    function checkPage() {
      if (stopped || !document.documentElement || document.documentElement.hasAttribute("data-mf-page-ready") || document.readyState === "loading") return;
      if (getComputedStyle(document.documentElement).getPropertyValue("--mf-loading-mode").trim() !== "1") return;
      const pending = Array.from(document.images).some(img => {
        const box=img.getBoundingClientRect();
        return box.width && box.height && box.bottom>0 && box.right>0 && box.top<innerHeight && box.left<innerWidth && !img.hasAttribute("data-mf-reviewed");
      });
      if (!pending) document.documentElement.setAttribute("data-mf-page-ready","");
      else releaseTimer=setTimeout(checkPage,80);
    }
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",checkPage,{once:true});
    else checkPage();
    const deadline=setTimeout(()=>document.documentElement?.setAttribute("data-mf-page-ready",""),8000);

    // The filter moves with its image. ResizeObserver handles size changes;
    // capturing load also catches responsive candidates selected by Chrome.
    const loaded = event => {
      if (event.target instanceof HTMLImageElement) enqueue(event.target);
    };
    const failed = event => {
      if (event.target instanceof HTMLImageElement) coverOnFailure(event.target, "Image load failed.");
    };
    observeRoot(document);
    scan(document);

    state.summary = silhouettes ? () => {
      const counts={masked:0,clear:0,unscanned:0,pending:0};
      for (const root of roots.keys()) {
        for (const el of root.querySelectorAll("img,[data-macos-filter-background]")) {
          const states=[];
          if (el instanceof HTMLImageElement) states.push(el.dataset.macosFilterStatus);
          if (el.hasAttribute("data-macos-filter-background")) states.push(el.dataset.macosFilterBackground);
          for (const status of states) {
            if (status==="people-masked") counts.masked++;
            else if (status==="no-person-detected") counts.clear++;
            else if (status==="unscanned") counts.unscanned++;
            else counts.pending++;
          }
        }
      }
      return counts;
    } : null;
    state.stop = () => {
      state.summary=null;
      stopped = true;
      clearTimeout(deadline); clearTimeout(releaseTimer);
      document.documentElement?.setAttribute("data-mf-page-ready","");
      for (const observer of roots.values()) observer.disconnect();
      sizes.disconnect();
      proximity.disconnect(); pending.clear(); nearby.clear();
      document.querySelectorAll('img').forEach(image => { restoreImage(image); delete image.dataset.macosFilterStatus; delete image.dataset.macosFilterReason; });
      for (const image of watched) {
        removeOverlay(image);
        restoreImage(image);
        delete image.dataset.macosFilterStatus;
      }
      watched.clear();
      backgrounds?.stop();
      for (const root of roots.keys()) {
        root.removeEventListener("load", loaded, true);
        root.removeEventListener("error", failed, true);
        root.querySelectorAll("img").forEach(img=>{restoreImage(img);delete img.dataset.macosFilterStatus;delete img.dataset.macosFilterReason;});
      }
      roots.clear();
      state.active = false;
      state.stop = null;
    };
  }

  function syncEnabled(enabled,silhouettes) {
    document.documentElement?.toggleAttribute("data-mf-paused", !enabled);
    if (enabled) startFiltering(silhouettes);
    else if (state.stop) state.stop();
  }

  let revision=0;
  async function refresh() {
    const sequence=++revision;
    const {enabled,siteRules,policy} = await chrome.storage.local.get(["enabled","siteRules","policy"]);
    if (sequence!==revision) return;
    const rules=FilterPolicy.parse(siteRules);
    const {excluded,profile}=FilterPolicy.pageRules(rules,location.hostname,FilterPolicy.topHostname());
    state.stop?.();
    const mode=profile?.mode || (policy && JSON.parse(policy).mode);
    syncEnabled(enabled && !excluded,mode === "peopleOnly");
  }
  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.siteRules || changes.policy)) refresh();
  });
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (message?.type==="silhouetteSummary" && state.summary && sender.url===chrome.runtime.getURL("popup.html")) {
      reply(state.summary());
      return false;
    }
    if (message && message.type === "disableFiltering") syncEnabled(false);
  });
})();
