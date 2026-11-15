const $ = (id) => document.getElementById(id);

function toast(t) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 1800);
}

// slider: left = less strict (high threshold), right = more strict (low threshold)
const toSlider = (th) => +(1.15 - th).toFixed(2);
const toTh = (s) => +(1.15 - s).toFixed(2);
function levelName(th) {
  if (th <= 0.35) return "Very strict";
  if (th <= 0.55) return "Strict";
  if (th <= 0.75) return "Balanced";
  return "Light";
}

async function render() {
  const { media = [], message = "", threshold = 0.5 } =
    await chrome.storage.local.get(["media", "message", "threshold"]);
  $("message").value = message;
  $("th").value = toSlider(threshold);
  $("lvl").textContent = levelName(threshold);

  const list = $("list");
  list.innerHTML = "";
  $("empty").style.display = media.length ? "none" : "block";
  media.forEach((m, i) => {
    const d = document.createElement("div");
    d.className = "item";
    const el = document.createElement(m.type.startsWith("video") ? "video" : "img");
    el.src = m.dataUrl;
    if (el.tagName === "VIDEO") el.muted = true;
    const b = document.createElement("button");
    b.textContent = "×";
    b.title = "Remove";
    b.onclick = async () => {
      media.splice(i, 1);
      await chrome.storage.local.set({ media });
      render();
      toast("Removed");
    };
    d.append(el, b);
    list.appendChild(d);
  });
}

function readFile(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ type: f.type, dataUrl: r.result });
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

