// Only the media CDNs of the originating site may be re-read. Private timelines,
// authenticated assets, redirects and arbitrary destinations have no fetch path.
globalThis.PublicMedia = (() => {
  function eligible(source, page) {
    try {
      const site = new URL(page), image = new URL(source);
      if (site.protocol !== "https:" || site.port || image.username || image.password || image.hash) return false;
      if (/^(?:[a-z0-9-]+\.)*wikipedia\.org$/.test(site.hostname)) {
        return ["https://thumb.wikimedia.org","https://upload.wikimedia.org"].includes(image.origin) &&
          [...image.searchParams].every(([key,value]) =>
            (key==="utm_source" && value===site.hostname) || (key==="utm_campaign" && value==="parser") ||
            (key==="utm_content" && value==="thumbnail")) &&
          /^\/wikipedia\/(?:commons|[a-z0-9-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/.+\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname);
      }
      return ["x.com","www.x.com","mobile.x.com","twitter.com","www.twitter.com"].includes(site.hostname) &&
        image.origin === "https://pbs.twimg.com" &&
        /^\/(?:profile_banners\/\d+\/\d+\/\d+x\d+|media\/[\w-]+(?:\.(?:jpe?g|png|webp))?|profile_images\/\d+\/[\w.-]+\.(?:jpe?g|png|webp))$/i.test(image.pathname) &&
        [...image.searchParams].every(([key,value]) =>
          (key === "format" && /^(?:jpe?g|png|webp|avif)$/i.test(value)) ||
          (key === "name" && /^(?:tiny|small|medium|large|orig|\d+x\d+)$/.test(value)));
    } catch { return false; }
  }
  return {eligible};
})();
