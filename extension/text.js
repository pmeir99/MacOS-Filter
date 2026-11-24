(()=>{if(globalThis.mfText)return;globalThis.mfText=true;
let watcher, timer, generation=0;
async function apply(){
  const version=++generation;
  clearTimeout(timer); watcher?.disconnect(); CSS.highlights.delete("mf-phrases");
  const {enabled,siteRules}=await chrome.storage.local.get(["enabled","siteRules"]);
  if(version!==generation)return;
  const rules=FilterPolicy.parse(siteRules);
  const pattern=FilterPolicy.pattern([...rules.phrases,...rules.sitePhrases.filter(rule=>FilterPolicy.excludes(location.hostname,[rule.site])).map(rule=>rule.phrase)]);
  if(!enabled || !pattern || FilterPolicy.excludes(location.hostname,rules.excluded))return;
  function scan(){
    const marks=new Highlight();
    const walk=document.createTreeWalker(document,NodeFilter.SHOW_TEXT);
    while(walk.nextNode()){
      const node=walk.currentNode;
      if(node.parentElement?.closest("script,style,textarea,input,[contenteditable]"))continue;
      for(const hit of node.data.matchAll(pattern)){
        const range=new Range();range.setStart(node,hit.index);range.setEnd(node,hit.index+hit[0].length);marks.add(range);
      }
    }
    CSS.highlights.set("mf-phrases",marks);
  }
  scan();watcher=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,75)});
  watcher.observe(document,{subtree:true,childList:true,characterData:true});
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && (changes.enabled || changes.siteRules))apply();});apply();
})();