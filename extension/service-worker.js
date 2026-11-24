importScripts("helpers.js","policy.js");

const HOST_NAME = "com.pmeir99.macos_filter";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let nativePort = null;
let inFlight = new Map();

function getPort() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener(message => {
    const pending = inFlight.get(message.requestID);
    if (!pending) return;
    clearTimeout(pending.timeout);
    inFlight.delete(message.requestID);
    pending.resolve(message);
  });
  nativePort.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError ? chrome.runtime.lastError.message : "The Mac app connection closed.";
    const old = inFlight;
    inFlight = new Map();
    nativePort = null;
    for (const pending of old.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason || "The Mac app connection closed."));
    }
  });
  return nativePort;
}

function nativeRequest(action, imageData) {
  const requestID = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      inFlight.delete(requestID);
      reject(new Error("The local image filter timed out."));
    }, 30000);
    inFlight.set(requestID, { resolve, reject, timeout });
    try {
      getPort().postMessage({
        protocolVersion: 1,
        requestID,
        action,
        imageData: imageData || undefined
      });
    } catch (error) {
      clearTimeout(timeout);
      inFlight.delete(requestID);
      reject(error);
    }
  });
}

let active = 0;
const waiting = [];
async function scheduledAnalysis(imageData) {
  if (typeof imageData !== "string" || !imageData.length || imageData.length > 4 * Math.ceil(MAX_IMAGE_BYTES/3)) throw Error("Invalid local image payload.");
  if (active >= 2) {
    if (waiting.length >= 64) throw Error("Local image queue is full.");
    await new Promise(resolve => waiting.push(resolve));
  } else active++;
  try { return await nativeRequest('segment',imageData); }
  finally { const next=waiting.shift(); if(next) next(); else active--; }
}

async function filterImage(imageData, description) {
  const settingsResponse = await nativeRequest("getSettings");
  if (!settingsResponse.ok || !settingsResponse.settings) {
    throw new Error("The Mac app did not return filtering settings.");
  }
  const settings = MacOSFilterHelpers.normalizeSettings(settingsResponse.settings);
  if (!settings.enabled) return { ok: true, settings };
  const {siteRules} = await chrome.storage.local.get("siteRules");
  const labels = FilterPolicy.pattern(FilterPolicy.parse(siteRules).products);
  if (labels && labels.test(description || "")) return {ok:true,coverWholeImage:true,settings:{...settings,opacity:1,overlayStyle:"solid"}};
  if (settings.mode === "entireImage") {
    return { ok: true, coverWholeImage: true, settings };
  }
  if (imageData === undefined) return {ok:true,needsPixels:true};
  const result = await scheduledAnalysis(imageData);
  return { ...result, settings: result.coverWholeImage || !result.ok ? {...settings, opacity:1, overlayStyle:'solid'} : settings };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "filterImage") return false;
  filterImage(message.imageData, message.description)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, coverWholeImage: true, error: error.message }));
  return true;
});


async function configure(enabled, input) {
  const rules = FilterPolicy.parse(input);
  const registrations = await chrome.scripting.getRegisteredContentScripts({ids:["filter"]});
  const script = {id:"filter", matches:["http://*/*","https://*/*"], allFrames:true,
    excludeMatches:rules.excluded.map(site=>"*://*."+site+"/*"), runAt:"document_start",
    css:input?.presentation==="loading"?["gate.css","loading.css"]:["gate.css"], js:["helpers.js","policy.js","text.js","content-script.js"]};
  if(enabled){
    if(registrations.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } else if(registrations.length) await chrome.scripting.unregisterContentScripts({ids:["filter"]});
  const existing=await chrome.declarativeNetRequest.getDynamicRules();
  const addRules=enabled && rules.blocked.length ? [{id:1,priority:1,action:{type:"redirect",redirect:{extensionPath:"/blocked.html"}},
    condition:{requestDomains:rules.blocked,...(rules.excluded.length?{excludedRequestDomains:rules.excluded}:{}),resourceTypes:["main_frame"]}}] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:existing.map(rule=>rule.id),addRules});
}
let queue=Promise.resolve();
function serialize(fn){ const next=queue.then(fn); queue=next.catch(()=>{}); return next; }
async function restore(){const {enabled,siteRules}=await chrome.storage.local.get(["enabled","siteRules"]); await configure(!!enabled,siteRules);}
chrome.runtime.onInstalled.addListener(()=>serialize(restore));
chrome.runtime.onStartup.addListener(()=>serialize(restore));
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!["setEnabled","saveRules"].includes(message?.type) || sender.url?.startsWith(chrome.runtime.getURL(""))!==true)return false;
  serialize(async()=>{
    const current=await chrome.storage.local.get(["enabled","siteRules"]);
    const enabled=message.type==="setEnabled"?!!message.enabled:!!current.enabled;
    const input=message.type==="saveRules"?message.input:current.siteRules;
    await configure(enabled,input);
    await chrome.storage.local.set({enabled,siteRules:input || {}});
  }).then(()=>reply({ok:true}),error=>reply({ok:false,error:error.message}));
  return true;
});