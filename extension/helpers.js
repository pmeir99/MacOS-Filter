(() => {
  const validColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

  const normalizeSettings = settings => {
    const opacity = Number(settings && settings.opacity);
    return {
      enabled: Boolean(settings && settings.enabled),
      mode: settings && ["entireImage","faces","adaptive","allPeople"].includes(settings.mode) ? settings.mode : "allPeople",
      overlayStyle: settings && settings.overlayStyle === "blur" ? "blur" : "solid",
      overlayColor: validColor(settings && settings.overlayColor) ? settings.overlayColor : "#000000",
      opacity: Number.isFinite(opacity) ? Math.max(0.25, Math.min(1, opacity)) : 1
    };
  };

  const shouldCoverWholeImage = response =>
    !response || response.ok !== true || response.coverWholeImage === true || !response.maskData;

  const isSupportedImageURL = value => {
    if (typeof value !== "string") return false;
    if (value.startsWith("data:image/")) return value.length <= 11_200_000;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        !parsed.username && !parsed.password;
    } catch (_) {
      return false;
    }
  };

  const positionFactor = value => {
    const token = (value || "50%").trim().toLowerCase();
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return 1;
    if (token === "center") return 0.5;
    if (token.endsWith("%")) {
      const percent = Number.parseFloat(token);
      return Number.isFinite(percent) ? Math.max(0, Math.min(1, percent / 100)) : 0.5;
    }
    return 0.5;
  };

  const objectPositionFactors = value => {
    const tokens = (value || "50% 50%").trim().split(/\s+/);
    if (tokens.length === 1) tokens.push("50%");
    return [positionFactor(tokens[0]), positionFactor(tokens[1])];
  };

  const maskGeometry = (boxWidth, boxHeight, imageWidth, imageHeight, fit, position) => {
    if (![boxWidth, boxHeight, imageWidth, imageHeight].every(Number.isFinite) ||
        boxWidth <= 0 || boxHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
    const mode = fit || "fill";
    let scaleX = boxWidth / imageWidth;
    let scaleY = boxHeight / imageHeight;
    if (mode === "contain") {
      scaleX = scaleY = Math.min(scaleX, scaleY);
    } else if (mode === "cover") {
      scaleX = scaleY = Math.max(scaleX, scaleY);
    } else if (mode === "none") {
      scaleX = scaleY = 1;
    } else if (mode === "scale-down") {
      scaleX = scaleY = Math.min(1, Math.min(scaleX, scaleY));
    }
    const maskWidth = mode === "fill" ? boxWidth : imageWidth * scaleX;
    const maskHeight = mode === "fill" ? boxHeight : imageHeight * scaleY;
    const factors = objectPositionFactors(position);
    return {
      width: maskWidth,
      height: maskHeight,
      left: (boxWidth - maskWidth) * factors[0],
      top: (boxHeight - maskHeight) * factors[1]
    };
  };

  globalThis.MacOSFilterHelpers = Object.freeze({
    normalizeSettings,
    shouldCoverWholeImage,
    isSupportedImageURL,
    maskGeometry
  });
})();
