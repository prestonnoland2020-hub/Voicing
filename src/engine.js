// ===== Voicing analysis engine (runs in the browser; also testable in Node) =====
const ENG = (() => {
const SR = 22050, N = 8192, HOP = 2048, LO = 40, HI = 88, NB = HI - LO + 1;
const OPEN = [40, 45, 50, 55, 59, 64];
const NOTE = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const QUAL = { maj: [0,4,7], min: [0,3,7], '7': [0,4,7,10], m7: [0,3,7,10] };
const QSUF = { maj: '', min: 'm', '7': '7', m7: 'm7' };
const sleep = () => new Promise(r => setTimeout(r, 0));

// ---- FFT ----
const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
const rev = new Uint32Array(N); { const bits = Math.log2(N); for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; } }
const cosT = new Float32Array(N / 2), sinT = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / N); sinT[i] = Math.sin(-2 * Math.PI * i / N); }
function fftMag(x, off, re, im, mag) {
  for (let i = 0; i < N; i++) { const v = x[off + i] || 0; re[rev[i]] = v * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = s + j, b = a + half;
      const tr = re[b] * cosT[k] - im[b] * sinT[k], ti = re[b] * sinT[k] + im[b] * cosT[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
}

// ---- tempo + beat tracking (onset envelope, dynamic-programming beat tracker) ----
function onsetEnv(x) {
  // band-wise spectral flux on a small FFT: picks up soft strums as well as drums
  const n2 = 1024, h = 256, nf = Math.max(1, Math.floor((x.length - n2) / h)), w2 = new Float32Array(n2);
  for (let i = 0; i < n2; i++) w2[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n2);
  const NBd = 24, edges = []; for (let i = 0; i <= NBd; i++) edges.push(Math.round(2 + (n2 / 2 - 3) * (Math.pow(2, i * 7.5 / NBd) - 1) / (Math.pow(2, 7.5) - 1)));
  const rv = new Uint32Array(n2); { const bits = Math.log2(n2); for (let i = 0; i < n2; i++) { let r = 0, v = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (v & 1); v >>= 1; } rv[i] = r; } }
  const re = new Float32Array(n2), im = new Float32Array(n2), prev = new Float32Array(NBd), e = new Float32Array(nf), BL = new Float32Array(nf * NBd);
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < n2; i++) { re[rv[i]] = (x[f * h + i] || 0) * w2[i]; im[rv[i]] = 0; }
    for (let size = 2; size <= n2; size <<= 1) { const half = size >> 1, ang = -2 * Math.PI / size;
      for (let s = 0; s < n2; s += size) for (let j = 0; j < half; j++) { const c = Math.cos(ang * j), sn = Math.sin(ang * j), a = s + j, b = a + half;
        const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
    let flux = 0;
    for (let k = 0; k < NBd; k++) { let m = 0; for (let i = edges[k]; i < Math.max(edges[k] + 1, edges[k + 1]); i++) m += Math.hypot(re[i], im[i]); const l = Math.log(1 + 100 * m); BL[f*NBd+k] = m; if (f) flux += Math.max(0, l - prev[k]); prev[k] = l; }
    e[f] = flux;
  }
  // remove the slow trend, keep the peaks
  const out = new Float32Array(nf), W = 16; let acc = 0;
  for (let i = 0; i < nf; i++) { acc += e[i]; if (i >= 2 * W + 1) acc -= e[i - 2 * W - 1]; const c = i - W; if (c >= 0) out[c] = Math.max(0, e[c] - acc / (2 * W + 1)); }
  let mu = 0; for (let i = 0; i < nf; i++) mu += out[i]; mu /= nf || 1; let sd = 0; for (let i = 0; i < nf; i++) sd += (out[i] - mu) ** 2; sd = Math.sqrt(sd / (nf || 1)) || 1;
  for (let i = 0; i < nf; i++) out[i] /= sd;
  // drums decay in tens of ms; guitar notes ring. Share of energy that is short-lived (percussive), per band group
  const pw = new Float32Array(9), tw = new Float32Array(17); let pe = 0, te = 0, pHi = 0, tHi = 0;
  for (let f = 8; f < nf - 8; f += 2) for (let k = 0; k < NBd; k++) {
    for (let d = -8; d <= 8; d++) tw[d + 8] = BL[(f + d) * NBd + k]; const hm = tw.sort()[8];
    let c = 0; for (let d = -4; d <= 4; d++) { const kk = Math.min(NBd - 1, Math.max(0, k + d)); pw[c++] = BL[f * NBd + kk]; } const vm = pw.sort()[4];
    const v = BL[f * NBd + k] ** 2, isP = vm > hm * 2; te += v; if (isP) pe += v; if (k < 6) { tHi += v; if (isP) pHi += v; } }
  return { e: out, fps: SR / h, perc: pe / (te || 1), percLo: pHi / (tHi || 1) };
}
function tempo(x) {
  const { e, fps, perc, percLo } = onsetEnv(x), n = e.length;
  const ac = lag => { const L = Math.floor(lag), f = lag - L; let s = 0; for (let i = 0; i + L + 1 < n; i++) s += e[i] * (e[i + L] * (1 - f) + e[i + L + 1] * f); return s / Math.max(1, n - L); };
  // a beat period should also line up with 2 and 4 beats (the bar), which rules out dotted-beat answers
  const score = bpm => { const lag = fps * 60 / bpm; return ac(lag) + 0.5 * ac(2 * lag) + 0.5 * ac(4 * lag) + 0.25 * ac(lag / 2); };
  let best = 0, bestBpm = 100;
  const TC = +(globalThis.T_C ?? 110), TSD = +(globalThis.T_SD ?? 1.0);
  for (let bpm = 55; bpm <= 190; bpm += 0.25) { const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / TC) / TSD, 2)); const s = score(bpm) * w; if (s > best) { best = s; bestBpm = bpm; } }
  let beats = trackBeats(e, fps, bestBpm);
  // strummed 8ths fool the pulse into double time; then every other beat is a weaker up-strum
  const PR = +(globalThis.T_PR ?? 0);
  if (PR && bestBpm >= 110 && beats.length > 8) { const at = t => { const c = Math.round((t - 512 / SR) * fps); let m = 0; for (let k = c - 2; k <= c + 2; k++) if (k >= 0 && k < n) m = Math.max(m, e[k]); return m; };
    const par = [0, 0], cn = [0, 0]; beats.forEach((t, i) => { par[i & 1] += at(t); cn[i & 1]++; }); const a = par[0] / cn[0], b = par[1] / cn[1];
    if (globalThis.TDBG) TDBG.push({ bpm: bestBpm, ratio: +(Math.min(a, b) / Math.max(a, b)).toFixed(2) });
    if (Math.min(a, b) / Math.max(a, b) < PR) { bestBpm /= 2; beats = beats.filter((_, i) => (i & 1) === (a >= b ? 0 : 1)); } }
  return { bpm: Math.round(bestBpm), beats, env: e, fps, perc, percLo };
}
function trackBeats(e, fps, bpm) {
  const n = e.length, tau = fps * 60 / bpm, C = new Float32Array(n), back = new Int32Array(n).fill(-1), A = 100;
  for (let t = 0; t < n; t++) {
    let bv = -1e9, bp = -1;
    for (let p = Math.max(0, Math.floor(t - 2 * tau)); p <= t - Math.round(tau / 2); p++) { const v = C[p] - A * Math.pow(Math.log((t - p) / tau), 2); if (v > bv) { bv = v; bp = p; } }
    C[t] = e[t] + (bp >= 0 ? Math.max(0, bv) : 0); back[t] = bp >= 0 && bv > 0 ? bp : -1;
  }
  let t = n - 1, mx = -1e9; for (let k = Math.max(0, Math.floor(n - tau)); k < n; k++) if (C[k] > mx) { mx = C[k]; t = k; }
  const beats = []; while (t >= 0) { beats.push(t / fps + 512 / SR); t = back[t]; }
  return beats.reverse();
}

