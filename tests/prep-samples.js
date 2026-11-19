// one-time: turn the real guitar recordings (tonejs-instruments, CC-BY 3.0) into small 22.05 kHz files named by MIDI note
const fs = require('fs'), path = require('path'), { readWav, writeWav } = require('./wav.js');
const SRC = process.argv[2], OUT = path.join(__dirname, 'samples'), NAMES = { 'guitar-acoustic': 'acoustic', 'guitar-nylon': 'nylon', 'guitar-electric': 'electric' };
const PCN = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
const TAPS = 63, h = new Float32Array(TAPS); { let s = 0; for (let i = 0; i < TAPS; i++) { const k = i - (TAPS - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (TAPS - 1)); h[i] = (k ? Math.sin(Math.PI * 0.45 * k) / (Math.PI * k) : 0.45) * w; s += h[i]; } for (let i = 0; i < TAPS; i++) h[i] /= s; }
for (const [dir, name] of Object.entries(NAMES)) { fs.mkdirSync(path.join(OUT, name), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, dir)).filter(f => f.endsWith('.wav'))) {
    const m = f.match(/^([A-G]s?)(\d)\.wav$/); const midi = 12 * (+m[2] + 1) + PCN[m[1]];
    const { sr, x } = readWav(path.join(SRC, dir, f)); if (sr !== 44100) throw new Error(f + ' ' + sr);
    let st = 0; while (st < x.length && Math.abs(x[st]) < 0.003) st++; st = Math.max(0, st - 40);
    const n = Math.min(Math.floor((x.length - st) / 2), Math.floor(3.0 * 22050)), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let t = 0; t < TAPS; t++) { const k = st + 2 * i + t - (TAPS - 1) / 2; if (k >= 0 && k < x.length) s += x[k] * h[t]; } y[i] = s * Math.min(1, (n - i) / 2000); }
    writeWav(path.join(OUT, name, midi + '.wav'), y, 22050); } }
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `Real guitar note recordings used by the "real" test mixes.

From tonejs-instruments by Nicholas Brosowsky (https://github.com/nbrosowsky/tonejs-instruments), licensed CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
Original sources per that project: acoustic guitar from the University of Iowa Musical Instrument Samples, electric guitar from Karoryfer, nylon guitar from Freesound (quartertone, classicalguitar-multisampled).
Changed here: resampled to 22.05 kHz, trimmed to 3 s, renamed by MIDI note number.
`);
