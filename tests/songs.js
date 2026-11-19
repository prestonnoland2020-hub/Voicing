// Synthetic test songs with exact ground truth. Shapes are frets low E -> high e, relative to the capo.
const SR = 22050, OPEN = [40, 45, 50, 55, 59, 64];
const PC = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const sh = s => [...s].map(c => c === 'x' ? -1 : parseInt(c, 36));
// chord: [shape, sounding root name at capo 0, quality family maj|min|any]
const SONGS = [
  { name: 'Wonderwall-style capo 2', bpm: 87, capo: 2, tune: 0, bars: 10, pattern: 'DDDU',
    chords: [['022033','E','min'], ['320033','G','maj'], ['xx0233','D','any'], ['x02033','A','any']],
    licks: [[3, [[1.5,0,5],[2,0,3],[2.5,1,5],[3,1,3],[3.5,0,3]]], [7, [[1.5,0,5],[2,0,3],[2.5,1,5],[3,1,3],[3.5,0,3]]]] },
  { name: 'G D Em C open', bpm: 100, capo: 0, tune: 0, bars: 12, pattern: 'D.DUUDU.',
    chords: [['320003','G','maj'], ['xx0232','D','maj'], ['022000','E','min'], ['x32010','C','maj']], licks: [] },
  { name: 'Am F C G with barre F', bpm: 120, capo: 0, tune: 0, bars: 14, pattern: 'D.DU.UDU',
    chords: [['x02210','A','min'], ['133211','F','maj'], ['x32010','C','maj'], ['320003','G','maj']],
    licks: [[5, [[2,1,1],[2.5,1,3],[3,0,0],[3.5,0,1]]]] },
  { name: 'C Am Dm G7 capo 3', bpm: 76, capo: 3, tune: 0, bars: 8, pattern: 'D.DUD.DU',
    chords: [['x32010','C','maj'], ['x02210','A','min'], ['xx0231','D','min'], ['320001','G','maj']], licks: [] },
  { name: 'E A B7 blues with licks', bpm: 132, capo: 0, tune: 0, bars: 16, pattern: 'D.DUD.DU', perChord: 2,
    chords: [['022100','E','maj'], ['x02220','A','maj'], ['x21202','B','maj'], ['022100','E','maj']],
    licks: [[3, [[1,0,0],[1.5,0,3],[2,1,0],[2.5,1,3],[3,2,2]]], [15, [[1,0,3],[1.5,0,0],[2,1,3],[2.5,1,0]]]] },
  { name: 'Bm G D A barre Bm', bpm: 92, capo: 0, tune: 0, bars: 10, pattern: 'DDUUDU..',
    chords: [['x24432','B','min'], ['320003','G','maj'], ['xx0232','D','maj'], ['x02220','A','maj']], licks: [] },
  { name: 'G D Em C tuned 30 cents flat', bpm: 110, capo: 0, tune: -30, bars: 12, pattern: 'D.DUUDU.',
    chords: [['320003','G','maj'], ['xx0232','D','maj'], ['022000','E','min'], ['x32010','C','maj']], licks: [] },
  { name: 'Em C G D capo 4 slow', bpm: 68, capo: 4, tune: 0, bars: 8, pattern: 'D..UD.DU',
    chords: [['022000','E','min'], ['x32010','C','maj'], ['320003','G','maj'], ['xx0232','D','maj']],
    licks: [[3, [[1.5,0,3],[2,0,2],[2.5,0,0],[3,1,3]]]] },
];
// real recorded guitar notes (see samples/CREDITS.md), loaded once per instrument
const BANKS = {}; function loadBank(name) { if (!BANKS[name]) { const fs = require('fs'), path = require('path'), { readWav } = require('./wav.js'), dir = path.join(__dirname, 'samples', name);
  BANKS[name] = {}; for (const f of fs.readdirSync(dir)) if (f.endsWith('.wav')) BANKS[name][parseInt(f)] = readWav(path.join(dir, f)).x; } return BANKS[name]; }
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function render(song, mix, seed = 1) {
  if (mix.stem) { const full = render(song, { ...mix, stem: null }, seed), g = render(song, { jitter: mix.jitter, real: mix.real, ...mix.stem }, seed); return { x: full.x, guitar: g.x, truth: full.truth }; }
  const rnd = rng(seed * 7919 + song.bpm), beat = 60 / song.bpm, t0 = 0.4, per = song.perChord || 1;
  const len = Math.ceil((t0 + song.bars * 4 * beat + 1.5) * SR), out = new Float32Array(len);
  const tuneK = Math.pow(2, song.tune / 1200), jit = mix.jitter || 0;
  const add = (buf, st, g) => { for (let k = 0; k < buf.length && st + k < len; k++) if (st + k >= 0) out[st + k] += buf[k] * g; };
  let pluck = (midi, dur, bright = 0.497) => { const hz = 440 * Math.pow(2, (midi - 69) / 12) * tuneK, p = SR / hz + 0.5, ip = Math.floor(p), fr = p - ip, n = Math.floor(dur * SR), b = new Float32Array(n);
    for (let k = 0; k <= ip; k++) b[k] = rnd() * 2 - 1;
    for (let k = ip + 1; k < n; k++) { const a = b[k - ip] * (1 - fr) + b[k - ip - 1] * fr, c = b[k - ip + 1] * (1 - fr) + b[k - ip] * fr; b[k] = (a + c) * bright; }
    for (let k = 0; k < n; k++) b[k] *= Math.min(1, (n - k) / 600); return b; };
  const inst = mix.real === 'rotate' ? ['acoustic', 'nylon', 'electric'][(song.bpm + song.bars) % 3] : mix.real;
  if (inst) { const bank = loadBank(inst), keys = Object.keys(bank).map(Number);
    pluck = (midi, dur) => { const m0 = keys.reduce((a, k) => Math.abs(k - midi) < Math.abs(a - midi) ? k : a), src = bank[m0], r = Math.pow(2, (midi - m0) / 12) * tuneK;
      const n = Math.min(Math.floor(dur * SR), Math.floor((src.length - 2) / r)), b = new Float32Array(n);
      for (let k = 0; k < n; k++) { const q = k * r, i = Math.floor(q), fr = q - i; b[k] = (src[i] * (1 - fr) + src[i + 1] * fr) * 2.2 * Math.min(1, (n - k) / 600); } return b; }; }
  const truth = { chords: [], licks: [], beats: [], bpm: song.bpm, capo: song.capo, tune: song.tune };
  for (let i = 0; i < song.bars * 4; i++) truth.beats.push(t0 + i * beat);
  const lickBars = new Map(song.licks.map(([b, n]) => [b, n]));
  for (let bar = 0; bar < song.bars; bar++) {
    const ci = Math.floor(bar / per) % song.chords.length, [shape, rootName, fam] = song.chords[ci], f = sh(shape);
    const tb = t0 + bar * 4 * beat;
    const last = truth.chords[truth.chords.length - 1];
    if (last && last.ci === ci && last.end >= tb - 1e-6) last.end = tb + 4 * beat; else truth.chords.push({ ci, t: tb, end: tb + 4 * beat, root: (PC.indexOf(rootName) + song.capo) % 12, fam, shape, midi: f.map((v, s) => v < 0 ? -1 : OPEN[s] + song.capo + v).filter(v => v >= 0) });
    const lick = lickBars.get(bar), slots = song.pattern.length, step = 4 / slots;
    for (let k = 0; k < slots; k++) {
      const pos = k * step; if (lick && pos >= 1) break;
      const c = song.pattern[k]; if (c === '.') continue;
      const down = c === 'D', ts = tb + pos * beat + (rnd() - 0.5) * jit;
      const strs = f.map((v, s) => [v, s]).filter(([v]) => v >= 0); if (!down) strs.reverse();
      const g = (k === 0 ? 0.3 : 0.2) * (0.85 + rnd() * 0.3);
      strs.forEach(([v, s], i) => add(pluck(OPEN[s] + song.capo + v, beat * 1.7, 0.4965), Math.floor((ts + i * 0.011) * SR), g * (down ? 1 : 0.8)));
    }
    if (lick) for (const [b, s, fr] of lick) { const st = 5 - s, midi = OPEN[st] + song.capo + fr, ts = tb + b * beat;
      add(pluck(midi, beat * 1.0, 0.4975), Math.floor(ts * SR), 0.42); truth.licks.push({ t: ts, midi, s: st, f: fr + 0 }); }
    if (mix.bass) { const root = truth.chords[truth.chords.length - 1].root; let m = 28 + ((root - 4 + 12) % 12); // E1..Eb2
      for (const b of [0, 2, 2.5]) { const ts = tb + b * beat, n = Math.floor(beat * 0.9 * SR), buf = new Float32Array(n), hz = 440 * Math.pow(2, (m + 12 - 69) / 12) * tuneK;
        for (let k = 0; k < n; k++) { const t = k / SR, e = Math.exp(-t * 3) * Math.min(1, k / 200) * Math.min(1, (n - k) / 400); buf[k] = e * (Math.sin(2 * Math.PI * hz * t) + 0.35 * Math.sin(4 * Math.PI * hz * t) + 0.15 * Math.sin(6 * Math.PI * hz * t)); }
        add(buf, Math.floor(ts * SR), mix.bass); } }
    if (mix.drums) for (let k = 0; k < 8; k++) { const ts = tb + k * beat / 2, st = Math.floor(ts * SR);
      if (k === 0 || k === 4 || k === 5) { const n = Math.floor(0.25 * SR), buf = new Float32Array(n); let ph = 0; for (let j = 0; j < n; j++) { const t = j / SR; ph += 2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) / SR; buf[j] = Math.sin(ph) * Math.exp(-t * 14); } add(buf, st, mix.drums * 1.4); }
      if (k === 2 || k === 6) { const n = Math.floor(0.18 * SR), buf = new Float32Array(n); let lp = 0; for (let j = 0; j < n; j++) { const t = j / SR, w = rnd() * 2 - 1; lp += (w - lp) * 0.5; buf[j] = (lp * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 22); } add(buf, st, mix.drums); }
      { const n = Math.floor(0.05 * SR), buf = new Float32Array(n); let pw = 0; for (let j = 0; j < n; j++) { const w = rnd() * 2 - 1; buf[j] = (w - pw) * Math.exp(-j / SR * 80); pw = w; } add(buf, st, mix.drums * 0.35); } }
  }
  if (mix.vocal) sing(out, truth, song, beat, tuneK, rnd, mix.vocal);
  if (mix.noise) for (let i = 0; i < len; i++) out[i] += (rnd() * 2 - 1) * mix.noise;
  if (mix.room) { const d = Math.floor(0.031 * SR), d2 = Math.floor(0.047 * SR); for (let i = len - 1; i >= d2; i--) out[i] += out[i - d] * 0.35 + out[i - d2] * 0.25; let lp = 0; for (let i = 0; i < len; i++) { lp += (out[i] - lp) * 0.55; out[i] = lp; } }
  let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i])); for (let i = 0; i < len; i++) out[i] *= 0.9 / pk;
  return { x: out, truth };
}
// a sung melody: chord tones with some passing notes, legato with glides and vibrato, an "ah" vowel (formants near 700 and 1150 Hz),
// rests at phrase ends. Real songs have this on top of the guitar, often louder than it.
const SCALE = [0, 2, 4, 5, 7, 9, 11];
function sing(out, truth, song, beat, tuneK, rnd, gain) {
  const len = out.length, notes = [];
  for (const c of truth.chords) { const tones = (c.fam === 'min' || c.fam === 'm7' ? [0, 3, 7] : [0, 4, 7]).map(v => (c.root + v) % 12);
    for (let t = c.t; t < c.end - 1e-6; t += beat) { if (rnd() < 0.18) continue; // breaths
      let pc = tones[Math.floor(rnd() * 3)]; if (rnd() < 0.25) pc = (truth.chords[0].root + SCALE[Math.floor(rnd() * 7)]) % 12; // passing note in the key
      let m = 57 + ((pc - 9 + 12) % 12); if (m < 60 && rnd() < 0.5) m += 12; notes.push([t, rnd() < 0.3 ? beat * 2 : beat, m]); } }
  const form = f => 1 / (1 + Math.pow((f - 700) / 160, 2)) + 0.7 / (1 + Math.pow((f - 1150) / 180, 2)) + 0.25 / (1 + Math.pow((f - 2600) / 300, 2)) + 0.04;
  let ph = 0, prevHz = 0;
  for (const [t, d, m] of notes) { const hz = 440 * Math.pow(2, (m - 69) / 12) * tuneK, st = Math.floor(t * SR), n = Math.floor(d * SR * 0.95);
    const H = Math.floor(4000 / hz), amp = []; for (let h = 1; h <= H; h++) amp.push(form(h * hz) / h); const norm = amp.reduce((a, b) => a + b, 0);
    for (let k = 0; k < n && st + k < len; k++) { const tt = k / SR, glide = prevHz && tt < 0.06 ? prevHz + (hz - prevHz) * tt / 0.06 : hz, vib = tt > 0.2 ? Math.pow(2, 0.3 * Math.sin(2 * Math.PI * 5.5 * tt) / 12) : 1;
      ph += 2 * Math.PI * glide * vib / SR; let v = 0; for (let h = 0; h < H; h++) v += amp[h] * Math.sin(ph * (h + 1));
      const env = Math.min(1, k / 600) * Math.min(1, (n - k) / 900); out[st + k] += gain * env * v / norm * 1.6; }
    prevHz = hz; }
}
const MIXES = {
  clean: { jitter: 0.01 },
  band: { jitter: 0.015, bass: 0.35, drums: 0.5 },
  phone: { jitter: 0.02, bass: 0.35, drums: 0.5, noise: 0.02, room: 1 },
  real: { jitter: 0.012, real: 'rotate' },            // real recorded guitar notes: acoustic, nylon or electric
  realband: { jitter: 0.015, real: 'rotate', bass: 0.35, drums: 0.5, noise: 0.01, room: 1 },
  // the full band song, plus the guitar as a splitter would hand it back: guitar with a little drum and bass bleed
  // a full song played out of a speaker into the phone: real guitar, bass, drums and a singer
  song: { jitter: 0.015, real: 'rotate', bass: 0.35, drums: 0.5, vocal: 0.35, noise: 0.012, room: 1 },
  stem: { jitter: 0.015, real: 'rotate', bass: 0.35, drums: 0.5, noise: 0.01, room: 1, stem: { bass: 0.35 * 0.12, drums: 0.5 * 0.15, noise: 0.004 } },
};
module.exports = { SONGS, MIXES, render, SR, OPEN, PC };
// ---- procedurally generated songs (for a bigger tuning set and a held-out set) ----
const LIB = [ // shape, root name (capo 0), family
  ['320003','G','maj'], ['x32010','C','maj'], ['xx0232','D','maj'], ['x02220','A','maj'], ['022100','E','maj'],
  ['022000','E','min'], ['x02210','A','min'], ['xx0231','D','min'], ['133211','F','maj'], ['x24432','B','min'],
  ['x21202','B','maj'], ['320001','G','maj'], ['x02020','A','maj'], ['022030','E','min'], ['x02010','A','min'], ['x35553','C','maj'], ['244222','F#','min']];
