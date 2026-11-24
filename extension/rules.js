const fields = [...document.querySelectorAll("textarea,select")];
chrome.storage.local.get("siteRules").then(({siteRules = {}}) => fields.forEach(f => f.value = siteRules[f.id] || (f.id === "presentation" ? "placeholders" : "")));
document.querySelector("form").onsubmit = async event => {
  event.preventDefault();
  const input = Object.fromEntries(fields.map(f => [f.id,f.value]));
  const output = document.querySelector("output");
  try {
    FilterPolicy.parse(input);
    const result = await chrome.runtime.sendMessage({type:"saveRules", input});
    output.value = result.ok ? "Saved. Reload open pages to apply." : result.error;
  } catch(error) { output.value = error.message; }
};