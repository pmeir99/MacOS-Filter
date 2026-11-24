const statusLabel = document.getElementById("status");
const toggleButton = document.getElementById("toggle");
const hostName = "com.pmeir99.macos_filter";

function checkNativeHost() {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage(hostName, {
      protocolVersion: 1,
      requestID: crypto.randomUUID(),
      action: "getSettings"
    }, response => {
      const lastError = chrome.runtime.lastError;
      if (lastError) resolve({ ok: false, error: "Open the Mac app and connect the extension ID first." });
      else resolve(response || { ok: false, error: "The Mac app returned no status." });
    });
  });
}

async function updateUI() {
  const { enabled } = await chrome.storage.local.get("enabled");
  const host = await checkNativeHost();
  if (!host.ok) {
    statusLabel.textContent = host.error || "The Mac app is not connected.";
    toggleButton.textContent = "Connection required";
    toggleButton.disabled = true;
    return;
  }
  if (host.settings && !host.settings.enabled) {
    statusLabel.textContent = "Filtering is turned off in the Mac app.";
    toggleButton.textContent = enabled ? "Stop filtering" : "Open Mac app to enable";
    toggleButton.classList.toggle("stop", Boolean(enabled));
    toggleButton.disabled = !enabled;
    return;
  }
  statusLabel.textContent = enabled ? "Filtering is active on websites you visit." : "Filtering is turned off.";
  toggleButton.textContent = enabled ? "Stop filtering" : "Enable filtering";
  toggleButton.classList.toggle("stop", Boolean(enabled));
  toggleButton.disabled = false;
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled) {
    await chrome.runtime.sendMessage({ type: "setEnabled", enabled: false });
  } else {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) {
      statusLabel.textContent = "Website access was not granted.";
    } else {
      const host = await checkNativeHost();
      if (!host.ok || !host.settings || !host.settings.enabled) {
        statusLabel.textContent = host.error || "Turn on filtering in the Mac app first.";
      } else {
        await chrome.runtime.sendMessage({ type: "setEnabled", enabled: true });
      }
    }
  }
  await updateUI();
});

updateUI();
