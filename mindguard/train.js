const $ = (id) => document.getElementById(id);
const MAXPER = 5000;
let busy = false;

function toast(t) {
  const el = $("toast"); el.textContent = t; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 1800);
}
async function getSet() {
  const { trainSet } = await chrome.storage.local.get("trainSet");
  return trainSet || { pos: [], neg: [] };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function featsFromVideo(f) {
  const url = URL.createObjectURL(f);
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = url;
  try {
    const ok = await withTimeout(new Promise((res) => { v.onloadedmetadata = () => res(true); v.onerror = () => res(false); }), 8000);
    if (!ok) return [];
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (!dur) return [];
    const n = Math.min(12, Math.max(1, Math.floor(dur / 2)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, Math.min(dur - 0.05, ((i + 0.5) * dur) / n));
      await withTimeout(new Promise((res) => { v.onseeked = res; v.currentTime = t; }), 4000);
      try { out.push(MR.extract(v)); } catch {}
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

async function featsFromFile(f) {
  try {
    if (f.type.startsWith("image/")) {
      const bmp = await createImageBitmap(f);
      const v = MR.extract(bmp); bmp.close();
      return [v];
    }
    if (f.type.startsWith("video/")) return await featsFromVideo(f);
  } catch {}
  return [];
}

async function addFiles(fileList, cls) {
  if (busy) return toast("Another task is still running");
  const files = [...fileList].filter((f) => /^(image|video)\//.test(f.type));
  if (!files.length) return toast("No image or video found");
  busy = true;
  const set = await getSet();
  const bar = $("pbar"), fill = $("pfill");
  bar.style.display = "block";
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    if (set[cls].length >= MAXPER) { toast("Limit (" + MAXPER + ") reached"); break; }
    const fs = await featsFromFile(files[i]);
    for (const x of fs) { if (set[cls].length < MAXPER) { set[cls].push(x); added++; } }
    fill.style.width = ((i + 1) / files.length) * 100 + "%";
    $("pmsg").textContent = "Processing: " + (i + 1) + " / " + files.length;
    if (i % 25 === 24) await chrome.storage.local.set({ trainSet: set });
  }
  await chrome.storage.local.set({ trainSet: set, trainDirty: true });
  $("pmsg").textContent = added + " examples added. Now click \"Train\".";
  setTimeout(() => (bar.style.display = "none"), 800);
  busy = false;
  render();
}

async function render() {
  const set = await getSet();
  $("cPos").textContent = set.pos.length;
  $("cNeg").textContent = set.neg.length;
  const { clf, useClf = true, trainDirty } = await chrome.storage.local.get(["clf", "useClf", "trainDirty"]);
  $("useClf").checked = useClf;
  const s = $("status");
  if (!clf) { s.className = "res"; s.textContent = "No trained model yet."; return; }
  const good = clf.valAcc >= 0.75;
  s.className = "res " + (good ? "ok" : "bad");
  s.innerHTML =
    "Model: <b>" + (good ? "active" : "weak (will not be used)") + "</b><br>" +
    "Test accuracy (on held-out examples): <b>" + (clf.valAcc * 100).toFixed(0) + "%</b><br>" +
    "NSFW caught: " + (clf.tpr * 100).toFixed(0) + "% &middot; Safe correctly identified: " + (clf.tnr * 100).toFixed(0) + "%<br>" +
    "Examples: " + clf.nPos + " NSFW, " + clf.nNeg + " safe" +
    (trainDirty ? "<br><b>New examples/feedback were added, train again.</b>" : "") +
    (good ? "" : "<br>Add more varied examples, then train again.");
}

async function doTrain() {
  if (busy) return;
  busy = true;
  $("trainBtn").disabled = true;
  $("tmsg").textContent = "Training...";
  const set = await getSet();
  const r = await MR.train(set.pos, set.neg, (p) => ($("tmsg").textContent = "Training: " + Math.round(p * 100) + "%"));
  if (r.error) { $("tmsg").textContent = r.error; }
  else {
    await chrome.storage.local.set({ clf: r.clf, trainDirty: false, useClf: true });
    $("tmsg").textContent = "Done. If you use a reference photo, set it again.";
    toast("Training complete");
  }
  $("trainBtn").disabled = false;
  busy = false;
  render();
}

// pickers + drag/drop
document.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => $("in_" + b.dataset.pick).click()));
for (const k of ["pos", "posdir", "neg", "negdir"]) {
  $("in_" + k).onchange = async (e) => {
    const cls = k.startsWith("pos") ? "pos" : "neg";
    await addFiles(e.target.files, cls);
    e.target.value = "";
  };
}
for (const [id, cls] of [["boxPos", "pos"], ["boxNeg", "neg"]]) {
  const box = $(id);
  ["dragenter", "dragover"].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove("over"); }));
  box.addEventListener("drop", (e) => addFiles(e.dataTransfer.files, cls));
}

$("trainBtn").onclick = doTrain;
$("useClf").onchange = () => chrome.storage.local.set({ useClf: $("useClf").checked }).then(() => toast("Saved"));
$("clrPos").onclick = async () => { const s = await getSet(); s.pos = []; await chrome.storage.local.set({ trainSet: s, trainDirty: true }); render(); };
$("clrNeg").onclick = async () => { const s = await getSet(); s.neg = []; await chrome.storage.local.set({ trainSet: s, trainDirty: true }); render(); };
$("clrAll").onclick = async () => {
  if (!confirm("Remove all examples and the trained model?")) return;
  await chrome.storage.local.remove(["trainSet", "clf", "trainDirty"]);
  render(); toast("Reset done");
};

(async () => {
  await render();
  // automatically retrain when feedback (false alarms) was added
  const { trainDirty } = await chrome.storage.local.get("trainDirty");
  const set = await getSet();
  if (trainDirty && set.pos.length >= 20 && set.neg.length >= 20) doTrain();
})();