// ---- main analysis ----
// opts.guitar: the guitar alone (from the splitter server). Tempo still comes from the full song, where the drums help;
// chords, shapes and picked notes come from the guitar track.
async function analyze(full, onStep, opts = {}) {
  onStep && onStep(0, 0); await sleep();
  const T = tempo(full), { bpm, beats } = T, x = opts.guitar && opts.guitar.length > SR ? opts.guitar : full;
  const percLo = x === full ? T.percLo : onsetEnv(x).percLo;
  onStep && onStep(1, 1); await sleep();
  const frames = Math.max(1, Math.floor((x.length - N) / HOP));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
  const binHz = SR / N;
  // pass 1: tuning from spectral peaks (sample of frames)
  let cs = 0, sn = 0;
  for (let f = 0; f < frames; f += 4) {
    fftMag(x, f * HOP, re, im, mag);
    const kLo = Math.floor(100 / binHz), kHi = Math.floor(1600 / binHz);
    let mx = 0; for (let k = kLo; k < kHi; k++) if (mag[k] > mx) mx = mag[k];
    for (let k = kLo; k < kHi; k++) {
      const m = mag[k]; if (m < mx * 0.25 || m < mag[k-1] || m < mag[k+1]) continue;
      const a = mag[k-1], c = mag[k+1], p = 0.5 * (a - c) / (a - 2*m + c || 1e-9);
      const hz = (k + p) * binHz, cents = 1200 * Math.log2(hz / 440), dev = ((cents % 100) + 150) % 100 - 50;
      const ang = dev / 100 * 2 * Math.PI; cs += m * Math.cos(ang); sn += m * Math.sin(ang);
    }
    if (f % 64 === 0) await sleep();
  }
  const tune = Math.round(Math.atan2(sn, cs) / (2 * Math.PI) * 100);
  onStep && onStep(2, 2); await sleep();
  // pass 2: semitone pitch vectors
  const bins = [];
  for (let m = LO; m <= HI; m++) {
    const fc = 440 * Math.pow(2, (m - 69) / 12 + tune / 1200);
    const k0 = Math.max(1, Math.floor(fc * Math.pow(2, -0.45/12) / binHz)), k1 = Math.ceil(fc * Math.pow(2, 0.45/12) / binHz);
    bins.push([k0, k1]);
  }
  const P = new Float32Array(frames * NB), energy = new Float32Array(frames), HF = new Float32Array(frames), LF = new Float32Array(frames);
  // note-by-note model: each guitar note is a fundamental plus fading overtones; per frame we solve how much of each note is sounding
  const KMAX = Math.floor(2600 / binHz), Wt = [];
  for (let b = 0; b < NB; b++) { const f0 = 440 * Math.pow(2, (LO + b - 69) / 12 + tune / 1200), ent = new Map();
    for (let h = 1; h <= 10; h++) { const fk = f0 * h * Math.sqrt(1 + 0.00008 * h * h), kc = fk / binHz; if (kc + 3 >= KMAX) break; const amp = Math.pow(h, -0.9);
      for (let k = Math.floor(kc - 2); k <= Math.ceil(kc + 2); k++) if (k > 0) { const g = amp * Math.exp(-0.5 * ((k - kc) / 0.9) ** 2); ent.set(k, (ent.get(k) || 0) + g); } }
    let nrm = 0; for (const v of ent.values()) nrm += v * v; nrm = Math.sqrt(nrm); Wt.push([...ent].map(([k, v]) => [k, v / nrm])); }
  const G = new Float32Array(NB * NB); { const dense = Wt.map(e => { const d = new Float32Array(KMAX); for (const [k, v] of e) d[k] = v; return d; });
    for (let i = 0; i < NB; i++) for (let j = i; j < NB; j++) { let s = 0; for (const [k, v] of Wt[i]) s += v * dense[j][k]; G[i*NB+j] = G[j*NB+i] = s; } }
  const VS = new Float32Array(frames * KMAX), A = new Float32Array(frames * NB), hv = new Float32Array(NB), wv = new Float32Array(NB), gh = new Float32Array(NB), vv = new Float32Array(KMAX);
  for (let f = 0; f < frames; f++) {
    fftMag(x, f * HOP, re, im, mag);
    let tot = 0;
    for (let b = 0; b < NB; b++) { let v = 0; for (let k = bins[b][0]; k <= bins[b][1]; k++) if (mag[k] > v) v = mag[k]; P[f*NB+b] = v; tot += v; }
    energy[f] = tot;
    for (let k = 0; k < KMAX; k++) VS[f*KMAX+k] = Math.sqrt(mag[k]);
    { let lo = 0, hi = 0, all = 0; for (let k = 1; k < N / 2; k++) { const v = mag[k] * mag[k], hz = k * binHz; all += v; if (hz < 110) lo += v; else if (hz > 5000) hi += v; } HF[f] = hi / (all + 1e-12); LF[f] = lo / (all + 1e-12); }
    if (f % 48 === 0) await sleep();
  }
  // drums are short and broadband: a running median over time keeps the sustained (pitched) part of each bin
  { const MW = +(globalThis.A_MED ?? 1), tmp = new Float32Array(2 * MW + 1);
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < KMAX; k++) { if (MW) { let n = 0; for (let g = Math.max(0, f - MW); g <= Math.min(frames - 1, f + MW); g++) tmp[n++] = VS[g*KMAX+k]; const a = tmp.subarray(0, n).sort(); vv[k] = Math.min(VS[f*KMAX+k], a[n >> 1] * 1.0 + 0.5 * (VS[f*KMAX+k] - a[n >> 1]) * +(globalThis.A_KEEP ?? 0)); } else vv[k] = VS[f*KMAX+k]; }
      for (let i = 0; i < NB; i++) { let s = 0; for (const [k, v] of Wt[i]) s += v * vv[k]; wv[i] = s; hv[i] = s > 0 ? s : 0; }
      for (let it = 0; it < 30; it++) { for (let i = 0; i < NB; i++) { let s = 0; for (let j = 0; j < NB; j++) s += G[i*NB+j] * hv[j]; gh[i] = s; } for (let i = 0; i < NB; i++) hv[i] *= wv[i] / (gh[i] + 1e-9); }
      for (let i = 0; i < NB; i++) A[f*NB+i] = hv[i];
      if (f % 48 === 0) await sleep(); } }
  // normalise + log compress
  let eMax = 0; for (let f = 0; f < frames; f++) if (energy[f] > eMax) eMax = energy[f];
  // single-note onsets (licks): new energy that lands on one pitch and its overtones, not spread like a strum
  const noteEvents = [], hold = new Uint8Array(frames); // hold = frames where a lick plays over a held chord
  { let gMax = 1e-9; for (let i = 0; i < P.length; i++) if (P[i] > gMax) gMax = P[i];
    const L = new Float32Array(P.length); for (let i = 0; i < P.length; i++) L[i] = Math.log(1 + 60 * P[i] / gMax);
    // harmonic salience of each candidate note (E3..C6): fundamental plus overtones, so bass and drums count less
    const M0 = 52 - LO, M1 = 84 - LO, NM = M1 - M0 + 1, HW = [[0, 1], [12, 0.6], [19, 0.4], [24, 0.3]];
    const S = new Float32Array(frames * NM);
    let aMax = 1e-9; for (let i = 0; i < A.length; i++) if (A[i] > aMax) aMax = A[i];
    for (let f = 0; f < frames; f++) for (let j = 0; j < NM; j++) { const b = M0 + j; let s = 0, w = 0; for (const [h, wt] of HW) { w += wt; if (b + h < NB) s += wt * L[f*NB+b+h]; else if (globalThis.SAL_NORM ?? 1) w -= wt; } S[f*NM+j] = s / w; }
    const dS = new Float32Array(NM), all = [];
    const delta = f => { for (let j = 0; j < NM; j++) dS[j] = Math.max(0, S[f*NM+j] - Math.max(S[(f-1)*NM+j], S[(f-2)*NM+j])); const srt = [...dS].sort((a, b) => a - b), med = srt[NM >> 1]; for (let j = 0; j < NM; j++) dS[j] = Math.max(0, dS[j] - med); };
    for (let f = 2; f < frames; f++) { delta(f); let mx = 0; for (let j = 0; j < NM; j++) mx = Math.max(mx, dS[j]); all.push(mx); }
    const srt = [...all].sort((a, b) => a - b), thr = Math.max(0.12, srt[Math.floor(srt.length * 0.6)] * +(globalThis.THR_K ?? 1.3));
    const REL = [0, 1, -1, 12, -12, 19, -19, 24, -24, 7, -5, 11, 13, -11, -13];
    const candsA = [], strumA = [], candsB = [], strumB = [];
    { const cands = candsA, strumF = strumA; let last = -1;
      const LA = new Float32Array(A.length); for (let i = 0; i < A.length; i++) LA[i] = Math.log(1 + 40 * A[i] / aMax);
      const rs = new Float32Array(NB), tops = [];
      // rise of each note, as a share of the loudest note sounding now (linear, so near-silent templates can't fake a big jump)
      const riseAt = f => { let fm = 1e-9; for (let b = M0; b < NB; b++) fm = Math.max(fm, A[f*NB+b]);
        for (let b = 0; b < NB; b++) { const a = A[f*NB+b], p = Math.max(A[(f-1)*NB+b], A[(f-2)*NB+b]); rs[b] = a > fm * 0.2 ? Math.max(0, a - p * +(globalThis.A_DEC ?? 1)) / fm : 0; } };
      for (let f = 2; f < frames; f++) { riseAt(f); let mx = 0; for (let b = M0; b < NB; b++) mx = Math.max(mx, rs[b]); tops.push(mx); }
      const st = [...tops].sort((a, b) => a - b), athr = Math.max(+(globalThis.A_MIN ?? 0.2), st[Math.floor(st.length * +(globalThis.A_PCT ?? 0.6))] * +(globalThis.A_K ?? 1.2));
      const REL2 = [0, 12, -12, 19, -19, 24, 28];
      for (let f = 2; f < frames; f++) {
        riseAt(f);
        let m = M0; for (let b = M0 + 1; b < NB; b++) if (rs[b] > rs[m]) m = b;
        const top = rs[m]; if (top < athr) continue;
        if (m - 12 >= M0 && rs[m - 12] > top * +(globalThis.A_OCT ?? 0.6)) m -= 12;
        if (f + 1 < frames) { const nx = Math.max(0, LA[(f+1)*NB+m] - Math.max(LA[f*NB+m], LA[(f-1)*NB+m])); if (nx > rs[m] * 1.1) continue; }
        // a plucked string has overtones; a drum's pitched ring (a snare is near G3) is close to a pure tone
        if (globalThis.A_HARM ?? 1) { const rl = k => k < NB ? Math.max(0, L[f*NB+k] - Math.max(L[(f-1)*NB+k], L[(f-2)*NB+k])) : 0, r0 = rl(m);
          if (r0 > 0 && rl(m + 12) + rl(m + 19) < r0 * +(globalThis.A_HK ?? 0.5)) continue; }
        let cnt = 0; for (let b = M0; b < NB; b++) { if (REL2.includes(b - m) || Math.abs(b - m) === 1) continue; if (rs[b] > top * +(globalThis.A_REL ?? 0.4)) cnt++; }
        if (globalThis.DBG) DBG.push({ t: +((f * HOP + N / 2) / SR).toFixed(2), midi: LO + m, top: +top.toFixed(2), cnt, thr: +athr.toFixed(2) });
        if (cnt <= +(globalThis.A_CNT ?? 0)) {
          const gap = (f - last) * HOP / SR, prevN = cands[cands.length - 1];
          if (gap > 0.12 && !(prevN && prevN.midi === LO + m && (f * HOP + N / 2) / SR - prevN.t < 0.3)) { cands.push({ t: (f * HOP + N / 2) / SR, midi: LO + m, f }); last = f; }
        } else if (cnt >= 4) strumF.push(f);
      }
    }
    { const cands = candsB, strumF = strumB; let last = -1;
    for (let f = 2; f < frames; f++) {
      delta(f);
      const rise = k => Math.max(0, L[f*NB+k] - Math.max(L[(f-1)*NB+k], L[(f-2)*NB+k]));
      // a plucked string rises with its overtones; a drum's pitched thump does not
      const sup = j => { const b = M0 + j; return b + 12 < NB && rise(b + 12) < rise(b) * +(globalThis.SUP_T ?? 0.15) ? +(globalThis.SUP_W ?? 0.35) : 1; };
      const order = [...Array(NM).keys()].map(j => [j, dS[j] * sup(j)]).sort((a, b) => b[1] - a[1]);
      if (order[0][1] < thr) continue;
      const d = new Float32Array(NB); for (let b = 0; b < NB; b++) d[b] = rise(b);
      { const srt2 = [...d].sort((a, b) => a - b), med = srt2[NB >> 1]; for (let b = 0; b < NB; b++) d[b] = Math.max(0, d[b] - med); }
      let dMax = 0; for (let b = 0; b < NB; b++) if (d[b] > dMax) dMax = d[b];
      const bassOv = new Set(); for (let b = 0; b < M0; b++) if (d[b] > dMax * 0.3) for (const h of [12, 19, 24, 28]) bassOv.add(b + h);
      const H = [-1, 0, 1, 11, 12, 13, 18, 19, 20, 23, 24, 25, 28];
      let got = null, cnt = 0, ratio = 0, tried = new Set();
      for (let c = 0; c < +(globalThis.NC ?? 1) && !got; c++) {
        let m = order[c][0]; const top = order[c][1]; if (top < thr || tried.has(m)) continue;
        // the true pitch is the lowest of an octave/twelfth family that rose together
        for (const down of [12, 19, 24]) if (m - down >= 0 && dS[m - down] > dS[m] * +(globalThis.OCT_K ?? 0.6)) { m -= down; break; }
        tried.add(m);
        const b0 = M0 + m;
        if (b0 - 12 >= 0 && rise(b0 - 12) > rise(b0) * +(globalThis.BASS_K ?? 0.45)) continue; // overtone of a bass note below E3
        if (f + 1 < frames) { const nx = Math.max(0, S[(f+1)*NM+m] - Math.max(S[f*NM+m], S[(f-1)*NM+m])); if (nx > dS[m] * 1.1) continue; } // wait for its peak
        let mS = 0, sSum = 0, others = 0;
        for (let b = M0 - 1; b < NB; b++) { if (d[b] <= dMax * 0.3) continue; const rel = H.includes(b - b0); if (!rel && bassOv.has(b)) continue; sSum += d[b]; if (rel) mS += d[b]; else others++; }
        // on a drum hit the loudest rise can be the drum; judge the note against its own neighbourhood
        ratio = mS / (sSum || 1); cnt = others;
        if (globalThis.DBG) DBG.push({ t: +((f * HOP + N / 2) / SR).toFixed(2), midi: LO + b0, c, top: +top.toFixed(2), ratio: +ratio.toFixed(2), cnt, thr: +thr.toFixed(2) });
        if ((ratio > 0.68 && others <= 3) || (!globalThis.NORELAX && c > 0 && d[b0] > dMax * 0.5 && ratio > 0.45 && others <= 4)) got = m;
      }
      const mS = ratio, sSum = 1;
      if (got != null) { const m = got;
        const gap = (f - last) * HOP / SR, prevN = cands[cands.length - 1];
        if (gap > 0.12 && !(prevN && prevN.midi === LO + M0 + m && (f * HOP + N / 2) / SR - prevN.t < 0.3)) { cands.push({ t: (f * HOP + N / 2) / SR, midi: LO + M0 + m, f }); last = f; } }
      else if (cnt > 5 && mS / (sSum || 1) < 0.5) strumF.push(f);
    }
    }
    // two detectors: the note model (clean audio) and the overtone-rise test (holds up better under drums and bass)
    // how much drum is in the mix: hi-hat/snare hiss above 5 kHz, and how much it pulses (flux), relative to the guitar
    const med = a => { const t = [...a].sort((x, y) => x - y); return t[t.length >> 1]; };
    let hfFlux = 0; for (let f = 1; f < frames; f++) hfFlux += Math.abs(Math.log((HF[f] + 1e-7) / (HF[f-1] + 1e-7))); hfFlux /= Math.max(1, frames - 1);
    const drumInfo = { lf: percLo, hfFlux }; if (globalThis.DRUMDBG) DRUMDBG.push(drumInfo);
    // drums (a kick's short low thump) wreck the note model, so with drums in the mix use the overtone-rise test
    const FUSE = globalThis.L_FUSE ?? (percLo > +(globalThis.DRUM_T ?? 0.035) ? 'old' : 'act'), near = (a, b) => Math.abs(a.t - b.t) <= 0.1 && a.midi === b.midi;
    let cands, strumF;
    if (FUSE === 'old') { cands = candsB; strumF = strumB; }
    else if (FUSE === 'and') { cands = candsA.filter(a => candsB.some(b => near(a, b))); strumF = strumA.concat(strumB); }
    else if (FUSE === 'or') { cands = candsA.concat(candsB.filter(b => !candsA.some(a => near(a, b)))).sort((a, b) => a.t - b.t); strumF = strumA.filter(f => strumB.includes(f)); }
    else { cands = candsA; strumF = strumA; }
    const LDEC = +(globalThis.L_DEC ?? 0); // off: helped the tuning set, hurt held-out songs (overfit)
    // a plucked note fades; a sung note holds (or swells). Drop notes still as loud a moment later.
    if (LDEC) { const DF = +(globalThis.L_DF ?? 5), lv = (f, b) => { let v = 0; for (const h of [0, 12]) if (b + h < NB && f < frames) v += P[f*NB+b+h]; return v; };
      cands = cands.filter(c => { const b = c.midi - LO, B0 = +(globalThis.L_B ?? 2), f2 = Math.min(frames - 1, c.f + DF), v0 = Math.max(...Array.from({ length: B0 + 1 }, (_, k) => lv(Math.min(frames - 1, c.f + k), b))); return !(v0 > 0 && lv(f2, b) / v0 > LDEC); }); }
    // a lick is a run of picked notes; a lone "note" between strums is usually a strum or a ringing string
    const RUN = +(globalThis.LICK_RUN || 3), GAP = +(globalThis.LICK_GAP || 1.0);
    for (let i = 0; i < cands.length;) {
      let j = i; while (j + 1 < cands.length && cands[j + 1].t - cands[j].t <= GAP && !strumF.some(sf => sf > cands[j].f + 1 && sf < cands[j + 1].f)) j++;
      if (j - i + 1 >= RUN) { for (let k = i; k <= j; k++) noteEvents.push({ t: cands[k].t, midi: cands[k].midi });
        for (let k = cands[i].f; k <= Math.min(frames - 1, cands[j].f + Math.round(0.5 * SR / HOP)); k++) hold[k] = 1; }
      i = j + 1;
    } }
  for (let f = 0; f < frames; f++) {
    let mx = 1e-9; for (let b = 0; b < NB; b++) if (P[f*NB+b] > mx) mx = P[f*NB+b];
    for (let b = 0; b < NB; b++) P[f*NB+b] = Math.log(1 + 20 * P[f*NB+b] / mx);
  }
  // chroma + chord scores
  const labels = []; for (let r = 0; r < 12; r++) for (const q in QUAL) labels.push({ r, q });
  const S = labels.length, emit = new Float32Array(frames * (S + 1));
  const tmpl = labels.map(({ r, q }) => { const t = new Float32Array(12); QUAL[q].forEach((iv, i) => t[(r + iv) % 12] = i === 0 ? 1 : 0.85); return t; });
  const tn = tmpl.map(t => Math.hypot(...t));
  const BW = +(globalThis.B_W ?? 0.1), BN = +(globalThis.B_N ?? 12);
  const CA = +(globalThis.C_A ?? 0), CK = +(globalThis.C_K ?? 20), CS = +(globalThis.C_S ?? 1);
  for (let f = 0; f < frames; f++) {
    const ch = new Float32Array(12);
    for (let b = 0; b < NB; b++) ch[(LO + b) % 12] += P[f*NB+b] * (b < 24 ? 1.15 : 1) * (1 - CA);
    // the note model folds each note's overtones back onto the note, so a singer's overtones don't read as extra chord tones
    if (CA) { let am = 1e-9; for (let b = 0; b < NB; b++) am = Math.max(am, A[f*NB+b]); for (let b = 0; b < NB; b++) ch[(LO + b) % 12] += CA * Math.log(1 + CK * A[f*NB+b] / am) * (b < 24 ? 1.15 : 1) * CS; }
    let mean = 0; for (let i = 0; i < 12; i++) mean += ch[i]; mean /= 12;
    for (let i = 0; i < 12; i++) ch[i] = Math.max(0, ch[i] - mean * 0.6);
    const cn = Math.hypot(...ch) || 1e-9;
    // the lowest notes (bass guitar's overtones, the guitar's low strings) usually carry the root; a singer sits above them
    const bc = new Float32Array(12); if (BW) { for (let b = 0; b < BN; b++) bc[(LO + b) % 12] = Math.max(bc[(LO + b) % 12], P[f*NB+b]); let bm = 1e-9; for (let i = 0; i < 12; i++) bm = Math.max(bm, bc[i]); for (let i = 0; i < 12; i++) bc[i] /= bm; }
    for (let s = 0; s < S; s++) { let d = 0; for (let i = 0; i < 12; i++) d += ch[i] * tmpl[s][i]; emit[f*(S+1)+s] = d / cn / tn[s] - (labels[s].q.length > 2 || labels[s].q === '7' ? 0.035 : 0) + BW * bc[labels[s].r]; }
    emit[f*(S+1)+S] = energy[f] < eMax * 0.06 ? 2 : 0.25;
    if (hold[f]) for (let s = 0; s <= S; s++) emit[f*(S+1)+s] = 0;
  }
  onStep && onStep(3, 3); await sleep();
  // Viterbi smoothing
  const K = S + 1, PEN = 0.45;
  let dp = new Float32Array(K), nd = new Float32Array(K); const bp = new Uint16Array(frames * K);
  for (let s = 0; s < K; s++) dp[s] = emit[s];
  for (let f = 1; f < frames; f++) {
    let bi = 0; for (let s = 1; s < K; s++) if (dp[s] > dp[bi]) bi = s;
    for (let s = 0; s < K; s++) { const stay = dp[s], jump = dp[bi] - (hold[f] ? 1e6 : PEN); if (stay >= jump) { nd[s] = stay; bp[f*K+s] = s; } else { nd[s] = jump; bp[f*K+s] = bi; } nd[s] += emit[f*K+s]; }
    [dp, nd] = [nd, dp];
  }
  const path = new Uint16Array(frames); let bi = 0; for (let s = 1; s < K; s++) if (dp[s] > dp[bi]) bi = s;
  for (let f = frames - 1; f >= 0; f--) { path[f] = bi; bi = bp[f*K+bi]; }
  // segments
  const fs = HOP / SR; let segs = [];
  for (let f = 0; f < frames; f++) { const l = path[f]; if (segs.length && segs[segs.length-1].l === l) segs[segs.length-1].e = f + 1; else segs.push({ l, s: f, e: f + 1 }); }
  segs = segs.filter((g, i) => (g.e - g.s) * fs >= 0.5 || i === 0);
  for (let i = 1; i < segs.length; i++) segs[i].s = segs[i-1].e;
  const merged = []; for (const g of segs) { if (merged.length && merged[merged.length-1].l === g.l) merged[merged.length-1].e = g.e; else merged.push({ ...g }); }
  // per-chord mean pitch vectors
  const byLabel = new Map();
  for (const g of merged) { if (g.l === S) continue; const o = byLabel.get(g.l) || { l: g.l, dur: 0, first: g.s, v: new Float32Array(NB), n: 0 };
    o.dur += (g.e - g.s) * fs; for (let f = g.s; f < g.e; f++) { for (let b = 0; b < NB; b++) o.v[b] += P[f*NB+b]; o.n++; } byLabel.set(g.l, o); }
  let chords = [...byLabel.values()]; const total = chords.reduce((a, c) => a + c.dur, 0) || 1;
  chords = chords.filter(c => c.dur / total >= 0.03).sort((a, b) => b.dur - a.dur).slice(0, 8).sort((a, b) => a.first - b.first);
  chords.forEach(c => { for (let b = 0; b < NB; b++) c.v[b] /= c.n; let med = [...c.v].sort((a,b)=>a-b)[NB>>1]; for (let b = 0; b < NB; b++) c.v[b] = Math.max(0, c.v[b] - med); c.root = labels[c.l].r; c.q = labels[c.l].q; c.name = NOTE[c.root] + QSUF[c.q]; });
  onStep && onStep(4, 4); await sleep();
  const voc = pickVoicings(chords);
  // key (Krumhansl)
  const kmaj = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88], kmin = [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const prof = new Float32Array(12); chords.forEach(c => QUAL[c.q].forEach(iv => prof[(c.root + iv) % 12] += c.dur));
  let key = '', kb = -1e9; for (let r = 0; r < 12; r++) for (const [p, nm] of [[kmaj, ''], [kmin, 'm']]) { let s = 0; for (let i = 0; i < 12; i++) s += prof[(r + i) % 12] * p[i]; if (s > kb) { kb = s; key = NOTE[r] + (nm ? ' minor' : ' major'); } }
  const timeline = merged.map(g => ({ t: g.s * fs, end: g.e * fs, id: g.l === S ? -1 : chords.findIndex(c => c.l === g.l) }));
  // snap chord changes onto the nearest beat, then find which beat is "1"
  const period = 60 / bpm, near = t => { let lo = 0, hi = beats.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] < t) lo = m; else hi = m; } return Math.abs(beats[lo] - t) < Math.abs(beats[hi] - t) ? lo : hi; };
  const votes = [0, 0, 0, 0];
  for (let i = 1; i < timeline.length && beats.length; i++) { const b = near(timeline[i].t); if (Math.abs(beats[b] - timeline[i].t) < period * 0.4) { timeline[i].t = beats[b]; timeline[i].beat = b; votes[b % 4]++; } }
  for (let i = 0; i + 1 < timeline.length; i++) timeline[i].end = timeline[i + 1].t;
  const down = votes.indexOf(Math.max(...votes));
  // place each lick note on the neck: stay near the chord shape or the last note, so the hand moves as little as possible
  const licks = []; let pos = null;
  for (const n of noteEvents) {
    const seg = timeline[Math.max(0, timeline.findIndex((g, i) => g.t <= n.t && (!timeline[i+1] || timeline[i+1].t > n.t)))];
    const sh = seg && seg.id >= 0 ? voc.chords[seg.id].studio : null;
    const anchor = pos != null ? pos : sh ? Math.max(0, ...sh.f) : 0;
    let best = null;
    for (let st = 0; st < 6; st++) { const fr = n.midi - OPEN[st] - voc.capo; if (fr < 0 || fr > 15) continue;
      const cost = Math.abs(fr - anchor) + (5 - st) * 0.15 + (fr > 12 ? 2 : 0); if (!best || cost < best.cost) best = { st, fr, cost }; }
    if (!best) continue;
    // a note right on a chord change that belongs to that chord is the strum ringing, not a picked note
    const ch = timeline.find(g => Math.abs(g.t - n.t) < 0.2 && g.id >= 0);
    if (ch) { const cs = voc.chords[ch.id].studio; if (cs.f.some((fr, st) => fr >= 0 && (OPEN[st] + voc.capo + fr) % 12 === n.midi % 12)) continue; }
    licks.push({ t: n.t, s: best.st, f: best.fr, midi: n.midi }); pos = best.fr;
  }
  if (globalThis.ACTDBG) Object.assign(ACTDBG, { A, P, frames, NB, HOP, N, SR });
  return { bpm, beats, down, tune, key, capo: voc.capo, licks, chords: voc.chords, timeline, seconds: x.length / SR, env: envelope(energy, eMax) };
}
function envelope(energy, eMax) { const out = [], n = 60; for (let i = 0; i < n; i++) { const a = Math.floor(i * energy.length / n), b = Math.max(a + 1, Math.floor((i + 1) * energy.length / n)); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, energy[j]); out.push(m / (eMax || 1)); } return out; }

