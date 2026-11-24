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
  return {read, defaults, modes};
})();
