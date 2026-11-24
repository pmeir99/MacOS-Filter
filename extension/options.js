const $ = id => document.getElementById(id);
const modeNames = {allPeople:"All detected people",faces:"Faces",entireImage:"Entire image",adaptive:"Adaptive",skin:"Skin mask (experimental)",policy:"Seven levels (experimental)"};
const levels = ["Explicit activity","Explicit nudity","Swimwear or lingerie","Substantial exposure","Some skin visible","Covered clothing","Long, loose coverage"];
const levelOptions = Object.fromEntries(levels.map((label,i)=>[i+1,(i+1)+" · "+label]));
let settings, revision=0;
function display(message) { $("status").textContent=message; }
async function save(key,value) {
  const seq=++revision;
  display("Saving…");
  try {
    const result=await chrome.runtime.sendMessage({type:"editSettings",key,value});
    if (!result.ok) throw Error(result.error);
    if(seq===revision) display("Saved on this device");
  } catch(error) { if(seq===revision) display("Unsaved · "+error.message); }
}
function options(select, entries) {
  for(const [value,label] of Object.entries(entries)) select.add(new Option(label,value));
}
function field(section,key,title,type,values) {
  const input=document.createElement(type==="select"?"select":type==="text"?"textarea":"input");
  const row=document.createElement("label"), label=document.createElement("span");
  row.className="row"+(type==="text"?" long":""); label.textContent=title;
  input.id=key;
  const isRule=key.startsWith("siteRules."), property=isRule?key.slice(10):key;
  const product=key.startsWith("product-");
  const initial=product?settings.products.includes(key.slice(8)):(isRule?settings.siteRules:settings)[property];
  if(type==="select") options(input,values);
  else if(type!=="text") input.type=type;
  if(type==="checkbox") input.checked=initial;
  else input.value=initial;
  row.append(label,input);
  let number;
  if(type==="range"){
    [input.min,input.max,input.step]=values; input.value=initial;
    const box=document.createElement("span"); box.className="slider"; number=document.createElement("span");
    box.append(input,number);row.append(box);number.textContent=input.value;
  }
  input.addEventListener("input",()=>{
    const value=type==="checkbox"?input.checked:(type==="range" || key==="maskLevel" || key==="fullLevel")?Number(input.value):input.value;
    if(number) number.textContent=value;
    if(product){
      settings.products=[...document.querySelectorAll('[id^="product-"]:checked')].map(el=>el.id.slice(8));
      save("products",settings.products);
    } else {
      (isRule?settings.siteRules:settings)[property]=value;
      save(key,value);
    }
    styles();
  });
  $(section).append(row);
}
function styles(){
  for(const id of ["opacity","overlayColor","blurRadius"]) {
    const input=$(id);
    if(input) input.closest("label").hidden=(id==="blurRadius") !== (settings.overlayStyle==="blur");
  }
}
function profile(row={site:"",mode:"adaptive",cutoff:0.7}) {
  const wrap=document.createElement("div");wrap.className="profile";
  const domain=document.createElement("input"), mode=document.createElement("select"), cutoff=document.createElement("input"), remove=document.createElement("button");
  domain.type="text";domain.placeholder="example.org";domain.value=row.site;domain.setAttribute("aria-label","Profile domain");
  options(mode,modeNames);mode.value=row.mode;mode.setAttribute("aria-label","Profile mode");
  cutoff.type="number";cutoff.min="0.1";cutoff.max="0.95";cutoff.step="0.01";cutoff.value=row.cutoff;cutoff.setAttribute("aria-label","Profile risk cutoff");
  remove.type="button";remove.textContent="Remove";remove.onclick=()=>{wrap.remove();saveProfiles();};
  wrap.append(domain,mode,cutoff,remove);$("profiles").append(wrap);
  wrap.oninput=saveProfiles;
  return domain;
}
function saveProfiles(){
  const profiles=[...$("profiles").children].map(row=>{
    const [domain,mode,cutoff]=row.children;
    return {site:domain.value.trim(),mode:mode.value,cutoff:Number(cutoff.value)};
  });
  save("siteRules.profiles",profiles);
}
async function init() {
  const response=await chrome.runtime.sendMessage({type:"settings"});
  if(!response.ok) throw Error(response.error);
  settings=FilterSettings.read(response.settings);
  field("filter","enabled","Filter websites","checkbox");
  field("filter","mode","What to cover","select",modeNames);
  field("filter","siteRules.presentation","While scanning","select",{placeholders:"Show placeholders",loading:"Show loading screen"});
  field("render","overlayStyle","Mask style","select",{solid:"Solid color",blur:"Gaussian blur"});
  field("render","overlayColor","Mask color","color");
  field("render","opacity","Solid mask opacity","range",[0.25,1,0.01]);
  field("render","blurRadius","Blur radius (px)","range",[4,40,1]);
  field("recognition","blockThreshold","Adaptive and seven-level risk cutoff","range",[0.1,0.95,0.01]);
  field("recognition","fullLevel","Block whole image through level","select",levelOptions);
  field("recognition","maskLevel","Mask people through level","select",levelOptions);
  field("recognition","appearance","Visual presentation","select",{all:"Everyone",masculine:"Masculine appearance",feminine:"Feminine appearance"});
  field("recognition","paintSkin","Limit seven-level masks to skin","checkbox");
  field("recognition","includeFace","Include face in skin masks","checkbox");
  for(const [key,name] of Object.entries({underwear:"Underwear and lingerie",adult:"Adult products and accessories",menstrual:"Menstrual products"}))
    field("recognition","product-"+key,"Block "+name.toLowerCase(),"checkbox");
  for(const [key,title] of Object.entries({blocked:"Blocked domains",excluded:"Excluded domains",phrases:"Blocked words and phrases",sitePhrases:"Site phrases (domain | phrase)",products:"Blocked image descriptions"}))
    field("rules","siteRules."+key,title,"text");
  settings.siteRules.profiles.forEach(profile);
  $("add").onclick=()=>profile().focus();
  $("controls").onsubmit=event=>event.preventDefault();
  styles();$("fields").disabled=false;
  const pref=await chrome.runtime.sendMessage({type:"updatePreference"});
  if(pref?.ok && typeof pref.automaticUpdates==="boolean"){ $("updates").checked=pref.automaticUpdates;$("updates").disabled=false; }
  else $("helperStatus").textContent="Connect the Mac helper to manage software updates.";
}
$("updates").onchange=async event=>{
  const input=event.target;input.disabled=true;
  try {
    const reply=await chrome.runtime.sendMessage({type:"updatePreference",value:input.checked});
    if(!reply.ok) throw Error();
    input.checked=reply.automaticUpdates; display("Saved on this Mac");
  } catch {input.checked=!input.checked;display("Unsaved · Mac helper unavailable.");}
  finally {input.disabled=false;}
};
$("helper").onclick=async()=>{
  const result=await chrome.runtime.sendMessage({type:"openHelper"});
  if(!result?.ok) $("helperStatus").textContent="Open MacOS Filter from Applications.";
};
init().catch(error=>display(error.message));
