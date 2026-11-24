const statusLabel = document.querySelector("#status");
const grant = document.querySelector("#grant");
async function refresh() {
  const access = await chrome.permissions.contains({origins:["<all_urls>"]});
  grant.hidden = access;
  const result = await chrome.runtime.sendMessage({type:"status"});
  statusLabel.textContent = !result?.ok ? "Open MacOS Filter from Applications once to connect the helper."
    : !access ? "Allow Chrome to filter websites." : result.enabled ? "Filtering on this Mac." : "Filtering is paused in Mac settings.";
}
grant.onclick = async () => {
  await chrome.permissions.request({origins:["<all_urls>"]});
  await refresh();
};
document.querySelector("#settings").onclick = async () => {
  const result = await chrome.runtime.sendMessage({type:"openSettings"});
  if (result?.ok) window.close();
  else statusLabel.textContent = "Open MacOS Filter from Applications to finish setup.";
};
refresh();
