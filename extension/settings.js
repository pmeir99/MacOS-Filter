// Run in the worker and options page. Keys match the settings imported from 0.4.33.
globalThis.FilterSettings = (() => {
  const modes = ["allPeople","peopleOnly","personBlur","entireImage","adaptive","faces","skin","policy"];
  const defaults = {
    publicMedia:false, enabled:true, mode:"allPeople", overlayStyle:"solid", overlayColor:"#000000", opacity:1,
    blurRadius:16, blockThreshold:0.7, fullLevel:2, maskLevel:5, appearance:"all",
    includeFace:true, paintSkin:false, products:[],
    siteRules:{presentation:"placeholders",blocked:"",excluded:"",phrases:"",sitePhrases:"",products:"",profiles:[]}
  };
  function read(input = {}) {
    const settings = {...defaults,...input,siteRules:{...defaults.siteRules,...input.siteRules}};
    FilterPolicy.parse(settings.siteRules);
    const oneOf = (value, allowed) => allowed.includes(value);
    if (!oneOf(settings.mode,modes) || !oneOf(settings.overlayStyle,["solid","blur"]) ||
        !oneOf(settings.appearance,["all","masculine","feminine"]) ||
        !oneOf(settings.siteRules.presentation,["loading","placeholders"]) ||
        !/^#[a-f0-9]{6}$/i.test(settings.overlayColor) ||
        !Array.isArray(settings.products) || !settings.products.every(item=>oneOf(item,["underwear","adult","menstrual"])))
      throw Error("Choose a supported filtering option.");
    for (const key of ["enabled","publicMedia","paintSkin","includeFace"])
      if (typeof settings[key]!=="boolean") throw Error("Invalid switch value.");
    for (const [key,min,max] of [["opacity",0.25,1],["blurRadius",4,40],["blockThreshold",0.1,0.95],["fullLevel",1,7],["maskLevel",1,7]]) {
      if (!Number.isFinite(settings[key]) || settings[key]<min || settings[key]>max) throw Error("Value outside the supported range.");
    }
    if (![settings.fullLevel,settings.maskLevel].every(Number.isInteger)) throw Error("Choose one of the seven levels.");
    return settings;
  }
  const modeNames = {peopleOnly:"Mask people only",personBlur:"Blur images containing people",allPeople:"All detected people",faces:"Faces",entireImage:"Entire image",adaptive:"Adaptive",skin:"Skin mask (experimental)",policy:"Seven levels (experimental)"};
  function siteState(settings, host) {
    const rules=FilterPolicy.parse(settings.siteRules);
    const excludedBy=rules.excluded.find(site=>site!==host && FilterPolicy.excludes(host,[site])) ||
      rules.excluded.find(site=>site===host);
    const own=rules.profiles.find(p=>p.site===host);
    const parent=rules.profiles.find(p=>p.site!==host && FilterPolicy.excludes(host,[p.site]));
    return {paused:Boolean(excludedBy),excludedBy,mode:own?.mode || "",inheritedMode:parent?.mode || settings.mode};
  }
  function editSite(settings, host, field, value) {
    if (!host || host!==host.toLowerCase() || FilterPolicy.parse({excluded:host}).excluded[0]!==host)
      throw Error("This page does not support website rules.");
    const state=siteState(settings,host), rules={...settings.siteRules};
    if (field==="enabled" && typeof value==="boolean") {
      if (state.excludedBy && state.excludedBy!==host) throw Error("This site inherits an exclusion from "+state.excludedBy+".");
      const domains=FilterPolicy.parse(rules).excluded.filter(site=>site!==host);
      if (!value) domains.push(host);
      rules.excluded=domains.join("\n");
    } else if (field==="mode" && (value==="" || modes.includes(value))) {
      const profiles=FilterPolicy.parse(rules).profiles;
      const existing=profiles.find(p=>p.site===host);
      const inherited=profiles.find(p=>FilterPolicy.excludes(host,[p.site]));
      rules.profiles=profiles.filter(p=>p.site!==host);
      if (value) rules.profiles.push({site:host,mode:value,cutoff:existing?.cutoff ?? inherited?.cutoff ?? settings.blockThreshold});
    } else throw Error("Unsupported website setting.");
    return read({...settings,siteRules:rules});
  }
  return {read,defaults,modes,modeNames,siteState,editSite};
})();
