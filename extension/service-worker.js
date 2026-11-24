importScripts("helpers.js");

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

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function analyzeImage(url) {
  if (!MacOSFilterHelpers.isSupportedImageURL(url)) {
    throw new Error("This image URL is not supported.");
  }
  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) throw new Error("The image could not be read.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size > MAX_IMAGE_BYTES) {
    throw new Error("The image type or file size is outside the supported limits.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return nativeRequest("segment", bytesToBase64(bytes));
}

async function filterImage(url) {
  const settingsResponse = await nativeRequest("getSettings");
  if (!settingsResponse.ok || !settingsResponse.settings || !settingsResponse.settings.enabled) {
    throw new Error("Enable filtering in the Mac app first.");
  }
  const settings = MacOSFilterHelpers.normalizeSettings(settingsResponse.settings);
  if (settings.mode === "entireImage") {
    return { ok: true, coverWholeImage: true, settings };
  }
  const result = await analyzeImage(url);
  return { ...result, settings };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "filterImage") return false;
  filterImage(message.url)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, coverWholeImage: true, error: error.message }));
  return true;
});

async function injectIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["helpers.js", "content-script.js"]
    });
  } catch (_) {
    // Restricted browser pages and permission transitions cannot accept scripts.
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || !/^https?:/.test(tab.url)) return;
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled) await injectIntoTab(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "setEnabled") return false;
  (async () => {
    await chrome.storage.local.set({ enabled: Boolean(message.enabled) });
    if (message.enabled) {
      const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
      for (const tab of tabs) if (tab.id !== undefined) await injectIntoTab(tab.id);
    } else {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          try { await chrome.tabs.sendMessage(tab.id, { type: "disableFiltering" }); } catch (_) {}
        }
      }
    }
    sendResponse({ ok: true });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