async function addFiles(fileList) {
  const { media = [] } = await chrome.storage.local.get("media");
  let added = 0;
  for (const f of fileList) {
    if (!/^(image|video)\//.test(f.type)) continue;
    if (f.size > 20 * 1024 * 1024) { toast(f.name + " is larger than 20MB"); continue; }
    media.push(await readFile(f));
    added++;
  }
  await chrome.storage.local.set({ media });
  render();
  if (added) toast(added + " file(s) added");
}

$("files").onchange = async (e) => { await addFiles(e.target.files); e.target.value = ""; };
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

$("saveMsg").onclick = () =>
  chrome.storage.local.set({ message: $("message").value }).then(() => toast("Saved"));

$("th").oninput = (e) => {
  const th = toTh(parseFloat(e.target.value));
  $("lvl").textContent = levelName(th);
  chrome.storage.local.set({ threshold: th });
};

render();

// ---------- detector status + test ----------
(async () => {
  const el = $("mstat");
  try {
    const r = await chrome.runtime.sendMessage({ type: "status" });
    if (r && r.ok) { el.textContent = "Detector is running. Train it with your own examples for better accuracy."; el.className = "mstat ok"; }
    else { el.textContent = "Detector failed to start: " + ((r && r.error) || "no response"); el.className = "mstat bad"; }
  } catch (e) {
    el.textContent = "Error: " + e; el.className = "mstat bad";
  }
})();

async function loadCtx() {
  const s = await chrome.storage.local.get(["clf", "useClf", "threshold", "ref", "useRef"]);
  return { clf: s.clf || null, useClf: s.useClf, threshold: typeof s.threshold === "number" ? s.threshold : 0.5, ref: s.ref || null, useRef: s.useRef };
}

$("testfile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const out = $("testout");
  out.textContent = "Checking...";
  const d = await readFile(f);
  const r = await chrome.runtime.sendMessage({ type: "scan", dataUrl: d.dataUrl });
  if (!r || r.error) { out.textContent = "Error: " + ((r && r.error) || "no response"); return; }
  const V = MR.verdict(r, await loadCtx());
  const lines = Object.entries(r.all || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ": " + (v * 100).toFixed(1) + "%");
  const names = { lite: "Lite detector", trained: "Trained model" };
  const flagIt = r.cloud !== undefined ? r.cloud : V.flag;
  out.innerHTML = lines.join("<br>") + (lines.length ? "<br><br>" : "") + "Mode: <b>" + names[V.mode] + "</b><br>Score: <b>" +
    V.score.toFixed(2) + "</b> (limit " + V.limit.toFixed(2) + ")" +
    (r.cloud !== undefined ? "<br>Gemini: <b>" + (r.cloud ? "said explicit" : "said not explicit") + "</b>" : r.cloudError ? "<br>Gemini error: " + r.cloudError : "") +
    "<br>&rarr; " + (flagIt ? "<b>Will be FLAGGED</b>" : "Will not be flagged");
  e.target.value = "";
};

(async () => {
  const { clf } = await chrome.storage.local.get("clf");
  const el = $("trstat");
  if (!clf) { el.textContent = "Not trained yet."; return; }
  const good = clf.valAcc >= 0.75;
  el.className = "mstat " + (good ? "ok" : "bad");
  el.textContent = (good ? "Trained model active" : "Trained model is weak, it will not be used") + ": accuracy " + (clf.valAcc * 100).toFixed(0) + "% (" + clf.nPos + " NSFW, " + clf.nNeg + " safe examples)";
})();

// ---------- features ----------
const FEATS = ["images", "video", "text", "audio"];
(async () => {
  const { features = {} } = await chrome.storage.local.get("features");
  FEATS.forEach((k) => {
    $("f_" + k).checked = features[k] !== false;
    $("f_" + k).onchange = async () => {
      const { features: f = {} } = await chrome.storage.local.get("features");
      f[k] = $("f_" + k).checked;
      await chrome.storage.local.set({ features: f });
      toast("Saved");
    };
  });
})();

// ---------- reference ----------
async function renderRef() {
  const { ref, useRef = true } = await chrome.storage.local.get(["ref", "useRef"]);
  const el = $("refstat");
  if (ref) {
    el.className = "mstat ok";
    el.innerHTML = "Reference is set (" + ({ lite: "Lite", trained: "Trained" }[ref.mode] || ref.mode) + " mode), score <b>" + ref.score.toFixed(2) +
      "</b>. Anything above it will be flagged.";
  } else {
    el.className = "mstat";
    el.textContent = "No reference yet. The sensitivity slider is being used.";
  }
  $("refclear").style.display = ref ? "" : "none";
  $("usref").checked = useRef;
}
$("usref").onchange = () => chrome.storage.local.set({ useRef: $("usref").checked }).then(() => toast("Saved"));
$("refclear").onclick = async () => { await chrome.storage.local.remove("ref"); renderRef(); toast("Reference removed"); };
$("reffile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const d = await readFile(f);
  const r = await chrome.runtime.sendMessage({ type: "scan", dataUrl: d.dataUrl });
  e.target.value = "";
  if (!r || r.error) { toast("Error: " + ((r && r.error) || "no response")); return; }
  const V = MR.verdict(r, { ...(await loadCtx()), ref: null });
  await chrome.storage.local.set({ ref: { score: V.score, mode: V.mode }, useRef: true });
  renderRef();
  toast("Reference set");
};
renderRef();

// ---------- custom words ----------
(async () => {
  const { customWords = [] } = await chrome.storage.local.get("customWords");
  $("words").value = customWords.join(", ");
})();
$("saveWords").onclick = async () => {
  const customWords = $("words").value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  await chrome.storage.local.set({ customWords });
  toast("Words saved");
};

// ---------- Gemini ----------
async function renderGem() {
  const s = await chrome.storage.local.get(["gemEnabled", "gemKey", "gemModel", "gemAll", "gemDay"]);
  $("gemOn").checked = !!s.gemEnabled;
  $("gemKey").value = s.gemKey || "";
  $("gemModel").value = s.gemModel || "gemini-2.5-flash";
  $("gemAll").checked = !!s.gemAll;
  const today = new Date().toISOString().slice(0, 10);
  const n = s.gemDay && s.gemDay.d === today ? s.gemDay.n : 0;
  $("gemStat").textContent = "Gemini calls today: " + n + " (limit 500)";
}
$("gemSave").onclick = async () => {
  await chrome.storage.local.set({
    gemEnabled: $("gemOn").checked,
    gemKey: $("gemKey").value.trim(),
    gemModel: $("gemModel").value.trim() || "gemini-2.5-flash",
    gemAll: $("gemAll").checked,
  });
  toast("Gemini settings saved");
  renderGem();
};
$("gemTest").onclick = async () => {
  const st = $("gemStat");
  st.className = "mstat"; st.textContent = "Testing...";
  const r = await chrome.runtime.sendMessage({ type: "geminiTest", key: $("gemKey").value.trim(), model: $("gemModel").value.trim() });
  if (r && r.ok) { st.className = "mstat ok"; st.textContent = "Key works, Gemini is running. Now click Save."; }
  else { st.className = "mstat bad"; st.textContent = "Error: " + ((r && r.error) || "no response"); }
};
renderGem();
