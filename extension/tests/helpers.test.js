import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "..", "helpers.js"), "utf8");
const context = { URL };
vm.runInNewContext(code, context);
const helpers = context.MacOSFilterHelpers;

test("normalizes settings to supported modes and safe defaults", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.normalizeSettings({
    enabled: true,
    mode: "invalid",
    overlayStyle: "unknown",
    overlayColor: "red",
    opacity: 5
  }))), {
    enabled: true,
    mode: "allPeople",
    overlayStyle: "solid",
    overlayColor: "#000000",
    opacity: 1
  });
});

test("clamps low opacity and preserves recognized options", () => {
  const result = helpers.normalizeSettings({
    enabled: true,
    mode: "entireImage",
    overlayStyle: "blur",
    overlayColor: "#12aBcD",
    opacity: 0
  });
  assert.equal(result.mode, "entireImage");
  assert.equal(result.overlayStyle, "blur");
  assert.equal(result.overlayColor, "#12aBcD");
  assert.equal(result.opacity, 0.25);
});

test("fails closed if a mask is missing or the host reports an error", () => {
  assert.equal(helpers.shouldCoverWholeImage({ ok: true, maskData: "abc" }), false);
  assert.equal(helpers.shouldCoverWholeImage({ ok: true, maskData: null }), true);
  assert.equal(helpers.shouldCoverWholeImage({ ok: false, maskData: "abc" }), true);
});

test("accepts HTTP, HTTPS, and bounded data image URLs", () => {
  assert.equal(helpers.isSupportedImageURL("https://images.example/a.jpg"), true);
  assert.equal(helpers.isSupportedImageURL("http://example.com/a.png"), true);
  assert.equal(helpers.isSupportedImageURL("data:image/png;base64,AAAA"), true);
  assert.equal(helpers.isSupportedImageURL("file:///tmp/a.png"), false);
  assert.equal(helpers.isSupportedImageURL("blob:https://example.com/id"), false);
  assert.equal(helpers.isSupportedImageURL("javascript:alert(1)"), false);
  assert.equal(helpers.isSupportedImageURL("https://user:pass@example.com/a.jpg"), false);
});

test("fits person masks to contain and cover image layouts", () => {
  const contain = helpers.maskGeometry(400, 400, 800, 400, "contain", "50% 50%");
  assert.deepEqual(JSON.parse(JSON.stringify(contain)), { width: 400, height: 200, left: 0, top: 100 });
  const cover = helpers.maskGeometry(400, 400, 800, 400, "cover", "50% 50%");
  assert.deepEqual(JSON.parse(JSON.stringify(cover)), { width: 800, height: 400, left: -200, top: 0 });
  const invalid = helpers.maskGeometry(0, 400, 800, 400, "contain", "center");
  assert.equal(invalid, null);
});
