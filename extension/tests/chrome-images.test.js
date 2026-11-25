import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";

const script = readFileSync(new URL("../chrome-images.js", import.meta.url), "utf8");
const page = "https://store.example/search";
const source = "https://images.cdn.example/sku?small";
const id = {tabId: 42};
const frame = {id: "top", loaderId: "current", url: page};
const sender = {tab: {id: 42}, frameId: 0, documentId: "current", url: page};

async function fixture() {
  const commands = [];
  const listeners = {};
  const listen = name => ({addListener(fn) { listeners[name] = fn; }});
  let documentId = "current";
  const chrome = {
    debugger: {
      attach: async () => {}, detach: async () => {},
      onEvent: listen("event"), onDetach: listen("detach"),
      async sendCommand(target, method, args) {
        commands.push({target, method, args});
        if (method === "Page.getFrameTree") return {frameTree: {frame}};
        if (method === "Network.getResponseBody") return {base64Encoded: true, body: "cG5n"};
      }
    },
    tabs: {onRemoved: listen("removed")},
    webNavigation: {
      getFrame: async () => ({documentId}),
      getAllFrames: async () => [{url: page, frameId: 0, documentId}]
    }
  };
  const global = {URL, chrome, setTimeout};
  runInNewContext(script, global);
  const capture = global.ChromeImages;
  await capture.watch(id.tabId);
  return {
    capture, commands, detach: listeners.detach,
    record({mimeType = "image/png", loaderId = "current", requestId = "request", finished = true} = {}) {
      listeners.event(id, "Network.responseReceived", {type: "Image", requestId, loaderId, frameId: frame.id,
        response: {url: source, mimeType, status: 200}});
      if (finished) listeners.event(id, "Network.loadingFinished", {requestId, encodedDataLength: 3});
    },
    navigate() { documentId = "new-document"; }
  };
}

test("reads only the matching image from Chrome's current document", async () => {
  const test = await fixture();
  test.record();
  assert.equal(await test.capture.read(source, sender), "cG5n");
  const request = test.commands.find(command => command.method === "Network.getResponseBody");
  assert.equal(request.args.requestId, "request");
  test.navigate();
  await assert.rejects(test.capture.read(source, sender), /frame changed/i);
});

test("ignores non-image, incomplete, ambiguous and previous-document responses", async () => {
  for (const rows of [
    [{mimeType: "text/html"}],
    [{finished: false}],
    [{loaderId: "old"}],
    [{requestId: "first"}, {requestId: "second"}]
  ]) {
    const test = await fixture();
    rows.forEach(row => test.record(row));
    await assert.rejects(test.capture.read(source, sender), /response unavailable/i);
    assert.equal(test.commands.some(command => command.method === "Network.getResponseBody"),false);
  }
});

test("respects Chrome's user-requested detach for the current navigation", async () => {
  const test = await fixture();
  test.detach(id, "canceled_by_user");
  await assert.rejects(test.capture.read(source, sender), /image access unavailable/i);
  test.capture.resume(id.tabId);
  await test.capture.watch(id.tabId);
  test.record();
  assert.equal(await test.capture.read(source, sender), "cG5n");
});
