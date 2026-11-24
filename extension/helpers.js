(() => {
  const validColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

  const normalizeSettings = settings => {
    const opacity = Number(settings && settings.opacity);
    return {
      enabled: Boolean(settings && settings.enabled),
      mode: settings && ["personBlur","entireImage","faces","adaptive","skin","policy","allPeople"].includes(settings.mode) ? settings.mode : "allPeople",
      overlayStyle: settings && settings.overlayStyle === "blur" ? "blur" : "solid",
      ...(Number.isFinite(settings?.blurRadius) ? {blurRadius:Math.min(40,Math.max(4,settings.blurRadius))} : {}),
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

  // Chromium serializes edge offsets as pixels or simple percentage +/- pixel calc().
  const offset = (token, space) => {
    if (token === "center") return space/2;
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return space;
    if (/^-?[\d.]+%$/.test(token)) return space*parseFloat(token)/100;
    if (/^-?[\d.]+px$/.test(token)) return parseFloat(token);
    const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/.exec(token);
    return calc ? space*Number(calc[1])/100 + (calc[2]==="-"?-1:1)*Number(calc[3]) : NaN;
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
    let tokens = String(position || "50% 50%").match(/calc\([^)]*\)|[^\s]+/g) || [];
    if(tokens.length === 1) tokens = ["top","bottom"].includes(tokens[0]) ? ["center",tokens[0]] : [tokens[0],"center"];
    if(tokens.length !== 2) return null;
    const left=offset(tokens[0],boxWidth-maskWidth), top=offset(tokens[1],boxHeight-maskHeight);
    if(!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return {
      width: maskWidth,
      height: maskHeight,
      left, top
    };
  };

  globalThis.MacOSFilterHelpers = Object.freeze({
    normalizeSettings,
    shouldCoverWholeImage,
    isSupportedImageURL,
    maskGeometry
  });
})();
