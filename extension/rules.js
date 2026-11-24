function addProfile(profile = {}) {
  const row = document.createElement("div");
  row.innerHTML = '<input aria-label="Website" placeholder="example.org"><select aria-label="Image mode"><option value="adaptive">Adaptive</option><option value="allPeople">People</option><option value="faces">Faces</option><option value="entireImage">Entire image</option></select><input aria-label="NSFW cutoff" type="number" min="0.10" max="0.95" step="0.01"><button type="button">Remove</button>';
  const [site,mode,cutoff,remove] = row.children;
  site.value = profile.site || "";
  mode.value = profile.mode || "adaptive";
  cutoff.value = profile.cutoff ?? 0.7;
  mode.onchange = () => { cutoff.disabled = mode.value !== "adaptive"; };
  mode.onchange();
  remove.onclick = () => row.remove();
  document.querySelector("#profiles").append(row);
}
document.querySelector("#addProfile").onclick = () => addProfile();
const fields = [...document.querySelectorAll("textarea,select")];
chrome.storage.local.get("siteRules").then(({siteRules = {}}) => { fields.forEach(f => f.value = siteRules[f.id] || (f.id === "presentation" ? "placeholders" : "")); (siteRules.profiles || []).forEach(addProfile); });
document.querySelector("form").onsubmit = async event => {
  event.preventDefault();
  const input = Object.fromEntries(fields.map(f => [f.id,f.value]));
  input.profiles = Array.from(document.querySelector("#profiles").children, row => {
    const [site,mode,cutoff] = row.children;
    return {site:site.value.trim(),mode:mode.value,cutoff:Number(cutoff.value)};
  });
  const output = document.querySelector("output");
  try {
    FilterPolicy.parse(input);
    const result = await chrome.runtime.sendMessage({type:"saveRules", input});
    output.value = result.ok ? "Saved. Reload open pages to apply." : result.error;
  } catch(error) { output.value = error.message; }
};