// Read image responses Chrome has already loaded. No fetch, request blocking,
// header changes, or inspection of HTML and script bodies is required.
globalThis.ChromeImages = (() => {
  const tabs = new Map();
  const dismissed = new Set();
  const maxBytes = 8 * 1024 * 1024;
  const maxEncoded = 4 * Math.ceil(maxBytes / 3);
  const imageType = /^image\/(?:jpeg|png|webp|avif|gif|bmp|x-icon|vnd\.microsoft\.icon|tiff|heic|heif)(?:;|$)/i;
  const send = (target, method, params) => chrome.debugger.sendCommand(target, method, params);

  function resourceURL(value) {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
      url.hash = "";
      return url.href;
    } catch { return ""; }
  }

  async function instrument(tab, target) {
    const session = {target, requests: new Map()};
    tab.sessions.set(target.sessionId, session);
    try {
      await send(target, "Network.enable", {maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: maxBytes});
      if (tab.closing) return;
      await send(target, "Target.setAutoAttach", {autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        filter: [{type: "iframe", exclude: false}, {exclude: true}]});
    } catch (error) {
      tab.sessions.delete(target.sessionId);
      throw error;
    }
  }

  function watch(tabId) {
    if (dismissed.has(tabId)) return Promise.resolve(null);
    let tab = tabs.get(tabId);
    if (tab) return tab.ready;
    const target = {tabId};
    tab = {target, sessions: new Map(), attached: false, closing: false};
    tabs.set(tabId, tab);
    tab.ready = (async () => {
      try {
        await chrome.debugger.attach(target, "1.3");
        tab.attached = true;
        if (tab.closing) return null;
        await instrument(tab, target);
        return tab.closing ? null : tab;
      } catch {
        if (tabs.get(tabId) === tab && !tab.closing) {
          tabs.delete(tabId);
          if (tab.attached) await chrome.debugger.detach(target).catch(() => {});
        }
        return null;
      }
    })();
    return tab.ready;
  }

  async function stop(tabId) {
    const tab = tabs.get(tabId);
    if (!tab || tab.closing) return;
    tab.closing = true;
    await tab.ready;
    if (tabs.get(tabId) !== tab) return;
    tabs.delete(tabId);
    if (tab.attached) await chrome.debugger.detach(tab.target).catch(() => {});
  }

  function observed(source, method, data) {
    const tab = tabs.get(source.tabId);
    if (!tab || tab.closing) return;
    const session = tab.sessions.get(source.sessionId);
    if (method === "Target.attachedToTarget" && data.targetInfo.type === "iframe") {
      if (tab.sessions.size < 12) instrument(tab, {tabId: source.tabId, sessionId: data.sessionId}).catch(() => {});
      return;
    }
    if (method === "Target.detachedFromTarget") {
      tab.sessions.delete(data.sessionId);
      return;
    }
    if (!session || !data?.requestId) return;
    const requests = session.requests;
    const record = requests.get(data.requestId);
    if (method === "Network.requestWillBeSent") {
      if (data.type !== "Image" || data.request.method !== "GET") return;
      const url = resourceURL(data.request.url);
      if (!url) return;
      if (requests.size >= 768) requests.delete(requests.keys().next().value);
      requests.set(data.requestId, {firstURL: record?.firstURL || url, url, frameId: data.frameId, loaderId: data.loaderId});
    } else if (method === "Network.responseReceived") {
      if (data.type !== "Image" || data.response.status >= 400 || !imageType.test(data.response.mimeType)) {
        requests.delete(data.requestId);
        return;
      }
      const url = resourceURL(data.response.url);
      if (url && data.frameId && data.loaderId) requests.set(data.requestId, {
        firstURL: record?.firstURL || url, url, frameId: data.frameId, loaderId: data.loaderId, image: true
      });
      if (requests.size > 768) requests.delete(requests.keys().next().value);
    } else if (method === "Network.loadingFinished" && record?.image) {
      record.finished = data.encodedDataLength <= maxBytes;
    } else if (method === "Network.loadingFailed") {
      requests.delete(data.requestId);
    }
  }

  function frames(tree) {
    return [tree.frame, ...(tree.childFrames || []).flatMap(frames)];
  }

  async function read(url, sender, waitForBackground = false) {
    const tabId = sender.tab?.id;
    if (!resourceURL(url) || !Number.isInteger(tabId) || !sender.documentId) throw Error("Unsupported browser image source.");
    const tab = await watch(tabId);
    if (!tab) throw Error("Chrome image access unavailable. Reload the tab after closing DevTools.");
    const page = resourceURL(sender.url);
    const documents = await chrome.webNavigation.getAllFrames({tabId});
    const matching = documents?.filter(frame => resourceURL(frame.url) === page &&
      (sender.frameId === 0 ? frame.frameId === 0 : frame.frameId !== 0));
    if (matching?.length !== 1 || matching[0].documentId !== sender.documentId) throw Error("Image frame changed or is ambiguous.");
    const sessions = sender.frameId === 0 ? [tab.sessions.get(undefined)] : [...tab.sessions.values()];
    const matches = (await Promise.all(sessions.filter(Boolean).map(async session => {
      const tree = await send(session.target, "Page.getFrameTree").catch(() => null);
      if (!tree?.frameTree) return [];
      const candidates = sender.frameId === 0 ? [tree.frameTree.frame] : frames(tree.frameTree);
      return candidates.filter(frame => resourceURL(frame.url) === page).map(frame => ({frame, session}));
    }))).flat();
    // The parent target may also describe the child frame. Require exactly one
    // target with matching image responses in this document's loader.
    const imageURL = resourceURL(url);
    function candidates() {
      return matches.flatMap(({frame, session}) => [...session.requests].filter(([, request]) =>
        request.frameId === frame.id && request.loaderId === frame.loaderId &&
        (request.url === imageURL || request.firstURL === imageURL)).map(([id, request]) => ({id, request, session})));
    }
    let sources = candidates();
    // CSS may discover an image before Chrome starts its request. Give the
    // original page load a brief opportunity to supply the response.
    if (waitForBackground && !sources.some(({request}) => request.finished)) {
      for (const delay of [80, 160, 320]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        sources = candidates();
        if (tab.closing || sources.some(({request}) => request.finished)) break;
      }
    }
    if (sources.length !== 1 || !sources[0].request.finished || tab.closing)
      throw Error("Image response unavailable in this tab. Reload to scan again.");
    const {id, session} = sources[0];
    const result = await send(session.target, "Network.getResponseBody", {requestId: id}).catch(() => null);
    const document = await chrome.webNavigation.getFrame({tabId, frameId: sender.frameId});
    if (tabs.get(tabId) !== tab || tab.closing || document?.documentId !== sender.documentId)
      throw Error("Image document changed.");
    if (!result?.base64Encoded || !result.body || result.body.length > maxEncoded)
      throw Error("Image response could not be read within the local budget.");
    return result.body;
  }

  chrome.debugger.onEvent.addListener(observed);
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tab = tabs.get(source.tabId);
    if (reason === "canceled_by_user" && tab && !tab.closing) dismissed.add(source.tabId);
    tabs.delete(source.tabId);
  });
  chrome.tabs.onRemoved.addListener(tabId => { tabs.delete(tabId); dismissed.delete(tabId); });

  return {watch, stop, read, activeTabs: () => [...tabs.keys()], resume: tabId => dismissed.delete(tabId), maxBytes};
})();
