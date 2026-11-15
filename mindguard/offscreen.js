// Hidden page that does the image work (canvas) for the content scripts.

async function toBitmap(msg) {
  let blob;
  if (msg.dataUrl) {
    blob = await (await fetch(msg.dataUrl)).blob();
  } else {
    const r = await fetch(msg.src, { credentials: "omit" });
    if (!r.ok) throw new Error("fetch failed " + r.status);
    blob = await r.blob();
  }
  return createImageBitmap(blob);
}

// Lite detector: share of skin-tone pixels, and how evenly it is spread over the image.
function skinStats(src) {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const quad = [0, 0, 0, 0];
  let skin = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const rgbSkin = r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b;
      const ycSkin = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
      if (rgbSkin && ycSkin) {
        skin++;
        quad[(y >= S / 2 ? 2 : 0) + (x >= S / 2 ? 1 : 0)]++;
      }
    }
  }
  const q = (S * S) / 4;
  return { ratio: skin / (S * S), spread: Math.min(...quad) / q };
}

async function classify(msg) {
  const bmp = await toBitmap(msg);
  const scale = Math.min(1, 299 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();

  const feat = MR.extract(c); // numbers used by the trained classifier
  const { ratio, spread } = skinStats(c);
  // Very conservative: lots of skin, spread across the whole image, before the score rises.
  let porn = Math.max(0, Math.min(1, (ratio - 0.55) / 0.3));
  if (spread < 0.35) porn *= 0.3;
  return { porn, all: { "skin ratio": ratio, "skin spread": spread, "lite score": porn }, feat };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;
  if (msg.status) { sendResponse({ ok: true }); return false; }
  classify(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});
