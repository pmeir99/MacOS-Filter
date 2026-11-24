import test from "node:test";
import assert from "node:assert/strict";
import "../policy.js";
import "../settings.js";

test("migrate native settings, including per-site profiles and visual controls",()=>{
  const settings=FilterSettings.read({mode:"policy",blockThreshold:0.45,opacity:0.8,
    includeFace:false,products:["underwear"],siteRules:{profiles:[{site:"shop.example",mode:"skin",cutoff:0.5}]}});
  assert.equal(settings.includeFace,false);
  assert.equal(settings.siteRules.profiles[0].mode,"skin");
  assert.equal(settings.blockThreshold,0.45);
  assert.equal(settings.siteRules.presentation,"placeholders");
  assert.deepEqual(FilterSettings.read(settings),settings);
});
test("reject invalid policies before replacing the active settings",()=>{
  for (const bad of [{fullLevel:2.5},{opacity:0},{blurRadius:41},{mode:"unknown"},{products:["foo"]},
    {siteRules:{blocked:"https://example.com"}},{siteRules:{presentation:"unknown"}}]) {
    assert.throws(()=>FilterSettings.read(bad));
  }
});

test("popup edits only the current domain and keeps cutoffs and other site rules",()=>{
  const base=FilterSettings.read({siteRules:{excluded:"other.test",profiles:[
    {site:"example.org",mode:"faces",cutoff:0.83},{site:"other.test",mode:"skin",cutoff:0.4}]}});
  const host="news.example.org";
  let s=FilterSettings.editSite(base,host,"mode","peopleOnly");
  assert.equal(FilterSettings.siteState(s,host).mode,"peopleOnly");
  assert.equal(s.siteRules.profiles.find(p=>p.site===host).cutoff,0.83);
  s=FilterSettings.editSite(s,host,"enabled",false);
  assert.equal(FilterSettings.siteState(s,"sub."+host).excludedBy,host);
  assert.throws(()=>FilterSettings.editSite(s,"sub."+host,"enabled",true));
  s=FilterSettings.editSite(s,host,"enabled",true);
  s=FilterSettings.editSite(s,host,"mode","");
  assert.deepEqual(FilterSettings.siteState(s,host),{paused:false,excludedBy:undefined,mode:"",inheritedMode:"faces"});
  assert.equal(s.siteRules.excluded,"other.test");
  assert.deepEqual(s.siteRules.profiles,FilterPolicy.parse(base.siteRules).profiles);
  assert.throws(()=>FilterSettings.editSite(s,host,"mode","bogus"));
});