const KEYS = [ // diatonic sets that use shapes above
  ['320003','xx0232','022000','x32010','x02210'], ['x32010','x02210','133211','320003','xx0231'], ['xx0232','x02220','x24432','320003','022000'],
  ['022100','x02220','x21202','244222'], ['x02210','133211','x32010','320003','022000'], ['022000','x32010','320003','xx0232','x02210']];
const PATTERNS = ['DDDU', 'D.DUUDU.', 'D.DU.UDU', 'DDUUDU..', 'D..UD.DU', 'D.D.D.D.', 'DUDUDUDU'];
function randomSong(seed) {
  const r = rng(seed * 104729 + 13), pick = a => a[Math.floor(r() * a.length)];
  const key = pick(KEYS), n = 3 + Math.floor(r() * 2), chords = [];
  for (let i = 0; i < n; i++) { let s; do s = pick(key); while (chords.length && chords[chords.length - 1][0] === s); chords.push(LIB.find(l => l[0] === s)); }
  const bpm = 70 + Math.floor(r() * 70), capo = pick([0, 0, 0, 1, 2, 2, 3, 4, 5]), bars = Math.max(8, Math.min(16, Math.round(26 / (240 / bpm))));
  const licks = []; const nl = Math.floor(r() * 3);
  for (let i = 0; i < nl; i++) { const bar = 2 + Math.floor(r() * (bars - 3)); if (licks.some(l => Math.abs(l[0] - bar) < 2)) continue;
    const notes = [], k = 3 + Math.floor(r() * 3); let b = 1 + Math.floor(r() * 2) * 0.5;
    for (let j = 0; j < k && b <= 3.5; j++, b += 0.5) notes.push([b, Math.floor(r() * 3), Math.floor(r() * 4)]); licks.push([bar, notes]); }
  return { name: `random #${seed}`, bpm, capo, tune: pick([0, 0, 0, -15, 12, -30]), bars, pattern: pick(PATTERNS), perChord: r() < 0.25 ? 2 : 1, chords, licks };
}
const TUNE_SET = SONGS.concat(Array.from({ length: 12 }, (_, i) => randomSong(i + 1)));
const HOLDOUT = Array.from({ length: 16 }, (_, i) => randomSong(i + 101));
module.exports = { SONGS, MIXES, render, SR, OPEN, PC, TUNE_SET, HOLDOUT, randomSong };
