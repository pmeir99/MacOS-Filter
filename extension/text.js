(()=>{if(globalThis.mfText)return;globalThis.mfText=true;
let watcher, timer, generation=0;
async function apply(){
  const version=++generation;
  clearTimeout(timer); timer=null; watcher?.disconnect(); CSS.highlights.delete("mf-phrases");
  const {enabled,siteRules}=await chrome.storage.local.get(["enabled","siteRules"]);
  if(version!==generation)return;
  const rules=FilterPolicy.parse(siteRules);
  const pattern=FilterPolicy.pattern([...rules.phrases,...rules.sitePhrases.filter(rule=>FilterPolicy.excludes(location.hostname,[rule.site])).map(rule=>rule.phrase)]);
  if(!enabled || !pattern || FilterPolicy.excludes(location.hostname,rules.excluded))return;
  function scan(){
    const marks=new Highlight();
    // Match a phrase across inline markup without joining separate paragraphs.
    const blocks="p,div,section,article,main,header,footer,nav,aside,li,td,th,button,h1,h2,h3,h4,h5,h6,body";
    const skip="script,style,textarea,input,select,[contenteditable]";
    const walk=document.createTreeWalker(document,NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let group=null, parts=[], length=0;
    function flush(){
      if (!parts.length) return;
      const value=parts.map(part=>part.node.data).join("");
      let cursor=0;
      for(const hit of value.matchAll(pattern)){
        const end=hit.index+hit[0].length;
        while(cursor+1<parts.length && parts[cursor+1].offset<=hit.index) cursor++;
        const first=parts[cursor];
        while(cursor+1<parts.length && parts[cursor+1].offset<end) cursor++;
        const last=parts[cursor], range=new Range();
        range.setStart(first.node,hit.index-first.offset);
        range.setEnd(last.node,end-last.offset);
        marks.add(range);
      }
      parts=[]; length=0;
    }
    while(walk.nextNode()){
      const node=walk.currentNode;
      if(node.nodeType===Node.ELEMENT_NODE){
        if(node.matches("br,hr,"+skip+","+blocks)) flush();
        continue;
      }
      const parent=node.parentElement;
      if(!node.length || !parent || parent.closest(skip))continue;
      const block=parent.closest(blocks);
      if(block!==group){flush();group=block;}
      parts.push({node,offset:length});length+=node.length;
    }
    flush();
    CSS.highlights.set("mf-phrases",marks);
  }
  scan();watcher=new MutationObserver(()=>{if(!timer)timer=setTimeout(()=>{timer=null;scan();},75)});
  watcher.observe(document,{subtree:true,childList:true,characterData:true});
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && (changes.enabled || changes.siteRules))apply();});apply();
})();