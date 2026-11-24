// Render a CSS background independently of its owner's text, badges and child elements.
globalThis.BackgroundPaint = (() => {
  function blobFromBase64(value, type) {
    return new Blob([Uint8Array.from(atob(value), ch=>ch.charCodeAt(0))], {type});
  }
  async function render(bytes, mask, settings) {
    const photo = await createImageBitmap(blobFromBase64(bytes,"application/octet-stream"));
    try {
      if (photo.width*photo.height > 4_000_000) throw Error("Background exceeds the paint budget.");
      const matte = await createImageBitmap(blobFromBase64(mask,"image/png"));
      try {
        const canvas = new OffscreenCanvas(photo.width,photo.height);
        const ctx = canvas.getContext("2d");
        if (settings.overlayStyle === "blur") {
          ctx.filter = "blur("+settings.blurRadius+"px)";
          ctx.drawImage(photo,0,0);
          ctx.filter = "none";
        } else {
          ctx.globalAlpha = settings.opacity;
          ctx.fillStyle = settings.overlayColor;
          ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(matte,0,0,canvas.width,canvas.height);
        const output = new OffscreenCanvas(photo.width,photo.height);
        const composite = output.getContext("2d");
        composite.drawImage(photo,0,0);
        composite.globalCompositeOperation = "source-atop";
        composite.drawImage(canvas,0,0);
        const blob = await output.convertToBlob({type:"image/png"});
        if (blob.size > 8*1024*1024) throw Error("Background exceeds the paint budget.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const chunks = [];
        for (let i=0;i<bytes.length;i+=8192) chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
        return "data:image/png;base64,"+btoa(chunks.join(""));
      } finally { matte.close(); }
    } finally { photo.close(); }
  }
  return {render};
})();
