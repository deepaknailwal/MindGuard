importScripts("features.js");
try { importScripts("config.js"); } catch (e) {}

// ---------- Gemini (optional cloud check) ----------
const GEM_PROMPT =
  "You are a content-safety classifier for a self-help app that blocks pornography. " +
  "Does this image contain nudity or sexually explicit content? " +
  "Normal selfies, swimwear at a beach, gym photos, art, medical or baby photos are NOT explicit. " +
  'Reply only with JSON: {"explicit": true} or {"explicit": false}';

async function geminiRequest(key, model, parts) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
      safetySettings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }],
    }),
  });
  if (!r.ok) throw new Error("Gemini HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}

async function geminiExplicit(dataUrl, key, model) {
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const j = await geminiRequest(key, model, [{ inline_data: { mime_type: mime, data: b64 } }, { text: GEM_PROMPT }]);
  if (j.promptFeedback && j.promptFeedback.blockReason) return true; // Gemini blocked it itself
  const c = j.candidates && j.candidates[0];
  if (c && c.finishReason === "SAFETY") return true;
  const t = c && c.content && c.content.parts && c.content.parts.map((p) => p.text || "").join("");
  return !!JSON.parse(t.replace(/```json|```/g, "").trim()).explicit;
}

const gemCache = new Map();
let lastGem = 0;
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i += 37) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ":" + h; };

async function maybeCloud(res, msg) {
  try {
    if (!res || res.error || !msg.dataUrl) return res;
    const s = await chrome.storage.local.get(["gemEnabled", "gemKey", "gemModel", "gemAll", "gemDay", "clf", "useClf", "threshold", "ref", "useRef"]);
    const cfgKey = (globalThis.MR_CONFIG && MR_CONFIG.GEMINI_API_KEY) || "";
    const key = (s.gemKey || cfgKey || "").trim();
    const enabled = s.gemEnabled !== undefined ? s.gemEnabled : !!cfgKey;
    if (!enabled || !key) return res;

    // only borderline images (or everything if "check every image" is ON)
    const V = MR.verdict(res, { clf: s.clf, useClf: s.useClf, threshold: typeof s.threshold === "number" ? s.threshold : 0.5, ref: s.ref, useRef: s.useRef });
    const borderline = V.score >= V.limit * 0.6 && V.score <= Math.min(0.97, V.limit * 1.5);
    if (!s.gemAll && !borderline) return res;

    const k = hash(msg.dataUrl);
    if (gemCache.has(k)) { res.cloud = gemCache.get(k); return res; }

    const now = Date.now();
    if (now - lastGem < 4000) return res; // stay within the free tier limits
    const today = new Date().toISOString().slice(0, 10);
    const day = s.gemDay && s.gemDay.d === today ? s.gemDay : { d: today, n: 0 };
    if (day.n >= 500) return res;
    lastGem = now;
    day.n++;
    await chrome.storage.local.set({ gemDay: day });

    const explicit = await geminiExplicit(msg.dataUrl, key, (s.gemModel || "gemini-2.5-flash").trim());
    gemCache.set(k, explicit);
    if (gemCache.size > 300) gemCache.delete(gemCache.keys().next().value);
    res.cloud = explicit;
  } catch (e) {
    res.cloudError = String((e && e.message) || e);
    console.warn("[MindGuard] Gemini error:", res.cloudError);
  }
  return res;
}

let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Run the NSFW model locally",
      })
      .finally(() => (creating = null));
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "scan") {
    ensureOffscreen()
      .then(() =>
        chrome.runtime.sendMessage({
          target: "offscreen",
          src: msg.src,
          dataUrl: msg.dataUrl,
        })
      )
      .then((res) => maybeCloud(res, msg))
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true; // async response
  }
  if (msg.type === "geminiTest") {
    chrome.storage.local.get(["gemKey", "gemModel"]).then(async (s) => {
      const cfgKey = (globalThis.MR_CONFIG && MR_CONFIG.GEMINI_API_KEY) || "";
      const key = (msg.key || s.gemKey || cfgKey || "").trim();
      if (!key) return sendResponse({ error: "No API key entered" });
      try {
        await geminiRequest(key, (msg.model || s.gemModel || "gemini-2.5-flash").trim(), [{ text: 'Reply with JSON {"ok":true}' }]);
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ error: String((e && e.message) || e) }); }
    });
    return true;
  }
  if (msg.type === "status") {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: "offscreen", status: true }))
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "closeTab" && sender.tab) {
    chrome.tabs.remove(sender.tab.id);
  }
});
