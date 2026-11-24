import test from "node:test";
import assert from "node:assert/strict";
import "../google-thumbnails.js";
const page="https://www.google.com/search?q=fixture";
const image="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc-test&s";
test("accept only public thumbnails on a Google Search document",()=>{
  assert.equal(GoogleThumbnails.eligible(image,page),true);
  for(const value of [image.replace(".com/",".com.example.net/"),image.replace("/images","/other"),
      image.replace("https:","http:"),image+"&redirect=test",image.replace("tbn:","other:"),image+"&q=tbn:ab",
      image.replace("https://","https://user@")]) assert.equal(GoogleThumbnails.eligible(value,page),false);
  assert.equal(GoogleThumbnails.eligible(image,"https://www.google.com/maps"),false);
  assert.equal(GoogleThumbnails.eligible(image,"https://elsewhere.example/search"),false);
});
