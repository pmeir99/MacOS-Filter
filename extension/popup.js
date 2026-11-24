const statusLabel = document.querySelector("#status");
const grant = document.querySelector("#grant");
async function refresh() {
  const access = await chrome.permissions.contains({origins:["<all_urls>"]});
  grant.hidden = access;
  const result = await chrome.runtime.sendMessage({type:"status"});
  const counts=document.querySelector("#counts");
  counts.hidden=true;
  if (access && result?.enabled) {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (tab?.id) {
      const summary=await chrome.tabs.sendMessage(tab.id,{type:"silhouetteSummary"},{frameId:0}).catch(()=>null);
      if (summary) {
        counts.textContent="Main frame image layers · "+summary.masked+" masked · "+summary.clear+" clear · "+
          summary.unscanned+" unscanned · "+summary.pending+" pending";
        counts.hidden=false;
      }
    }
  }
  statusLabel.textContent = !result?.ok ? "Open MacOS Filter from Applications once to connect the helper."
    : !access ? "Allow Chrome to filter websites." : result.enabled ? "Filtering on this Mac." : "Filtering is paused in Chrome settings.";
}
grant.onclick = async () => {
  await chrome.permissions.request({origins:["<all_urls>"]});
  await refresh();
};
document.querySelector("#settings").onclick = () => chrome.runtime.openOptionsPage();
refresh();
