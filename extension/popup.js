const el=id=>document.getElementById(id);
let tab, site, access=false, saving=false;
const send=message=>chrome.runtime.sendMessage(message);
function render() {
  el("site").textContent=site.host;
  el("siteControls").hidden=false;
  const inherited=site.excludedBy && site.excludedBy!==site.host;
  el("siteEnabled").checked=site.globallyEnabled && !site.paused;
  el("siteEnabled").disabled=saving || !site.globallyEnabled || Boolean(inherited);
  el("siteMode").disabled=saving || !site.globallyEnabled || site.paused;
  el("siteMode").options[0].text="Use default · "+FilterSettings.modeNames[site.inheritedMode];
  el("siteMode").value=site.mode;
  el("connection").textContent=site.helperConnected ? "Connected to Mac helper" : "Mac helper disconnected";
  el("status").textContent=!site.globallyEnabled?"Filtering is paused in general settings.":
    inherited?"Paused by the "+site.excludedBy+" exclusion.":
    site.paused?"Paused for this site and its subdomains.":"Site settings also apply to subdomains.";
}
async function refresh() {
  access=await chrome.permissions.contains({origins:["<all_urls>"]});
  el("grant").hidden=access;
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if (!access || !tab?.url || !/^https?:\/\//i.test(tab.url) || new URL(tab.url).hostname.includes(":")) {
    el("siteControls").hidden=true;
    el("status").textContent=!access?"Grant website access to enable filtering.":"Site controls are available on HTTP and HTTPS websites with a supported hostname.";
    return;
  }
  site=await send({type:"siteSettings",tabId:tab.id});
  if (!site?.ok) throw Error(site?.error || "Website settings unavailable.");
  render();
  if (site.globallyEnabled && !site.paused) {
    const counts=await chrome.tabs.sendMessage(tab.id,{type:"silhouetteSummary"},{frameId:0}).catch(()=>null);
    if (counts) {
      el("counts").textContent=counts.masked+" masked · "+counts.clear+" clear · "+counts.unscanned+" unscanned · "+counts.pending+" pending";
      el("counts").hidden=false;
    }
  }
}
async function edit(field,value) {
  if (saving || !site) return;
  saving=true;
  el("siteEnabled").disabled=true;el("siteMode").disabled=true;
  el("status").textContent="Saving…";
  try {
    const result=await send({type:"editSite",tabId:tab.id,host:site.host,field,value});
    if (!result?.ok) throw Error(result?.error || "Could not save.");
    site=result;saving=false;render();el("counts").hidden=true;
    el("status").textContent="Saved for "+site.host+" and its subdomains.";
  } catch (error) {saving=false;render();el("status").textContent=error.message;}
}
el("siteMode").add(new Option("Use default",""));
for (const [value,name] of Object.entries(FilterSettings.modeNames)) el("siteMode").add(new Option(name,value));
el("siteMode").onchange=e=>edit("mode",e.target.value);
el("siteEnabled").onchange=e=>edit("enabled",e.target.checked);
el("grant").onclick=async()=>{await chrome.permissions.request({origins:["<all_urls>"]});await refresh();};
el("settings").onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL("options.html"),active:true}).catch(error=>el("status").textContent=error.message);
refresh().catch(error=>el("status").textContent=error.message);
