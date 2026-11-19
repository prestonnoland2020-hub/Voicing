const ENG = require(process.env.ENGINE || '../src/engine.js');
const { MIXES, render, OPEN, TUNE_SET, HOLDOUT, SONGS: HAND } = require('./songs.js');
const SONGS = process.argv.includes('--holdout') ? HOLDOUT : process.argv.includes('--hand') ? HAND : TUNE_SET;
const BARS = { // pass bars per mix
  clean: { chord: 0.92, voicing: 0.80, capo: 1, tempo: 1, beatF: 0.85, lickF: 0.85, tune: 1 },
  band:  { chord: 0.85, voicing: 0.65, capo: 0.75, tempo: 1, beatF: 0.80, lickF: 0.70, tune: 1 },
  phone: { chord: 0.80, voicing: 0.55, capo: 0.6, tempo: 0.85, beatF: 0.70, lickF: 0.55, tune: 1 },
  real:  { chord: 0.88, voicing: 0.70, capo: 0.85, tempo: 0.95, beatF: 0.85, lickF: 0.70, tune: 0.9 },
  stem: { chord: 0.88, voicing: 0.70, capo: 0.85, tempo: 0.95, beatF: 0.85, lickF: 0.70, tune: 0.9 },
  realband: { chord: 0.80, voicing: 0.55, capo: 0.6, tempo: 0.85, beatF: 0.70, lickF: 0.50, tune: 0.85 },
};
const parse = name => { const m = name.match(/^([A-G](?:#|b)?)(.*)$/); return { root: ENG.NOTE.indexOf(m[1]), fam: /^m(?!aj)/.test(m[2]) ? 'min' : 'maj' }; };
async function scoreOne(song, mixName, verbose) {
  const { x, truth, guitar } = render(song, MIXES[mixName], 1);
  const r = await ENG.analyze(x, null, { guitar });
  // chord accuracy on a 50 ms grid, skipping 150 ms around true changes
  let ok = 0, tot = 0; const conf = {};
  const at = t => r.timeline.find(g => g.t <= t && g.end > t);
  for (const c of truth.chords) for (let t = c.t + 0.15; t < c.end - 0.15; t += 0.05) {
    const g = at(t); tot++; if (!g || g.id < 0) { conf['none'] = (conf['none'] || 0) + 1; continue; }
    const p = parse(r.chords[g.id].sounds); const good = p.root === c.root && (c.fam === 'any' || p.fam === c.fam);
    if (good) ok++; else { const k = `${c.shape}->${r.chords[g.id].sounds}`; conf[k] = (conf[k] || 0) + 1; } }
  const chord = ok / tot;
  // voicing: for each true chord segment, the detected chord most of the time; compare sounding pitch sets (studio shape + capo)
  let vOk = 0, vTot = 0; const vBad = [];
  for (const c of truth.chords) { const cnt = {}; for (let t = c.t + 0.15; t < c.end - 0.15; t += 0.05) { const g = at(t); if (g && g.id >= 0) cnt[g.id] = (cnt[g.id] || 0) + 1; }
    const id = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; vTot++; if (id == null) { vBad.push(c.shape + '->none'); continue; }
    const st = r.chords[id].studio, mid = st.f.map((v, s) => v < 0 ? -1 : OPEN[s] + st.capo + v).filter(v => v >= 0).sort((a, b) => a - b).join(',');
    if (mid === c.midi.slice().sort((a, b) => a - b).join(',')) vOk++; else vBad.push(`${c.shape}@${truth.capo} -> ${st.f.map(v => v < 0 ? 'x' : v.toString(36)).join('')}@${st.capo}`); }
  const voicing = vOk / vTot;
  const capo = r.capo === truth.capo ? 1 : 0;
  const tempo = Math.abs(r.bpm - truth.bpm) / truth.bpm <= 0.04 ? 1 : 0;
  // beat F-measure, 70 ms window
  const used = new Set(); let hit = 0; for (const b of truth.beats) { let j = -1, dj = 0.07; r.beats.forEach((d, i) => { if (!used.has(i) && Math.abs(d - b) <= dj) { dj = Math.abs(d - b); j = i; } }); if (j >= 0) { used.add(j); hit++; } }
  const inRange = r.beats.filter(d => d >= truth.beats[0] - 0.2 && d <= truth.beats[truth.beats.length - 1] + 0.2).length;
  const bp = hit / (inRange || 1), br = hit / truth.beats.length, beatF = bp + br ? 2 * bp * br / (bp + br) : 0;
  // licks (tab notes): right pitch within 120 ms
  let lF = 1, lp = 1, lr = 1; const lBad = [];
  if (truth.licks.length || r.licks.length) { const u = new Set(); let h = 0; for (const n of truth.licks) { const j = r.licks.findIndex((d, i) => !u.has(i) && d.midi === n.midi && Math.abs(d.t - n.t) <= 0.12); if (j >= 0) { u.add(j); h++; } else lBad.push(`miss ${n.midi}@${n.t.toFixed(2)}`); }
    r.licks.forEach((d, i) => { if (!u.has(i)) lBad.push(`extra ${d.midi}@${d.t.toFixed(2)}`); });
    lp = h / (r.licks.length || 1); lr = truth.licks.length ? h / truth.licks.length : 1; lF = (lp + lr) ? 2 * lp * lr / (lp + lr) : 0; if (!truth.licks.length) lF = r.licks.length ? 0 : 1; }
  const tune = Math.abs(r.tune - truth.tune) <= 10 ? 1 : 0;
  const res = { chord, voicing, capo, tempo, beatF, lickF: lF, lp, lr, tune, hasLicks: truth.licks.length > 0, info: { bpm: r.bpm, capo: r.capo, tune: r.tune, nlick: r.licks.length, conf, vBad, lBad: lBad.slice(0, 8) } };
  if (verbose) console.log(song.name, mixName, JSON.stringify(res.info));
  return res;
}
// Usage: node tests/accuracy.js [--set tune|holdout|all] [--mix clean,band,...] [-t] [--gate] [--update-baseline]
//  --gate: fail if any score drops more than 2 points below tests/baseline.json (stops a change from making it worse)
//  Target bars above are what "good" means; they're reported, and the ones not met yet are listed honestly.
(async () => {
  const fs = require('fs'), path = require('path'), arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const setName = arg('--set') || 'all', mixes = (arg('--mix') || Object.keys(MIXES).join(',')).split(','), table = process.argv.includes('-t'), verbose = process.argv.includes('-v');
  const sets = setName === 'all' ? { tune: TUNE_SET, holdout: HOLDOUT } : { [setName]: setName === 'holdout' ? HOLDOUT : setName === 'hand' ? HAND : TUNE_SET };
  const out = {}, lines = ['| set | mix | chord | voicing | capo | tempo | beats | licks | tuning |', '|---|---|---|---|---|---|---|---|---|'], misses = [];
  for (const [sn, songs] of Object.entries(sets)) for (const mix of mixes) {
    const rows = []; for (const s of songs) rows.push(await scoreOne(s, mix, verbose));
    const avg = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
    const lickRows = rows.filter(r => r.hasLicks || r.info.nlick), lickAvg = lickRows.reduce((a, r) => a + r.lickF, 0) / (lickRows.length || 1);
    const m = { chord: avg('chord'), voicing: avg('voicing'), capo: avg('capo'), tempo: avg('tempo'), beatF: avg('beatF'), lickF: lickAvg, tune: avg('tune') };
    if (table) songs.forEach((s, i) => console.log(`${sn}/${mix} ${s.name.padEnd(34)} chord ${(rows[i].chord*100).toFixed(0).padStart(3)}%  voic ${(rows[i].voicing*100).toFixed(0).padStart(3)}%  capo ${rows[i].info.capo}/${s.capo}  bpm ${rows[i].info.bpm}/${s.bpm}  beatF ${rows[i].beatF.toFixed(2)}  lickF ${rows[i].lickF.toFixed(2)}  tune ${rows[i].info.tune}/${s.tune}`));
    const cell = k => { const ok = m[k] >= BARS[mix][k] - 1e-9; if (!ok) misses.push(`${sn}/${mix} ${k} ${(m[k]*100).toFixed(1)}% (target ${(BARS[mix][k]*100).toFixed(0)}%)`); return `${(m[k]*100).toFixed(1)}${ok ? '' : ' ✗'}`; };
    lines.push(`| ${sn} | ${mix} | ${['chord', 'voicing', 'capo', 'tempo', 'beatF', 'lickF', 'tune'].map(cell).join(' | ')} |`);
    out[`${sn}/${mix}`] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +(v * 100).toFixed(1)]));
    console.log(lines[lines.length - 1]); }
  const report = `### Accuracy (${Object.values(sets).reduce((a, s) => a + s.length, 0)} songs x ${mixes.length} mixes)\n\n${lines.join('\n')}\n\n✗ = below target. ${misses.length ? 'Not at target yet:\n' + misses.map(x => '- ' + x).join('\n') : 'Every target met.'}\n`;
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out', 'accuracy.json'), JSON.stringify(out, null, 1)); fs.writeFileSync(path.join(__dirname, 'out', 'accuracy.md'), report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  console.log('\n' + report);
  const bf = path.join(__dirname, 'baseline.json');
  if (process.argv.includes('--update-baseline')) { fs.writeFileSync(bf, JSON.stringify(out, null, 1) + '\n'); console.log('baseline updated'); }
  if (process.argv.includes('--gate')) { const base = JSON.parse(fs.readFileSync(bf, 'utf8')), drops = [];
    for (const key in base) for (const k in base[key]) if (out[key] && out[key][k] < base[key][k] - 2) drops.push(`${key} ${k}: ${out[key][k]}% (was ${base[key][k]}%)`);
    if (drops.length) { console.error('ACCURACY GOT WORSE:\n' + drops.join('\n')); process.exitCode = 1; } else console.log('Gate: no score dropped more than 2 points below the baseline.'); }
})();
