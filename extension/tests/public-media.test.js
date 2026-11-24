import test from "node:test";
import assert from "node:assert/strict";
import "../public-media.js";
const wiki = "https://en.wikipedia.org/wiki/Astronaut";
const source = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/A.jpg/250px-A.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
test("only public static Wikimedia routes on Wikipedia qualify",()=>{
  assert.equal(PublicMedia.eligible(source,wiki),true);
  for (const url of [source+"&token=private",source.replace("thumb.","user@thumb."),source.replace("https:","http:"),
      source.replace("wikimedia.org","wikimedia.org.example.com"),source.replace("/wikipedia/","/private/")])
    assert.equal(PublicMedia.eligible(url,wiki),false);
  assert.equal(PublicMedia.eligible(source,"https://en.wikipedia.org.evil.example/"),false);
});
test("accept X public media, banners and avatars only on corresponding sites",()=>{
  for (const path of ["/profile_banners/123/456/600x200","/profile_images/123/avatar_normal.jpg","/media/ABC-123?format=jpg&name=small"]) {
    const url="https://pbs.twimg.com"+path;
    assert.equal(PublicMedia.eligible(url,"https://x.com/NASA"),true);
    assert.equal(PublicMedia.eligible(url,wiki),false);
  }
  assert.equal(PublicMedia.eligible("https://pbs.twimg.com/media/ABC?session=123","https://x.com/NASA"),false);
});