// ---- voicing library ----
// f: frets low E→high e (-1 muted); g: fingers. r: root pitch class as written (no capo).
const OPEN_SHAPES = [
  ['C','maj','x32010','032010'], ['Cadd9','maj','x32033','021034'], ['A','maj','x02220','001230'], ['Asus2','maj','x02200','001200'],
  ['G','maj','320003','210003'], ['G','maj','320033','210034'], ['E','maj','022100','023100'], ['D','maj','xx0232','000132'],
  ['Dsus4','maj','xx0233','000134'], ['Dsus2','maj','xx0230','000130'], ['A7sus4','7','x02033','002034'], ['A7sus4','maj','x02033','002034'],
  ['Am','min','x02210','002310'], ['Em','min','022000','023000'], ['Dm','min','xx0231','000231'],
  ['A7','7','x02020','002030'], ['B7','7','x21202','021304'], ['C7','7','x32310','032410'], ['D7','7','xx0212','000213'], ['E7','7','020100','020100'], ['G7','7','320001','320001'],
  ['Am7','m7','x02010','002010'], ['Em7','m7','022030','012030'], ['Em7','m7','022033','012034'], ['Dm7','m7','xx0211','000211'], ['Em7','min','022033','012034']
].map(([n, q, fr, fg]) => { const f = [...fr].map(c => c === 'x' ? -1 : +c); const root = NOTE.indexOf(n.match(/^[A-G][#b]?/)[0]); return { name: n, q, f, g: [...fg].map(Number), root, open: true }; });
function barre(r, shape, q) {
  const E = { maj: [0,2,2,1,0,0], min: [0,2,2,0,0,0], '7': [0,2,0,1,0,0], m7: [0,2,0,0,0,0] };
  const A = { maj: [-1,0,2,2,2,0], min: [-1,0,2,2,1,0], '7': [-1,0,2,0,2,0], m7: [-1,0,2,0,1,0] };
  const EG = { maj: [1,3,4,2,1,1], min: [1,3,4,1,1,1], '7': [1,3,1,2,1,1], m7: [1,3,1,1,1,1] };
  const AG = { maj: [0,1,2,3,4,1], min: [0,1,3,4,2,1], '7': [0,1,3,1,4,1], m7: [0,1,3,1,2,1] };
  const base = shape === 'E' ? E[q] : A[q], fg = shape === 'E' ? EG[q] : AG[q];
  const root = ((shape === 'E' ? 4 : 9) + r) % 12;
  return { name: NOTE[root] + QSUF[q], q, f: base.map(v => v < 0 ? -1 : v + r), g: fg, root, open: false, barre: r };
}
const BARRES = []; for (let r = 1; r <= 9; r++) for (const s of ['E','A']) for (const q in QUAL) BARRES.push(barre(r, s, q));

function expected(shape, capo) {
  const v = new Float32Array(NB);
  shape.f.forEach((fr, i) => { if (fr < 0) return; const n = OPEN[i] + capo + fr;
    [[0,1],[12,0.5],[19,0.33],[24,0.25],[28,0.2]].forEach(([d, w]) => { const b = n + d - LO; if (b >= 0 && b < NB) v[b] += w; }); });
  return v;
}
// the lowest octave counts less: a bass player doubles the root down there and would pull every chord toward a low-root barre
const VW = new Float32Array(NB).map((_, b) => b < 12 ? +(globalThis.VW_LOW ?? 0.25) : 1);
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { const w = VW[i]; d += w*a[i]*b[i]; na += w*a[i]*a[i]; nb += w*b[i]*b[i]; } return d / (Math.sqrt(na*nb) || 1e-9); };
const FAM = { maj: ['maj', '7'], '7': ['7', 'maj'], min: ['min', 'm7'], m7: ['m7', 'min'] };
function candidates(c, capo) {
  const list = [];
  // also try the close relative (G vs G7, Em vs Em7): the label can pick up a ringing note from the chord before
  const qs = FAM[c.q], qp = q => q === c.q ? 0 : -0.012;
  for (const s of OPEN_SHAPES) if ((s.root + capo) % 12 === c.root && qs.includes(s.q)) list.push({ s, bonus: 0.03 + qp(s.q) });
  // barre shapes work with a capo on too (Bm, F with a capo are common)
  for (const s of BARRES) if ((s.root + capo) % 12 === c.root && qs.includes(s.q) && s.barre + capo <= 12) list.push({ s, bonus: -0.015 - s.barre * 0.002 + qp(s.q) - (capo ? +(globalThis.BARRE_CAPO ?? 0.01) : 0) });
  return list;
}
function scoreAll(c, capo) { return candidates(c, capo).map(({ s, bonus }) => ({ s, sc: cos(expected(s, capo), c.v) + bonus - capo * 0.004 })).sort((a, b) => b.sc - a.sc); }
function pickVoicings(chords) {
  let bestCapo = 0, bestTot = -1e9;
  for (let capo = 0; capo <= 7; capo++) {
    let tot = 0; for (const c of chords) { const r = scoreAll(c, capo); tot += c.dur * (r.length ? r[0].sc : 0.2); }
    if (globalThis.CAPODBG) CAPODBG.push([capo, +(tot / chords.reduce((a, c) => a + c.dur, 0)).toFixed(3), chords.map(c => { const r = scoreAll(c, capo)[0]; return r ? c.name + ':' + r.s.f.map(v => v < 0 ? 'x' : v).join('') + ':' + r.sc.toFixed(3) : c.name + ':-'; }).join(' ')]);
    if (tot > bestTot + (capo ? +(globalThis.CAPO_M ?? 0.005) * chords.reduce((a, c) => a + c.dur, 0) : 0)) { bestTot = tot; bestCapo = capo; }
  }
  const out = chords.map(c => {
    let r = scoreAll(c, bestCapo); let capoUsed = bestCapo;
    if (!r.length) { r = scoreAll(c, 0); capoUsed = 0; }
    const top = r[0], margin = r.length > 1 ? top.sc - r[1].sc : 0.05;
    // easy version: simplest open shape at same capo, else best overall
    const easy = r.filter(x => x.s.open && x.s.f.filter(v => v > 0).length <= 3).sort((a, b) => b.sc - a.sc)[0] || top;
    const q2 = top.s.q === 'maj' && /sus/.test(top.s.name) ? c.q : top.s.q;
    return { sounds: NOTE[c.root] + QSUF[q2], dur: c.dur, studio: { ...top.s, capo: capoUsed }, easy: { ...easy.s, capo: capoUsed }, conf: margin > 0.035 ? 'high' : margin > 0.012 ? 'mid' : 'low', match: top.sc };
  });
  return { capo: bestCapo, chords: out };
}

// ---- demo track (synthesised acoustic strums, capo 2) ----
function synthDemo() {
  const bpm = 87, beat = 60 / bpm, prog = ['022033','320033','xx0233','x02033'], capo = 2, bars = 12;
  const len = Math.ceil(bars * 4 * beat * SR + SR), out = new Float32Array(len);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pluck = (midi, t0, g, durS) => { const hz = 440 * Math.pow(2, (midi - 69) / 12), p = Math.round(SR / hz), n = Math.floor(durS * SR), buf = new Float32Array(n);
    for (let k = 0; k < p; k++) buf[k] = rnd() * 2 - 1; for (let k = p; k < n; k++) buf[k] = (buf[k-p] + buf[k-p+1]) * 0.497;
    const st = Math.floor(t0 * SR); for (let k = 0; k < n && st + k < len; k++) out[st + k] += buf[k] * g * Math.min(1, (n - k) / 800); };
  const LICK = [[1.5, 0, 5], [2, 0, 3], [2.5, 1, 5], [3, 1, 3], [3.5, 0, 3]]; // [beat, string from top (0=high e,1=B), fret] relative to capo
  for (let bar = 0; bar < bars; bar++) for (let bt = 0; bt < 4; bt++) {
    if (bar % 4 === 3 && bt > 0) { if (bt === 1) LICK.forEach(([b, s, fr]) => pluck(OPEN[5 - s] + capo + fr, (bar * 4 + b) * beat, 0.42, beat * 0.9)); continue; }
    const f = [...prog[bar % 4]].map(c => c === 'x' ? -1 : +c), t0 = (bar * 4 + bt) * beat, down = bt !== 3;
    f.forEach((fr, si) => { if (fr < 0) return; const i = down ? si : 5 - si;
      const hz = 440 * Math.pow(2, (OPEN[si] + capo + fr - 69) / 12), p = Math.round(SR / hz), n = Math.floor(beat * 1.6 * SR);
      const buf = new Float32Array(n); for (let k = 0; k < p; k++) buf[k] = rnd() * 2 - 1;
      for (let k = p; k < n; k++) buf[k] = (buf[k-p] + buf[k-p+1]) * 0.497;
      const st = Math.floor((t0 + i * 0.012) * SR), g = (bt === 0 ? 0.32 : 0.22);
      for (let k = 0; k < n && st + k < len; k++) out[st + k] += buf[k] * g * Math.min(1, (n - k) / 800);
    });
  }
  return out;
}
// ---- tuner ----
// YIN pitch: the lag where the signal best matches a delayed copy of itself
function yinPitch(x, sr) {
  const W = x.length >> 1, tMin = Math.floor(sr / 1100), tMax = Math.min(W - 2, Math.ceil(sr / 60)), d = new Float32Array(tMax + 2);
  for (let tau = 1; tau <= tMax + 1; tau++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; } d[tau] = s; }
  let run = 0; d[0] = 1; for (let tau = 1; tau <= tMax + 1; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1; for (let t = tMin; t <= tMax; t++) if (d[t] < 0.15) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; tau = t; break; }
  if (tau < 0) return 0;
  // a strong 2nd overtone can make half the period look like a match. If the note an octave down has its own
  // odd overtones (1x, 3x, 5x of that lower pitch), they are real, so the true note is the lower one
  { const t2 = 2 * tau; if (t2 + 2 <= tMax) { let m = t2; for (let t = t2 - 2; t <= t2 + 2; t++) if (d[t] < d[m]) m = t;
    const N2 = x.length, amp = hz => { let re = 0, im = 0; for (let i = 0; i < N2; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N2), ph = 2 * Math.PI * hz * i / sr; re += x[i] * w * Math.cos(ph); im += x[i] * w * Math.sin(ph); } return Math.hypot(re, im); };
    const lo = sr / m, odd = amp(lo) + amp(3 * lo) + amp(5 * lo), even = amp(2 * lo) + amp(4 * lo) + amp(6 * lo);
    if (globalThis.YDBG) YDBG.push(+(odd / (even || 1)).toFixed(3));
    if (d[m] < 0.3 && odd > even * +(globalThis.Y_R ?? 0.2)) { tau = m; while (tau + 1 <= tMax && d[tau + 1] < d[tau]) tau++; } } }
  const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c, sh = den ? (a - c) / (2 * den) : 0;
  return sr / (tau + Math.max(-1, Math.min(1, sh)));
}
const TUNER_STRINGS = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
// one tuner reading: smooths over the last 5 pitches, ignores octave slips, and says which way to turn the peg
function tunerStep(st, hz) {
  if (!hz || hz < 60 || hz > 1100) return null;
  const midiF = 69 + 12 * Math.log2(hz / 440); st.hist = st.hist || []; st.hist.push(midiF); if (st.hist.length > 5) st.hist.shift();
  const sorted = [...st.hist].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  if (Math.abs(midiF - med) > 0.6) return null;
  const note = Math.round(med), cents = (med - note) * 100;
  st.cents = st.note === note ? st.cents * 0.6 + cents * 0.4 : cents; st.note = note;
  const inTune = Math.abs(st.cents) <= 5, r = Math.round(st.cents);
  let string = -1, bd = 99; TUNER_STRINGS.forEach((m, i) => { const d = Math.abs(med - m); if (d < bd) { bd = d; string = i; } }); if (bd >= 2.5) string = -1;
  return { midi: med, note, cents: st.cents, inTune, string, label: inTune ? 'In tune' : r < 0 ? `${-r} cents flat. Tighten.` : `${r} cents sharp. Loosen.` };
}
function wav(x) {
  const b = new ArrayBuffer(44 + x.length * 2), d = new DataView(b), w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  w(0,'RIFF'); d.setUint32(4, 36 + x.length*2, true); w(8,'WAVEfmt '); d.setUint32(16,16,true); d.setUint16(20,1,true); d.setUint16(22,1,true);
  d.setUint32(24,SR,true); d.setUint32(28,SR*2,true); d.setUint16(32,2,true); d.setUint16(34,16,true); w(36,'data'); d.setUint32(40,x.length*2,true);
  for (let i = 0; i < x.length; i++) d.setInt16(44 + i*2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return b;
}
return { analyze, tempo, yinPitch, tunerStep, TUNER_STRINGS, synthDemo, wav, SR, OPEN, NOTE };
})();
if (typeof module !== 'undefined') module.exports = ENG;
