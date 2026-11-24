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
    return { blocked: domains(input.blocked), excluded: domains(input.excluded), phrases: lines(input.phrases) };
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