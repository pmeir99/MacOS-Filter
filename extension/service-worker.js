importScripts("helpers.js","policy.js");

const HOST_NAME = "com.pmeir99.macos_filter";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let nativePort = null;
let inFlight = new Map();

function getPort() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener(message => {
    if (message.requestID === "settingsChanged") {
      serialize(() => applySettings(message.settings)).catch(console.error);
      return;
    }
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
    current = null;
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
  try { return await nativeRequest('segment',imageData,profile); }
  finally { const next=waiting.shift(); if(next) next(); else active--; }
}

async function filterImage(imageData, description, host) {
  if (!current) await connect();
  if (!current) throw Error("The local helper is unavailable.");
  const settings = MacOSFilterHelpers.normalizeSettings(current);
  if (!settings.enabled) return { ok: true, settings };
  const rules = parsed;
  const profile = rules.profiles.find(rule => FilterPolicy.excludes(host,[rule.site]));
  if (profile) settings.mode = profile.mode;
  const labels = FilterPolicy.pattern(rules.products);
  if (labels && labels.test(description || "")) return {ok:true,coverWholeImage:true,settings:{...settings,opacity:1,overlayStyle:"solid"}};
  if (settings.mode === "entireImage") {
    return { ok: true, coverWholeImage: true, settings };
  }
  if (imageData === undefined) return {ok:true,needsPixels:true};
  const result = await scheduledAnalysis(imageData, profile);
  return { ...result, settings: result.coverWholeImage || !result.ok ? {...settings, opacity:1, overlayStyle:'solid'} : settings };
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
async function applySettings(settings) {
  const granted = await chrome.permissions.contains({origins:["<all_urls>"]});
  const enabled = granted && settings.enabled;
  const siteRules = settings.siteRules || {};
  const rules = FilterPolicy.parse(siteRules);
  const previous = await chrome.storage.local.get(["enabled","siteRules","policy"]);
  const policy = JSON.stringify(settings);
  if (!current || previous.enabled !== enabled || JSON.stringify(previous.siteRules) !== JSON.stringify(siteRules)) {
    await configure(enabled, siteRules);
  }
  parsed = rules;
  current = settings;
  await chrome.storage.local.set({enabled, siteRules, policy});
  if (enabled && (!previous.enabled || previous.siteRules?.excluded !== siteRules.excluded)) {
    const tabs = await chrome.tabs.query({url:["http://*/*","https://*/*"]});
    await Promise.allSettled(tabs.filter(tab => !FilterPolicy.excludes(new URL(tab.url).hostname, rules.excluded)).map(async tab => {
      const target = {tabId:tab.id, allFrames:true};
      await chrome.scripting.insertCSS({target,files:["gate.css"]});
      await chrome.scripting.executeScript({target,files:["helpers.js","policy.js","text.js","content-script.js"]});
    }));
  }
}
function connect() {
  if (!connecting) connecting = (async () => {
    const response = await nativeRequest("subscribe");
    if (!response?.ok || !response.settings) throw Error("Open MacOS Filter once to register the helper.");
    await serialize(() => applySettings(response.settings));
  })().finally(() => { connecting = null; });
  return connecting;
}
function start() { connect().catch(() => {}); }
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "helperReconnect" && !nativePort) start(); });
chrome.permissions.onAdded.addListener(start);
chrome.permissions.onRemoved.addListener(start);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (message?.type === "openSettings") {
    nativeRequest("openSettings").then(reply, error => reply({ok:false,error:error.message}));
  } else if (message?.type === "status") {
    connect().then(() => reply({ok:true, enabled:current?.enabled}), error => reply({ok:false,error:error.message}));
  } else return false;
  return true;
});
start();
