(() => {
  const MIN = 100;
  let threshold = 0.5;
  let enabled = true;
  let features = { images: true, video: true, text: true, audio: true };
  let ref = null;        // { score, mode } - the user's "reference line"
  let useRef = true;
  let clf = null;          // trained classifier
  let useClf = true;
  let lastFlagFeat = null; // used to create a Safe example on a false alarm
  let customWords = [];
  let matcher = null;
  let triggered = false;
  let overlay = null;
  let pauseTimer = null;
  const cache = new Map();
  const videos = new Set();
  const flaggedText = new WeakSet();

  // ---------- settings ----------
  const KEYS = ["threshold", "enabled", "features", "ref", "useRef", "customWords", "clf", "useClf"];
  function apply(r) {
    if (typeof r.threshold === "number") threshold = r.threshold;
    if (r.enabled !== undefined) enabled = r.enabled !== false;
    if (r.features) features = { images: true, video: true, text: true, audio: true, ...r.features };
    if ("ref" in r) ref = r.ref || null;
    if (r.useRef !== undefined) useRef = r.useRef !== false;
    if (Array.isArray(r.customWords)) customWords = r.customWords;
    if ("clf" in r) clf = r.clf || null;
    if (r.useClf !== undefined) useClf = r.useClf !== false;
  }
  chrome.storage.local.get(KEYS).then((r) => {
    apply(r);
    buildMatcher();
    if (document.body) { queueText(document.documentElement); checkPage(); }
  });
  chrome.storage.onChanged.addListener((c) => {
    const r = {};
    for (const k of KEYS) if (c[k]) r[k] = c[k].newValue;
    apply(r);
    if (c.customWords) buildMatcher();
  });

  // ---------- text matcher ----------
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function buildMatcher() {
    const W = globalThis.MR_WORDS || { strong: [], weak: [] };
    const strong = [...W.strong, ...customWords].map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    const mk = (arr) =>
      arr.length ? new RegExp("(?<![a-z0-9])(?:" + arr.map(esc).join("|") + ")(?![a-z0-9])", "gi") : null;
    matcher = { strong: mk(strong), weak: mk(W.weak) };
  }
  function textScore(t) {
    if (!matcher || !t) return 0;
    let s = 0;
    if (matcher.strong) { const m = t.match(matcher.strong); if (m) s += m.length; }
    if (matcher.weak) { const m = t.match(matcher.weak); if (m) s += 0.34 * m.length; }
    return s;
  }

  // ---------- queue (max 2 parallel) ----------
  const q = [];
  let active = 0;
  function enqueue(fn) { q.push(fn); pump(); }
  function pump() {
    while (active < 2 && q.length) {
      active++;
      q.shift()().catch(() => {}).finally(() => { active--; pump(); });
    }
  }

  // ---------- image/video helpers ----------
  function grab(el, w, h) {
    const s = Math.min(1, 299 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7); // throws an error on a tainted canvas
  }

  async function ask(payload) {
    try {
      return (await chrome.runtime.sendMessage({ type: "scan", ...payload })) || { error: "no response" };
    } catch (e) {
      return { error: String(e) };
    }
  }

  const release = (el) => el.classList.remove("ng-pending");
  const ctx = () => ({ clf, useClf, threshold, ref, useRef });

  function judge(el, res) {
    if (!res || res.error) {
      console.warn("[MindGuard] scan error:", res && res.error);
      return release(el);
    }
    if ((res.cloud !== undefined ? res.cloud : MR.verdict(res, ctx()).flag)) { lastFlagFeat = res.feat || null; flag(el); }
    else release(el);
  }

  // ---------- images ----------
  async function scanImg(img) {
    if (!enabled || !features.images) return release(img);
    if (!img.complete || !img.naturalWidth) {
      await new Promise((r) => {
        img.addEventListener("load", r, { once: true });
        img.addEventListener("error", r, { once: true });
        setTimeout(r, 8000);
      });
    }
    if (img.naturalWidth < MIN || img.naturalHeight < MIN) return release(img);
    const src = img.currentSrc || img.src;
    if (!src) return release(img);

    let res = cache.get(src);
    if (!res) {
      let payload;
      try {
        payload = { dataUrl: grab(img, img.naturalWidth, img.naturalHeight) };
      } catch {
        if (/^https?:/.test(src)) payload = { src };
        else return release(img);
      }
      res = await ask(payload);
      cache.set(src, res);
    }
    judge(img, res);
  }

  // ---------- videos (frame check every ~1.5 sec) ----------
  let videoBusy = false;
  setInterval(async () => {
    if (!enabled || !features.video || videoBusy || triggered) return;
    videoBusy = true;
    try {
      for (const v of videos) {
        if (!v.isConnected) { videos.delete(v); continue; }
        if (v.paused || v.readyState < 2 || !v.videoWidth) continue;
        const r = v.getBoundingClientRect();
        if (r.width < MIN || r.height < MIN) continue;
        if (r.bottom < 0 || r.top > innerHeight) continue;
        let dataUrl;
        try { dataUrl = grab(v, v.videoWidth, v.videoHeight); } catch { continue; }
        const res = await ask({ dataUrl });
        if (res && !res.error && (res.cloud !== undefined ? res.cloud : MR.verdict(res, ctx()).flag)) { lastFlagFeat = res.feat || null; flag(v); }
      }
    } finally {
      videoBusy = false;
    }
  }, 1500);

  // ---------- audio: subtitles/captions + audio element names ----------
  function hookTracks(v) {
    if (v.__mrTracks) return;
    v.__mrTracks = true;
    const attach = (t) => {
      if (t.kind !== "subtitles" && t.kind !== "captions") return;
      if (t.mode === "disabled") t.mode = "hidden";
      t.addEventListener("cuechange", () => {
        if (!enabled || !features.audio || !t.activeCues) return;
        for (const c of t.activeCues) {
          if (textScore(c.text || "") >= 1) { lastFlagFeat = null; flag(v); break; }
        }
      });
    };
    try {
      [...v.textTracks].forEach(attach);
      v.textTracks.addEventListener("addtrack", (e) => attach(e.track));
    } catch {}
  }

  function checkAudioEl(a) {
    if (!features.audio) return;
    let s = "";
    try { s = decodeURIComponent(a.currentSrc || a.src || ""); } catch { s = a.src || ""; }
    if (textScore(s + " " + (a.title || "") + " " + (a.getAttribute("aria-label") || "")) >= 1) {
      try { a.pause(); a.muted = true; } catch {}
      lastFlagFeat = null;
      showOverlay();
    }
  }

  // ---------- text ----------
  const textQueue = new Set();
  let textTimer = null;
  function queueText(node) {
    if (!enabled || !features.text) return;
    textQueue.add(node);
    if (!textTimer) textTimer = setTimeout(flushText, 600);
  }
  function flushText() {
    textTimer = null;
    const roots = [...textQueue];
    textQueue.clear();
    let budget = { n: 3000 };
    for (const r of roots) if (r.isConnected) scanTextTree(r, budget);
  }
  const BAD_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "TITLE"]);
  function checkTextNode(n) {
    const p = n.parentElement;
    if (!p || BAD_TAGS.has(p.tagName) || p.isContentEditable || flaggedText.has(p)) return;
    const v = n.nodeValue;
    if (!v || v.length < 3 || v.length > 2000) return;
    if (textScore(v) >= 1) {
      flaggedText.add(p);
      lastFlagFeat = null;
      p.classList.add("ng-text-flagged");
      showOverlay();
    }
  }
  function scanTextTree(root, budget) {
    if (root.nodeType === 3) return checkTextNode(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && budget.n-- > 0) checkTextNode(n);
  }
  function checkPage() {
    if (!enabled || !features.text) return;
    let s = "";
    try { s = decodeURIComponent(location.hostname + location.pathname + " " + location.search); }
    catch { s = location.hostname + location.pathname; }
    if (textScore(s + " " + (document.title || "")) >= 1) { lastFlagFeat = null; showOverlay(); }
  }

  // ---------- flag + overlay ----------
  function flag(el) {
    el.classList.remove("ng-pending");
    el.classList.add("ng-flagged");
    if (el instanceof HTMLVideoElement) {
      try { el.pause(); el.muted = true; } catch {}
    }
    showOverlay();
  }

  function showOverlay() {
    if (triggered) return;
    triggered = true;
    chrome.storage.local.get(["flagCount"]).then((r) =>
      chrome.storage.local.set({ lastFlag: Date.now(), flagCount: (r.flagCount || 0) + 1 })
    );
    const f = document.createElement("iframe");
    f.src = chrome.runtime.getURL("overlay.html");
    f.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#000;";
    overlay = f;
    document.documentElement.appendChild(f);
    pauseTimer = setInterval(() => {
      document.querySelectorAll("video,audio").forEach((m) => {
        try { m.pause(); m.muted = true; } catch {}
      });
    }, 500);
  }

  window.addEventListener("message", (e) => {
    if (!overlay || e.source !== overlay.contentWindow) return;
    if (e.data && e.data.ngAction === "dismiss") {
      saveFalseAlarm();
      document.querySelectorAll(".ng-flagged,.ng-text-flagged").forEach((x) => x.classList.remove("ng-flagged", "ng-text-flagged"));
      overlay.remove();
      overlay = null;
      clearInterval(pauseTimer);
      triggered = false;
    }
  });

  // Pressing "False alarm" turns that image into a Safe example (numbers only)
  async function saveFalseAlarm() {
    if (!lastFlagFeat) return;
    const f = lastFlagFeat; lastFlagFeat = null;
    const { trainSet } = await chrome.storage.local.get("trainSet");
    const set = trainSet || { pos: [], neg: [] };
    if (set.neg.length < 5000) set.neg.push(f);
    await chrome.storage.local.set({ trainSet: set, trainDirty: true });
  }

  // ---------- DOM watch ----------
  function watch(el) {
    if (!enabled) return;
    if (el instanceof HTMLImageElement) {
      if (!features.images) return;
      el.classList.add("ng-pending");
      enqueue(() => scanImg(el));
    } else if (el instanceof HTMLVideoElement) {
      if (features.video) videos.add(el);
      hookTracks(el);
    } else if (el instanceof HTMLAudioElement) {
      checkAudioEl(el);
    }
  }

  function scanTree(node) {
    if (node.nodeType === 3) { queueText(node); return; }
    if (node.nodeType !== 1) return;
    watch(node);
    node.querySelectorAll && node.querySelectorAll("img,video,audio").forEach(watch);
    queueText(node);
  }

  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(scanTree);
      else if (m.type === "attributes") watch(m.target);
      else if (m.type === "characterData") queueText(m.target);
    }
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["src", "srcset"],
  });

  document.addEventListener("DOMContentLoaded", () => {
    scanTree(document.documentElement);
    checkPage();
  });
})();
