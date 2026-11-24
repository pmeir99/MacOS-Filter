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
