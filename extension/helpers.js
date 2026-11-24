(() => {
  const validColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  const normalizeSettings = settings => {
    const opacity = Number(settings && settings.opacity);
    return {
      enabled: Boolean(settings && settings.enabled),
      mode: settings && settings.mode === "entireImage" ? "entireImage" : "allPeople",
      overlayStyle: settings && settings.overlayStyle === "blur" ? "blur" : "solid",
      overlayColor: validColor(settings && settings.overlayColor) ? settings.overlayColor : "#000000",
      opacity: Number.isFinite(opacity) ? Math.max(0.25, Math.min(1, opacity)) : 1
    };
  };
  const shouldCoverWholeImage = response =>
    !response || response.ok !== true || response.coverWholeImage === true || !response.maskData;
  const isSupportedImageURL = value => {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        !parsed.username && !parsed.password;
    } catch (_) {
      return false;
    }
  };
  globalThis.MacOSFilterHelpers = Object.freeze({
    normalizeSettings,
    shouldCoverWholeImage,
    isSupportedImageURL
  });
})();
