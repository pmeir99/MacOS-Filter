(() => {
  if (globalThis.__macOSFilterInstalled) return;
  globalThis.__macOSFilterInstalled = true;

  const originalVisibility = new WeakMap();
  const currentURL = new WeakMap();
  const overlays = new WeakMap();
  const watched = new Set();

  function hideImage(image) {
    if (!originalVisibility.has(image)) {
      originalVisibility.set(image, {
        value: image.style.getPropertyValue("visibility"),
        priority: image.style.getPropertyPriority("visibility")
      });
    }
    image.style.setProperty("visibility", "hidden", "important");
  }

  function restoreImage(image) {
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
      overlay.style.maskImage = maskURL;
      overlay.style.maskRepeat = "no-repeat";
      overlay.style.maskSize = "100% 100%";
      overlay.style.webkitMaskImage = maskURL;
      overlay.style.webkitMaskRepeat = "no-repeat";
      overlay.style.webkitMaskSize = "100% 100%";
    }
    if (result.settings.overlayStyle === "blur") {
      overlay.style.backgroundColor = "rgba(0,0,0,0.12)";
      overlay.style.backdropFilter = "blur(24px)";
      overlay.style.webkitBackdropFilter = "blur(24px)";
    }

    document.documentElement.appendChild(overlay);
    overlays.set(image, overlay);

    const update = () => {
      if (!image.isConnected || !overlay.isConnected) {
        overlay.remove();
        return;
      }
      const rect = image.getBoundingClientRect();
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
    };
    update();
    watched.add(image);
  }

  function coverOnFailure(image, errorMessage) {
    placeOverlay(image, {
      ok: false,
      coverWholeImage: true,
      settings: { overlayColor: "#000000", overlayStyle: "solid", opacity: 1 }
    });
    if (errorMessage) image.dataset.macosFilterStatus = "blocked-local-filter-error";
  }

  async function processImage(image) {
    if (!(image instanceof HTMLImageElement) || !image.isConnected) return;
    const url = image.currentSrc || image.src;
    if (!url || currentURL.get(image) === url || !MacOSFilterHelpers.isSupportedImageURL(url)) return;
    currentURL.set(image, url);
    hideImage(image);
    removeOverlay(image);

    try {
      const result = await chrome.runtime.sendMessage({ type: "filterImage", url });
      if (!image.isConnected || currentURL.get(image) !== url) return;
      if (!result || !result.settings || !result.settings.enabled) {
        coverOnFailure(image, result && result.error);
        return;
      }
      result.settings = MacOSFilterHelpers.normalizeSettings(result.settings);
      if (MacOSFilterHelpers.shouldCoverWholeImage(result)) {
        placeOverlay(image, { ...result, coverWholeImage: true });
      } else {
        placeOverlay(image, result);
      }
      delete image.dataset.macosFilterStatus;
      restoreImage(image);
    } catch (error) {
      if (image.isConnected && currentURL.get(image) === url) {
        coverOnFailure(image, error && error.message);
        restoreImage(image);
      }
    }
  }

  function watchImage(image) {
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.complete || image.naturalWidth === 0) {
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

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach(scan);
        record.removedNodes.forEach(node => {
          if (node instanceof HTMLImageElement) {
            removeOverlay(node);
            restoreImage(node);
            watched.delete(node);
          }
          if (node.querySelectorAll) node.querySelectorAll("img").forEach(image => {
            removeOverlay(image);
            restoreImage(image);
            watched.delete(image);
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
      const overlay = overlays.get(image);
      if (!image.isConnected) {
        removeOverlay(image);
        watched.delete(image);
      } else if (overlay) {
        const rect = image.getBoundingClientRect();
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
      }
    }
  };
  addEventListener("scroll", updateAll, { passive: true, capture: true });
  addEventListener("resize", updateAll, { passive: true });

  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === "disableFiltering") {
      observer.disconnect();
      for (const image of watched) {
        removeOverlay(image);
        restoreImage(image);
        delete image.dataset.macosFilterStatus;
      }
      watched.clear();
    }
  });
})();
