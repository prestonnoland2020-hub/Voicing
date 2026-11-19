// Engine checks: the demo track reads back exactly, odd input doesn't crash, and the output has the shape the app expects.
const ENG = require(process.env.ENGINE || '../src/engine.js'), assert = require('assert');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('demo track: capo 2, 87 BPM, four chords in order', async () => {
  const r = await ENG.analyze(ENG.synthDemo());
  assert.strictEqual(r.capo, 2); assert.ok(Math.abs(r.bpm - 87) <= 2, 'bpm ' + r.bpm);
  assert.deepStrictEqual(r.chords.map(c => c.studio.f.join(',')), ['0,2,2,0,3,3', '3,2,0,0,3,3', '-1,-1,0,2,3,3', '-1,0,2,0,3,3']);
});
test('output shape the screens rely on', async () => {
  const r = await ENG.analyze(ENG.synthDemo());
  for (const k of ['bpm', 'beats', 'tune', 'capo', 'licks', 'chords', 'timeline', 'seconds']) assert.ok(k in r, 'missing ' + k);
  for (const c of r.chords) { assert.ok(typeof c.sounds === 'string' && c.studio && Array.isArray(c.studio.f) && c.studio.f.length === 6); assert.ok(c.studio.f.every(v => v === -1 || (v >= 0 && v <= 15))); }
  for (const g of r.timeline) { assert.ok(g.end > g.t); assert.ok(g.id === -1 || g.id < r.chords.length); }
  for (const n of r.licks) assert.ok(Number.isFinite(n.t) && Number.isInteger(n.midi));
  assert.ok(r.beats.every((b, i) => i === 0 || b > r.beats[i - 1]), 'beats in order');
});
test('silence: no crash, no chords made up', async () => { const r = await ENG.analyze(new Float32Array(ENG.SR * 8)); assert.ok(r.chords.length === 0, 'chords from silence: ' + r.chords.length); });
test('noise: no crash, finite numbers', async () => { let s = 1; const x = new Float32Array(ENG.SR * 8).map(() => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3); const r = await ENG.analyze(x); assert.ok(Number.isFinite(r.bpm) && Number.isFinite(r.tune)); });
test('very short clip: no crash', async () => { const r = await ENG.analyze(ENG.synthDemo().slice(0, ENG.SR * 1)); assert.ok(r); });
test('clipped, too-loud audio still reads', async () => { const x = ENG.synthDemo().map(v => Math.max(-0.3, Math.min(0.3, v * 4))); const r = await ENG.analyze(x); assert.strictEqual(r.capo, 2); });
test('wav export round-trips length', () => { const x = new Float32Array(1000); const b = ENG.wav(x); assert.strictEqual(b.byteLength, 44 + 2000); });
(async () => { let fail = 0; for (const [name, fn] of tests) { try { await fn(); console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
  console.log(`engine: ${tests.length - fail}/${tests.length} passed`); process.exitCode = fail ? 1 : 0; })();
