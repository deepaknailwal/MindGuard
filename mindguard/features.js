// Shared: feature extraction + small classifier (logistic regression) + final decision (verdict).
// Images are never saved, only 68 numbers are extracted.
(() => {
  const S = 64;

  function extractFromPixels(d) {
    const T = S * S;
    const skin = new Uint8Array(T);
    const gray = new Float32Array(T);
    const hue = new Float32Array(12), cbh = new Float32Array(8), crh = new Float32Array(8);
    const grid = new Float32Array(16), gridEdge = new Float32Array(16), gridN = new Float32Array(16);
    let sumS = 0, sumV = 0, sumV2 = 0, lowSat = 0, nSkin = 0, nLoose = 0, centerSkin = 0, centerN = 0;

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x, p = i * 4;
        const r = d[p], g = d[p + 1], b = d[p + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const v = mx / 255, sat = mx === 0 ? 0 : (mx - mn) / mx;
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        cbh[Math.max(0, Math.min(7, Math.floor(((cb - 64) / 96) * 8)))]++;
        crh[Math.max(0, Math.min(7, Math.floor(((cr - 110) / 80) * 8)))]++;
        const rgbSkin = r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b;
        const ycSkin = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
        if (ycSkin) nLoose++;
        const cell = Math.floor(y / 16) * 4 + Math.floor(x / 16);
        gridN[cell]++;
        const isSkin = rgbSkin && ycSkin;
        if (isSkin) { skin[i] = 1; nSkin++; grid[cell]++; }
        if (x >= 16 && x < 48 && y >= 16 && y < 48) { centerN++; if (isSkin) centerSkin++; }
        if (sat > 0.2 && v > 0.2) {
          const dl = mx - mn;
          let h;
          if (mx === r) h = ((g - b) / dl) % 6; else if (mx === g) h = (b - r) / dl + 2; else h = (r - g) / dl + 4;
          h *= 60; if (h < 0) h += 360;
          hue[Math.floor(h / 30) % 12]++;
        } else lowSat++;
        sumS += sat; sumV += v; sumV2 += v * v;
      }
    }
    for (let y = 1; y < S - 1; y++) {
      for (let x = 1; x < S - 1; x++) {
        const i = y * S + x;
        const gx = gray[i + 1] - gray[i - 1], gy = gray[i + S] - gray[i - S];
        gridEdge[Math.floor(y / 16) * 4 + Math.floor(x / 16)] += Math.sqrt(gx * gx + gy * gy) / 255;
      }
    }
    // largest skin blob
    const seen = new Uint8Array(T), stack = new Int32Array(T);
    let blob = 0;
    for (let s0 = 0; s0 < T; s0++) {
      if (!skin[s0] || seen[s0]) continue;
      let sp = 0, size = 0;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const c = stack[--sp]; size++;
        const cx = c % S, cy = (c / S) | 0;
        if (cx > 0 && skin[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack[sp++] = c - 1; }
        if (cx < S - 1 && skin[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack[sp++] = c + 1; }
        if (cy > 0 && skin[c - S] && !seen[c - S]) { seen[c - S] = 1; stack[sp++] = c - S; }
        if (cy < S - 1 && skin[c + S] && !seen[c + S]) { seen[c + S] = 1; stack[sp++] = c + S; }
      }
      if (size > blob) blob = size;
    }
    const meanV = sumV / T;
    const f = [nSkin / T, nLoose / T, blob / T, centerSkin / centerN];
    for (let c = 0; c < 16; c++) f.push(grid[c] / gridN[c]);
    for (let c = 0; c < 16; c++) f.push(gridEdge[c] / gridN[c]);
    for (let c = 0; c < 12; c++) f.push(hue[c] / T);
    f.push(lowSat / T, sumS / T, meanV, Math.sqrt(Math.max(0, sumV2 / T - meanV * meanV)));
    for (let c = 0; c < 8; c++) f.push(cbh[c] / T);
    for (let c = 0; c < 8; c++) f.push(crh[c] / T);
    return f.map((v) => Math.round(v * 10000) / 10000);
  }

  function extract(src) {
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, S, S);
    return extractFromPixels(ctx.getImageData(0, 0, S, S).data);
  }

  const sig = (z) => 1 / (1 + Math.exp(-z));

  function predict(clf, f) {
    let z = clf.b;
    for (let j = 0; j < clf.w.length; j++) z += (clf.w[j] * (f[j] - clf.mean[j])) / clf.std[j];
    return sig(z);
  }

  const tick = () => new Promise((r) => setTimeout(r));

  async function fit(X, y, onProg) {
    const n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0), std = new Array(d).fill(0);
    for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
    for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n;
    for (let j = 0; j < d; j++) std[j] = Math.max(Math.sqrt(std[j]), 1e-3);
    const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));
    const nPos = y.reduce((a, b) => a + b, 0), nNeg = n - nPos;
    const wPos = n / (2 * nPos), wNeg = n / (2 * nNeg);
    const w = new Array(d).fill(0);
    let b = 0;
    const EPOCHS = 300, lr = 0.3, l2 = 0.01;
    for (let e = 0; e < EPOCHS; e++) {
      const gw = new Array(d).fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        let z = b;
        const zi = Z[i];
        for (let j = 0; j < d; j++) z += w[j] * zi[j];
        const err = (sig(z) - y[i]) * (y[i] ? wPos : wNeg);
        for (let j = 0; j < d; j++) gw[j] += err * zi[j];
        gb += err;
      }
      for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
      b -= (lr * gb) / n;
      if (e % 25 === 0) { if (onProg) onProg(e / EPOCHS); await tick(); }
    }
    return { w, b, mean, std };
  }

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // pos = NSFW vectors, neg = safe vectors
  async function train(pos, neg, onProg) {
    if (pos.length < 20 || neg.length < 20)
      return { error: "At least 20 samples are needed on each side (currently " + pos.length + " NSFW, " + neg.length + " safe)." };
    const rand = rng(42);
    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const P = shuffle(pos), N = shuffle(neg);
    const vp = Math.max(4, Math.round(P.length * 0.2)), vn = Math.max(4, Math.round(N.length * 0.2));
    const Xtr = [...P.slice(vp), ...N.slice(vn)];
    const ytr = [...P.slice(vp).map(() => 1), ...N.slice(vn).map(() => 0)];
    const m1 = await fit(Xtr, ytr, (p) => onProg && onProg(p * 0.5));
    let tp = 0, fn = 0, tn = 0, fp = 0;
    for (const f of P.slice(0, vp)) predict(m1, f) >= 0.5 ? tp++ : fn++;
    for (const f of N.slice(0, vn)) predict(m1, f) >= 0.5 ? fp++ : tn++;
    const tpr = tp / (tp + fn), tnr = tn / (tn + fp);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const all = [...pos, ...neg], yall = [...pos.map(() => 1), ...neg.map(() => 0)];
    const m = await fit(all, yall, (p) => onProg && onProg(0.5 + p * 0.5));
    return {
      clf: { ...m, valAcc: (tpr + tnr) / 2, tpr, tnr, precision, nPos: pos.length, nNeg: neg.length, trainedAt: Date.now() },
    };
  }

  // Final decision. res = result from the offscreen page ({ porn, feat }).
  function verdict(res, ctx) {
    const usable = !!(ctx.clf && ctx.useClf !== false && ctx.clf.valAcc >= 0.75 && res.feat);
    const mode = usable ? "trained" : "lite";
    const score = usable ? predict(ctx.clf, res.feat) : res.porn;
    const limit = ctx.useRef !== false && ctx.ref && ctx.ref.mode === mode ? Math.max(0.15, ctx.ref.score) : ctx.threshold;
    return { mode, score, limit, flag: score >= limit };
  }

  const MR = { extract, extractFromPixels, predict, train, verdict, DIM: 68 };
  globalThis.MR = MR;
  if (typeof module !== "undefined") module.exports = MR;
})();
