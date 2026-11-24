// Only public Google Search thumbnail identifiers can reach this request path.
globalThis.GoogleThumbnails = (() => {
  function eligible(source, page) {
    try {
      const origin = new URL(page);
      const image = new URL(source);
      return origin.origin === "https://www.google.com" && origin.pathname === "/search" &&
        /^https:\/\/encrypted-tbn[0-3]\.gstatic\.com$/.test(image.origin) &&
        !image.username && !image.password && !image.hash && image.pathname === "/images" &&
        image.searchParams.getAll("q").length === 1 &&
        /^tbn:[a-zA-Z0-9_-]{1,512}$/.test(image.searchParams.get("q")) &&
        [...image.searchParams].every(([key,value]) => key==="q" || (key==="s" && /^\d{0,3}$/.test(value)));
    } catch { return false; }
  }

  async function read(url, limit = 1024*1024) {
    const response = await fetch(url, {credentials:"omit", referrerPolicy:"no-referrer", redirect:"error",
      cache:"force-cache", signal:AbortSignal.timeout(10000)});
    if (!response.ok || !/^image\/(jpeg|png|webp|avif)(?:;|$)/i.test(response.headers.get("content-type") || "") ||
        Number(response.headers.get("content-length")) > limit || !response.body) {
      await response.body?.cancel();
      throw Error("Google thumbnail unavailable.");
    }
    const reader=response.body.getReader();
    const chunks=[];
    let length=0;
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        length+=value.length;
        if(length>limit){ await reader.cancel(); throw Error("Google thumbnail exceeds the local budget."); }
        for(let i=0;i<value.length;i+=8192) chunks.push(String.fromCharCode(...value.subarray(i,i+8192)));
      }
    } finally { reader.releaseLock(); }
    if (!length) throw Error("Empty Google thumbnail.");
    return btoa(chunks.join(""));
  }
  return {eligible,read};
})();
