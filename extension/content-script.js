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

    function removeOverlay(image) {
      const overlay = overlays.get(image);
      if (overlay) overlay.remove();
      overlays.delete(image);
      watched.delete(image);
    }

    function setMaskGeometry(image, overlay) {
      const rect = image.getBoundingClientRect();
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";

      if (overlay.dataset.personMask === "true") {
        const style = getComputedStyle(image);
        const geometry = MacOSFilterHelpers.maskGeometry(
          rect.width,
          rect.height,
          image.naturalWidth,
          image.naturalHeight,
          style.objectFit,
          style.objectPosition
        );
        if (geometry) {
          const size = geometry.width + "px " + geometry.height + "px";
          const position = geometry.left + "px " + geometry.top + "px";
          overlay.style.maskSize = size;
          overlay.style.maskPosition = position;
          overlay.style.webkitMaskSize = size;
          overlay.style.webkitMaskPosition = position;
        }
      }
    }

    function placeOverlay(image, result) {
      removeOverlay(image);
      const overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      overlay.dataset.macosFilterOverlay = "true";
      overlay.style.position = "fixed";
      overlay.style.zIndex = "2147483647";
      overlay.style.pointerEvents = "none";
      overlay.style.boxSizing = "border-box";
      overlay.style.backgroundColor = result.settings.overlayColor;
      overlay.style.opacity = String(result.settings.opacity);
      overlay.style.overflow = "hidden";

      if (!MacOSFilterHelpers.shouldCoverWholeImage(result)) {
        const maskURL = "url(data:image/png;base64," + result.maskData + ")";
        overlay.dataset.personMask = "true";
        overlay.style.maskImage = maskURL;
        overlay.style.maskRepeat = "no-repeat";
        overlay.style.webkitMaskImage = maskURL;
        overlay.style.webkitMaskRepeat = "no-repeat";
      }
      if (result.settings.overlayStyle === "blur") {
        overlay.style.backgroundColor = "rgba(0,0,0,0.18)";
        overlay.style.backdropFilter = "blur(24px)";
        overlay.style.webkitBackdropFilter = "blur(24px)";
      }

      document.documentElement.appendChild(overlay);
      overlays.set(image, overlay);
      watched.add(image);
      setMaskGeometry(image, overlay);
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
      currentURL.set(image, url);
      hideImage(image);
      removeOverlay(image);

      if (!MacOSFilterHelpers.isSupportedImageURL(url)) {
        coverOnFailure(image, "Unsupported image source.");
        return;
      }

      try {
        const result = await chrome.runtime.sendMessage({ type: "filterImage", url });
        if (stopped || !image.isConnected || currentURL.get(image) !== url) return;
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
        if (!stopped && image.isConnected && currentURL.get(image) === url) {
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
        image.addEventListener("load", () => processImage(image), { once: true });
        image.addEventListener("error", () => coverOnFailure(image, "Image load failed."), { once: true });
      } else {
        processImage(image);
      }
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
              removeOverlay(node);
              restoreImage(node);
            }
            if (node.querySelectorAll) node.querySelectorAll("img").forEach(image => {
              removeOverlay(image);
              restoreImage(image);
            });
          });
        } else if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
          currentURL.delete(record.target);
          watchImage(record.target);
        }
      }
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"]
    });
    scan(document);

    const updateAll = () => {
      for (const image of watched) {
        if (!image.isConnected) {
          removeOverlay(image);
          continue;
        }
        const current = image.currentSrc || image.src;
        if (currentURL.get(image) !== current) {
          currentURL.delete(image);
          processImage(image);
          continue;
        }
        const overlay = overlays.get(image);
        if (overlay) setMaskGeometry(image, overlay);
      }
    };
    addEventListener("scroll", updateAll, { passive: true, capture: true });
    addEventListener("resize", updateAll, { passive: true });

    state.stop = () => {
      stopped = true;
      observer.disconnect();
      document.querySelectorAll('img').forEach(restoreImage);
      for (const image of watched) {
        removeOverlay(image);
        restoreImage(image);
        delete image.dataset.macosFilterStatus;
      }
      watched.clear();
      removeEventListener("scroll", updateAll, true);
      removeEventListener("resize", updateAll);
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
