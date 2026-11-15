(async () => {
  const { media = [], message = "", installDate = Date.now(), lastFlag = 0 } =
    await chrome.storage.local.get(["media", "message", "installDate", "lastFlag"]);

  document.getElementById("msg").textContent =
    message || "Stop. You decided to quit this yourself.";

  document.getElementById("streak").textContent = "You are stopping yourself. That is the win.";

  if (media.length) {
    const m = media[Math.floor(Math.random() * media.length)];
    let el;
    if (m.type.startsWith("video")) {
      el = document.createElement("video");
      el.controls = true; el.autoplay = true; el.loop = true;
    } else {
      el = document.createElement("img");
    }
    el.id = "media";
    el.src = m.dataUrl;
    document.getElementById("holder").appendChild(el);
  }

  document.getElementById("close").onclick = () =>
    chrome.runtime.sendMessage({ type: "closeTab" });

  const fb = document.getElementById("false");
  let left = 15;
  fb.textContent = `False alarm (${left})`;
  const t = setInterval(() => {
    left--;
    fb.textContent = left > 0 ? `False alarm (${left})` : "False alarm";
    if (left <= 0) { clearInterval(t); fb.disabled = false; }
  }, 1000);
  fb.onclick = () => parent.postMessage({ ngAction: "dismiss" }, "*");
})();
