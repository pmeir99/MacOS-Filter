(() => {
  if (globalThis.__macOSFilterBootstrap) return;
  const state = { active: false, stop: null };
  globalThis.__macOSFilterBootstrap = state;

  function startFiltering() {
    if (state.active) return;
    state.active = true;

    let stopped = false;
    const originalVisibility = new WeakMap();
    const currentURL = new WeakMap();
    const attempts = new WeakMap();
    const overlays = new WeakMap();
    const watched = new Set();
    let observer = null;

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
      sizes.unobserve(image);
      layer.svg.remove();
      overlays.delete(image);
      watched.delete(image);
      image.removeAttribute("data-macos-filter-overlay");
    }

    function setMaskGeometry(image) {
      const layer = overlays.get(image);
      if (!layer?.mask) return;
      const style = getComputedStyle(image);
      const x = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const y = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      const width = image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const g = MacOSFilterHelpers.maskGeometry(width,height,image.naturalWidth,image.naturalHeight,style.objectFit,style.objectPosition);
      if (!g) {
        // A hidden/zero-size image may become visible later, at which point resize reruns.
        if (width > 0 && height > 0) coverOnFailure(image, "Unsupported image crop.");
        return;
      }
      for (const [key,value] of Object.entries({x:x+g.left,y:y+g.top,width:g.width,height:g.height})) layer.mask.setAttribute(key,value);
    }

    function placeOverlay(image, result) {
      removeOverlay(image);
      const id = "mf-" + Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
      const resource = svg("svg",{width:0,height:0,"aria-hidden":"true"});
      resource.style.cssText="position:absolute!important;width:0!important;height:0!important;pointer-events:none!important";
      const filter = svg("filter",{id,x:"0%",y:"0%",width:"100%",height:"100%","color-interpolation-filters":"sRGB"});
      const partial = !MacOSFilterHelpers.shouldCoverWholeImage(result);
      const blur = result.settings.overlayStyle === "blur";
      filter.append(blur ? svg("feGaussianBlur",{in:"SourceGraphic",stdDeviation:result.settings.blurRadius || 16,edgeMode:"duplicate",result:"paint"})
                         : svg("feFlood",{"flood-color":result.settings.overlayColor,"flood-opacity":result.settings.opacity,result:"paint"}));
      let mask;
      if (partial) {
        mask=svg("feImage",{href:"data:image/png;base64,"+result.maskData,preserveAspectRatio:"none",result:"region"});
        filter.append(mask,svg("feComposite",{in:"paint",in2:"region",operator:"in",result:"selected"}));
      }
      filter.append(svg("feComposite",{in:partial?"selected":"paint",in2:"SourceGraphic",operator:"over"}));
      resource.append(filter);
      document.documentElement.append(resource);
      const original=image.style.getPropertyValue("filter"), priority=image.style.getPropertyPriority("filter");
      const previous=getComputedStyle(image).filter;
      image.style.setProperty("filter","url(\"#"+id+"\")"+(previous==="none"?"":" "+previous),"important");
      const previousContent=image.style.getPropertyValue("content"), contentPriority=image.style.getPropertyPriority("content");
      let frozen;
      if (partial && result.snapshot) {
        image.style.setProperty("content",'url("'+result.snapshot+'")',"important");
        frozen=image.style.getPropertyValue("content");
      }
      overlays.set(image,{frozen,previousContent,contentPriority,svg:resource,mask,original,priority,applied:image.style.getPropertyValue("filter")});
      image.setAttribute("data-macos-filter-overlay","true");
      watched.add(image);
      if (partial) sizes.observe(image);
      setMaskGeometry(image);
    }

    function coverOnFailure(image, errorMessage) {
      if (stopped) return;
      placeOverlay(image, {
        ok: false,
        coverWholeImage: true,
        settings: { overlayColor: "#000000", overlayStyle: "solid", opacity: 1 }
      });
      if (errorMessage) image.dataset.macosFilterStatus = "blocked-local-filter-error";
      restoreImage(image);
    }

    async function processImage(image) {
      if (stopped || !(image instanceof HTMLImageElement) || !image.isConnected) return;
      const url = image.currentSrc || image.src;
      if (!url || currentURL.get(image) === url) return;
      const attempt = Symbol();
      attempts.set(image,attempt);
      currentURL.set(image, url);
      hideImage(image);
      removeOverlay(image);

      try {
        const message = {type:"filterImage", description:[image.alt,image.title,image.getAttribute("aria-label")].filter(Boolean).join(" ").slice(0,4096)};
        let result = await chrome.runtime.sendMessage(message);
        if (result?.needsPixels) {
          if (stopped || attempts.get(image)!==attempt || !image.isConnected || (image.currentSrc || image.src) !== url) return;
          let snapshot;
          if (/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(url)) {
            message.imageData=url.slice(url.indexOf(",")+1);
          } else {
            const width=image.naturalWidth, height=image.naturalHeight;
            if (!width || !height || width*height>4000000) throw Error("Image exceeds local capture budget.");
            const canvas=document.createElement("canvas");
            canvas.width=width; canvas.height=height;
            canvas.getContext("2d").drawImage(image,0,0,width,height);
            snapshot=canvas.toDataURL("image/png");
            message.imageData=snapshot.slice(snapshot.indexOf(",")+1);
          }
          if (message.imageData.length>11184812) throw Error("Image exceeds local transport budget.");
          result=await chrome.runtime.sendMessage(message);
          if (result) result.snapshot=snapshot;
        }
        if (stopped || attempts.get(image)!==attempt || !image.isConnected || (image.currentSrc || image.src)!==url || currentURL.get(image) !== url) return;
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
        if (MacOSFilterHelpers.shouldCoverWholeImage(result)) {
          placeOverlay(image, { ...result, coverWholeImage: true });
          if (result.coverWholeImage) image.dataset.macosFilterStatus = "covered-by-fallback";
        } else {
          placeOverlay(image, result);
          delete image.dataset.macosFilterStatus;
        }
        restoreImage(image);
      } catch (error) {
        if (!stopped && attempts.get(image)===attempt && image.isConnected && currentURL.get(image) === url) {
          coverOnFailure(image, error && error.message);
        }
      }
    }

    function watchImage(image) {
      if (!(image instanceof HTMLImageElement)) return;
      if (image.complete && image.naturalWidth === 0) {
        hideImage(image);
        coverOnFailure(image, "Image could not be decoded.");
      } else if (!image.complete || image.naturalWidth === 0) {
        hideImage(image);

      } else {
        processImage(image);
      }
    }

    function forget(image) {
      attempts.delete(image);
      currentURL.delete(image);
      removeOverlay(image);
      restoreImage(image);
      image.removeAttribute("data-mf-reviewed");
    }

    function scan(node) {
      if (node instanceof HTMLImageElement) watchImage(node);
      if (node.querySelectorAll) node.querySelectorAll("img").forEach(watchImage);
    }

    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach(scan);
          record.removedNodes.forEach(node => {
            if (node instanceof HTMLImageElement) {
              forget(node);
              if (node.isConnected) watchImage(node);
            }
            if (node.querySelectorAll) node.querySelectorAll("img").forEach(image => {
              forget(image);
              if (image.isConnected) watchImage(image);
            });
          });
        } else if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
          attempts.delete(record.target);
          currentURL.delete(record.target);
          watchImage(record.target);
        }
      }
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset","alt","title","aria-label"]
    });
    scan(document);
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
      if (event.target instanceof HTMLImageElement) processImage(event.target);
    };
    const failed = event => {
      if (event.target instanceof HTMLImageElement) coverOnFailure(event.target, "Image load failed.");
    };
    document.addEventListener("load", loaded, true);
    document.addEventListener("error", failed, true);

    state.stop = () => {
      stopped = true;
      clearTimeout(deadline); clearTimeout(releaseTimer);
      document.documentElement?.setAttribute("data-mf-page-ready","");
      observer.disconnect();
      sizes.disconnect();
      document.querySelectorAll('img').forEach(restoreImage);
      for (const image of watched) {
        removeOverlay(image);
        restoreImage(image);
        delete image.dataset.macosFilterStatus;
      }
      watched.clear();
      document.removeEventListener("load", loaded, true);
      document.removeEventListener("error", failed, true);
      state.active = false;
      state.stop = null;
    };
  }

  function syncEnabled(enabled) {
    document.documentElement?.toggleAttribute("data-mf-paused", !enabled);
    if (enabled) startFiltering();
    else if (state.stop) state.stop();
  }

  chrome.storage.local.get("enabled", value => syncEnabled(Boolean(value.enabled)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) syncEnabled(Boolean(changes.enabled.newValue));
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === "disableFiltering") syncEnabled(false);
  });
})();
