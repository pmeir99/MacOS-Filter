importScripts("helpers.js","policy.js","settings.js");

const HOST_NAME = "com.pmeir99.macos_filter";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let nativePort = null;
let inFlight = new Map();

function getPort() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener(message => {
    if (message.requestID === "reloadExtension") { chrome.runtime.reload(); return; }
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
    chrome.alarms.create("helperReconnect", {delayInMinutes: 1});
    for (const pending of old.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason || "The Mac app connection closed."));
    }
  });
  return nativePort;
}

function nativeRequest(action, imageData, profile) {
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
        modeOverride: profile?.mode,
        cutoffOverride: profile?.cutoff,
        settings: profile?.analysis,
        automaticUpdates: profile?.automaticUpdates,
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
let queuedBytes = 0;
async function scheduledAnalysis(imageData, profile) {
  if (typeof imageData !== "string" || !imageData.length || imageData.length > 4 * Math.ceil(MAX_IMAGE_BYTES/3)) throw Error("Invalid local image payload.");
  if (active >= 2) {
    if (waiting.length >= 64 || queuedBytes + imageData.length > 32*1024*1024) return {retry:true};
    queuedBytes += imageData.length;
    await new Promise(resolve => waiting.push(resolve));
    queuedBytes -= imageData.length;
  } else active++;
  try { return await nativeRequest('segmentWithPolicy',imageData,profile); }
  finally { const next=waiting.shift(); if(next) next(); else active--; }
}

async function filterImage(imageData, description, host) {
  if (!current) await initialize();
  if (!current) throw Error("The local helper is unavailable.");
  const settings = MacOSFilterHelpers.normalizeSettings(current);
  if (!settings.enabled) return { ok: true, settings };
  const rules = parsed;
  const profile = rules.profiles.find(rule => FilterPolicy.excludes(host,[rule.site]));
  if (profile) settings.mode = profile.mode;
  const labels = FilterPolicy.pattern(rules.products);
  if (labels && labels.test(description || "")) return {ok:true,coverWholeImage:true,settings:{...settings,overlayColor:"#000000",opacity:1,overlayStyle:"solid"}};
  if (settings.mode === "entireImage") {
    return { ok: true, coverWholeImage: true, settings };
  }
  if (imageData === undefined) return {ok:true,needsPixels:true};
  const {siteRules, ...analysis} = current;
  const result = await scheduledAnalysis(imageData, {...profile, analysis});
  return { ...result, settings: result.coverWholeImage || !result.ok || !result.maskData ? {...settings, overlayColor:"#000000", opacity:1, overlayStyle:'solid'} : settings };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "filterImage") return false;
  filterImage(message.imageData, message.description, new URL(sender.url || sender.tab?.url).hostname)
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
let current = null;
let parsed = FilterPolicy.parse();
let connecting = null;
async function applySettings(input, owned = true) {
  const settings = FilterSettings.read(input);
  const granted = await chrome.permissions.contains({origins:["<all_urls>"]});
  const enabled = granted && settings.enabled;
  const siteRules = settings.siteRules || {};
  const rules = FilterPolicy.parse(siteRules);
  const previous = await chrome.storage.local.get(["enabled","siteRules","policy"]);
  const policy = JSON.stringify(settings);
  if (!current || previous.enabled !== enabled || JSON.stringify(previous.siteRules) !== JSON.stringify(siteRules)) {
    await configure(enabled, siteRules);
  }
  await chrome.storage.local.set({enabled, siteRules, policy, ...(owned ? {browserOwned:true} : {})});
  parsed = rules;
  current = settings;
  if (enabled && (!previous.enabled || previous.siteRules?.excluded !== siteRules.excluded)) {
    const tabs = await chrome.tabs.query({url:["http://*/*","https://*/*"]});
    await Promise.allSettled(tabs.filter(tab => !FilterPolicy.excludes(new URL(tab.url).hostname, rules.excluded)).map(async tab => {
      const target = {tabId:tab.id, allFrames:true};
      await chrome.scripting.insertCSS({target,files:["gate.css"]});
      await chrome.scripting.executeScript({target,files:["helpers.js","policy.js","text.js","content-script.js"]});
    }));
  }
}
async function bootstrap() {
  const saved = await chrome.storage.local.get(["browserOwned","policy","siteRules","enabled"]);
  const cached = saved.policy ? JSON.parse(saved.policy) : null;
  if (saved.browserOwned || cached) {
    await applySettings(cached || {}, Boolean(saved.browserOwned));
  }
  let imported;
  try {
    imported = await nativeRequest("subscribe");
  } catch (error) {
    if (!current) await applySettings({siteRules:saved.siteRules}, false);
    return false;
  }
  if (!saved.browserOwned) {
    const settings = {...(imported.settings || cached || {})};
    settings.siteRules ??= saved.siteRules;
    await applySettings(settings);
  }
  return imported.ok;
}
function initialize() {
  if (!connecting) connecting = serialize(bootstrap).finally(() => { connecting = null; });
  return connecting;
}
function start() { initialize().catch(console.error); }
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "helperReconnect" && !nativePort) start(); });
chrome.permissions.onAdded.addListener(start);
chrome.permissions.onRemoved.addListener(start);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  async function handle() {
    if (!current) await initialize();
    switch(message.type) {
      case "settings": return {ok:true, settings:current};
      case "editSettings": return serialize(async () => {
        const {key,value} = message;
        const isRule = key.startsWith("siteRules.");
        const field = isRule ? key.slice(10) : key;
        if (!Object.hasOwn(isRule ? FilterSettings.defaults.siteRules : FilterSettings.defaults, field) || field==="siteRules")
          throw Error("Unknown setting.");
        await applySettings(isRule ? {...current,siteRules:{...current.siteRules,[field]:value}} : {...current,[field]:value});
        return {ok:true};
      });
      case "updatePreference": return nativeRequest("updatePreference", undefined, {automaticUpdates:message.value});
      case "openHelper": return nativeRequest("openSettings");
      case "status": return {ok:await initialize(),enabled:current.enabled};
      default: return {ok:false};
    }
  }
  handle().then(reply,error=>reply({ok:false,error:error.message}));
  return true;
});
start();
