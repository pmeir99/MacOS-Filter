// Paint in the requesting document; the MV3 worker only transports input and the native mask.
globalThis.BackgroundPaint = (() => {
  async function decode(dataURL) {
    const image=new Image();
    image.decoding="sync";
    let timer;
    try {
      image.src=dataURL;
      await Promise.race([image.decode(),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error("Background image decoding timed out.")),8000);
      })]);
      return image;
    } finally {clearTimeout(timer);}
  }
  function layer(width,height) {
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    return canvas.getContext("2d",{willReadFrequently:true});
  }
  async function render(bytes,mask,settings) {
    // Browser image decoders sniff the original raster format from its bytes.
    const [photo,matte]=await Promise.all([decode("data:image/png;base64,"+bytes),decode("data:image/png;base64,"+mask)]);
    const w=photo.naturalWidth,h=photo.naturalHeight;
    if (!w || !h || w*h>4_000_000) throw Error("Background exceeds the paint budget.");
    const paint=layer(w,h);
    if (settings.overlayStyle==="blur") {
      paint.filter="blur("+settings.blurRadius+"px)";
      paint.drawImage(photo,0,0);
      paint.filter="none";
    } else {
      paint.globalAlpha=settings.opacity;
      paint.fillStyle=settings.overlayColor;
      paint.fillRect(0,0,w,h);
      paint.globalAlpha=1;
    }
    paint.globalCompositeOperation="destination-in";
    paint.drawImage(matte,0,0,w,h);
    const output=layer(w,h);
    output.drawImage(photo,0,0);
    output.globalCompositeOperation="source-atop";
    output.drawImage(paint.canvas,0,0);
    const dataURL=output.canvas.toDataURL("image/png");
    if (!dataURL.startsWith("data:image/png;base64,") || dataURL.length>11184850) throw Error("Background exceeds the paint budget.");
    return dataURL;
  }
  return {decode,render};
})();
