import test from "node:test";
import assert from "node:assert/strict";
import "../policy.js";
const {parse,excludes,pattern}=globalThis.FilterPolicy;
test("domain overrides have label boundaries",()=>{
  const sites=parse({excluded:"Example.org\nexample.org"}).excluded;
  assert.deepEqual(sites,["example.org"]);
  assert.ok(excludes("shop.example.org",sites));
  assert.equal(excludes("notexample.org",sites),false);
  assert.throws(()=>parse({blocked:"https://example.org/path"}));
});
test("word and sentence rules match literal text on word boundaries",()=>{
  const regex=pattern(["adult toy","a.b","אסור"]);
  assert.deepEqual([...("ADULT TOY a.b axb adult toybox אסור").matchAll(regex)].map(x=>x[0]),["ADULT TOY","a.b","אסור"]);
  assert.equal(pattern([]),null);
});
test("site phrases and product description rules",()=>{
  const p=parse({sitePhrases:"store.example | sale",products:"lingerie\nunderwear"});
  assert.deepEqual(p.sitePhrases,[{site:"store.example",phrase:"sale"}]);
  assert.ok(pattern(p.products).test("Lingerie set"));
  assert.throws(()=>parse({sitePhrases:"missing separator"}));
});