globalThis.FilterPolicy = (() => {
  function lines(value) {
    return [...new Set(String(value || "").split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  }
  function domains(value) {
    const hosts = lines(value);
    if (hosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host))) throw Error("Enter one domain per line, without a URL or wildcard.");
    return hosts;
  }
  function parse(input = {}) {
    const profiles = (input.profiles || []).map(profile => {
      const hosts = domains(profile.site);
      const modes = ["adaptive","skin","policy","allPeople","faces","personBlur","entireImage"];
      if (hosts.length !== 1 || !modes.includes(profile.mode)) throw Error("Choose a domain and an image mode.");
      const cutoff = Number(profile.cutoff);
      if (!Number.isFinite(cutoff) || cutoff < 0.1 || cutoff > 0.95) throw Error("Choose a cutoff between 0.10 and 0.95.");
      return {site:hosts[0],mode:profile.mode,cutoff};
    }).sort((a,b) => b.site.length-a.site.length);
    if (new Set(profiles.map(p=>p.site)).size !== profiles.length) throw Error("Each domain can have one image profile.");
    return { profiles, blocked: domains(input.blocked), excluded: domains(input.excluded), phrases: lines(input.phrases), products: lines(input.products), sitePhrases: lines(input.sitePhrases).map(row => {
      const split = row.indexOf('|');
      if (split < 1 || !row.slice(split+1).trim()) throw Error('Use domain | phrase for each site rule.');
      return {site:domains(row.slice(0,split))[0], phrase:row.slice(split+1).trim()};
    }) };
  }
  function excludes(host, sites) {
    return sites.some(site => host === site || host.endsWith("." + site));
  }
  function pattern(phrases) {
    if (!phrases.length) return null;
    const literal = phrases.slice().sort((a,b) => b.length-a.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
    return new RegExp("(?<![\\p{L}\\p{N}_])(?:" + literal + ")(?![\\p{L}\\p{N}_])","giu");
  }
  return { parse, excludes, pattern };
})();
