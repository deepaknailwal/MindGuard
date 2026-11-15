const $ = (id) => document.getElementById(id);

(async () => {
  let { enabled = true, installDate, lastFlag, flagCount = 0, media = [] } =
    await chrome.storage.local.get(["enabled", "installDate", "lastFlag", "flagCount", "media"]);
  if (!installDate) { installDate = Date.now(); await chrome.storage.local.set({ installDate }); }

  const ms = Date.now() - Math.max(installDate, lastFlag || 0);
  const days = Math.floor(ms / 86400000);
  if (days >= 1) { $("days").textContent = days; $("dl").textContent = days === 1 ? "day clean" : "days clean"; }
  else { $("days").textContent = Math.floor(ms / 3600000); $("dl").textContent = "hours clean"; }
  $("fc").textContent = flagCount;
  $("mc").textContent = media.length;

  const paint = () => {
    $("state").textContent = enabled ? "Protection ON" : "Protection OFF";
    $("on").checked = enabled;
  };
  paint();
  $("on").onchange = async (e) => {
    enabled = e.target.checked;
    await chrome.storage.local.set({ enabled });
    paint();
  };

  const { clf, useClf } = await chrome.storage.local.get(["clf", "useClf"]);
  const trained = clf && useClf !== false && clf.valAcc >= 0.75;
  $("state").textContent += trained ? " · Trained mode" : " · Lite mode";
  if (!media.length) {
    const w = $("warn");
    w.style.display = "block";
    w.textContent = "No photo or video saved yet. Open Settings and add your motivation.";
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    $("site").textContent = "This page can't be protected (Chrome restriction).";
  } else {
    $("site").innerHTML = enabled ? "<b>Protection is active</b> on this site" : "Protection is off on this site";
  }

  $("opt").onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
})();
