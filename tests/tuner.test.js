// Tuner: every string, in tune and off by a known number of cents, at the two phone mic rates.
// Feeds the app's own pitch code (ENG.yinPitch + ENG.tunerStep) the way the screen does: 4096-sample mic frames, halved at >= 44 kHz.
const ENG = require(process.env.ENGINE || '../src/engine.js'), path = require('path'), fs = require('fs'), { readWav } = require('./wav.js');
const NAMES = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], OFFS = [-30, -12, -6, -3, 0, 3, 6, 12, 30];
const bank = name => { const d = path.join(__dirname, 'samples', name), b = {}; for (const f of fs.readdirSync(d)) if (f.endsWith('.wav')) b[parseInt(f)] = readWav(path.join(d, f)).x; return b; };
// a plucked string with fading overtones, exact pitch
function synth(hz, sr, secs) { const n = Math.floor(sr * secs), x = new Float32Array(n);
  for (let h = 1; h <= 8; h++) { const a = Math.pow(h, -1.1), dec = 1.2 + 0.6 * h; for (let i = 0; i < n; i++) x[i] += a * Math.exp(-dec * i / sr) * Math.sin(2 * Math.PI * hz * h * Math.sqrt(1 + 0.00005 * h * h) * i / sr); }
  return x; }
// a real recorded note, retuned by resampling
function real(b, midi, cents, sr, secs) { const src = b[midi] || b[Object.keys(b).map(Number).reduce((a, k) => Math.abs(k - midi) < Math.abs(a - midi) ? k : a)], m0 = b[midi] ? midi : null;
  const r = Math.pow(2, cents / 1200) * 22050 / sr, n = Math.min(Math.floor(sr * secs), Math.floor((src.length - 2) / r)), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const q = i * r, k = Math.floor(q), f = q - k; x[i] = src[k] * (1 - f) + src[k + 1] * f; } return m0 == null ? null : x; }
function readTuner(x, sr) { const st = {}, ds = sr >= 44000 ? 2 : 1, F = 4096, hop = Math.round(sr / 30); let rd = null;
  for (let s = Math.round(0.12 * sr); s + F <= Math.min(x.length, 1.6 * sr); s += hop) { const y = new Float32Array(F / ds);
    for (let i = 0; i < y.length; i++) y[i] = ds === 2 ? (x[s + 2 * i] + x[s + 2 * i + 1]) / 2 : x[s + i];
    const r = ENG.tunerStep(st, ENG.yinPitch(y, sr / ds)); if (r) rd = r; }
  return rd; }
let fails = 0, n = 0; const worst = {};
const check = (label, rd, midi, expect, tol) => { n++; const ok = rd && rd.note === midi && Math.abs(rd.cents - expect) <= tol && rd.string === ENG.TUNER_STRINGS.indexOf(midi) &&
  (Math.abs(expect) <= 3 ? rd.inTune : Math.abs(expect) >= 6 ? !rd.inTune && (expect < 0) === (rd.cents < 0) : true);
  const err = rd ? Math.abs(rd.cents - expect) : 99; worst[label.split(' ')[0]] = Math.max(worst[label.split(' ')[0]] || 0, err);
  if (!ok) { fails++; console.log('FAIL', label, rd ? `read ${rd.note} ${rd.cents.toFixed(1)}c "${rd.label}"` : 'no reading'); } };
for (const sr of [44100, 48000]) ENG.TUNER_STRINGS.forEach((midi, si) => { for (const c of OFFS) {
  const hz = 440 * Math.pow(2, (midi - 69 + c / 100) / 12);
  check(`synth ${NAMES[si]} ${c > 0 ? '+' : ''}${c}c @${sr}`, readTuner(synth(hz, sr, 1.8), sr), midi, c, 1.0); } });
// real recordings: first measure each recorded note's own pitch, then detune it and expect the reading to move by exactly that much
for (const inst of ['acoustic', 'nylon', 'electric']) { const b = bank(inst);
  ENG.TUNER_STRINGS.forEach((midi, si) => { const base = real(b, midi, 0, 48000, 1.8); if (!base) return; const r0 = readTuner(base, 48000); if (!r0) { fails++; n++; console.log('FAIL no reading', inst, NAMES[si]); return; }
    const own = r0.cents + (r0.note - midi) * 100;
    for (const c of OFFS) for (const sr of [44100, 48000]) check(`${inst} ${NAMES[si]} ${c > 0 ? '+' : ''}${c}c @${sr} (recorded ${own.toFixed(1)}c)`, readTuner(real(b, midi, c, sr, 1.8), sr), midi, own + c, 2.0); }); }
console.log(`tuner: ${n - fails}/${n} readings right; worst error in cents ${JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)])))}`);
process.exitCode = fails ? 1 : 0;
