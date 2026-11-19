// UI checks in a real browser at iPhone sizes: every screen lays out without breaking, every button works,
// and the microphone flows (listen, tuner, mic refused) behave. Screenshots go to tests/out/shots/.
// Browser: CHROME_PATH, or the system Chrome (GitHub's runners have it).
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const ENG = require('../src/engine.js'), { writeWav } = require('./wav.js');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out', 'shots'), URL0 = 'file://' + path.join(ROOT, 'index.html');
fs.mkdirSync(OUT, { recursive: true });
const PHONES = [['iPhone SE', 375, 667], ['iPhone 15', 393, 852], ['iPhone 15 Pro Max', 430, 932]];
const results = []; let fails = 0;
const ok = (name, pass, info = '') => { results.push([name, pass, info]); if (!pass) fails++; console.log(pass ? 'ok  ' : 'FAIL', name, info); };
const launch = (extra = []) => chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: ['--autoplay-policy=no-user-gesture-required', ...extra] });
// layout check on the screen that's showing: no sideways scroll, nothing off the edge, buttons big enough and not on top of each other
const LAYOUT = () => {
  const W = innerWidth, probs = [], vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  if (document.documentElement.scrollWidth > W + 1) probs.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${W}px)`);
  const sheets = [...document.querySelectorAll('.sheet:not([hidden])')], scope = sheets.length ? sheets : [...document.querySelectorAll('.screen:not([hidden])')]; // an open sheet covers the screen
  const inScroller = el => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const btns = scope.flatMap(s => [...s.querySelectorAll('button, a, input, [role=button]')]).filter(vis).filter(b => !b.closest('.tabscroll, #tabWrap, #lane, #alongTab, .hscroll'));
  for (const b of btns) { const r = b.getBoundingClientRect(), id = b.id || b.dataset.view || b.dataset.back || b.textContent.trim().slice(0, 20);
    if ((r.left < -1 || r.right > W + 1) && !inScroller(b)) probs.push(`"${id}" runs off the screen (${Math.round(r.left)}..${Math.round(r.right)})`);
    if (Math.min(r.height, r.width) < 28 && b.tagName !== 'INPUT') probs.push(`"${id}" is too small to tap (${Math.round(r.width)}x${Math.round(r.height)})`); }
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) { if (btns[i].contains(btns[j]) || btns[j].contains(btns[i]) || btns[i].closest('.sticky') || btns[j].closest('.sticky')) continue; // the sticky bar floats over scrolling content on purpose
    const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect(), ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    if (ix * iy > 0.25 * Math.min(a.width * a.height, b.width * b.height)) probs.push(`"${btns[i].id || btns[i].textContent.trim().slice(0, 16)}" overlaps "${btns[j].id || btns[j].textContent.trim().slice(0, 16)}"`); }
  for (const t of scope.flatMap(s => [...s.querySelectorAll('h1,h2,p,b,small,.chord,.label')]).filter(vis)) { if (t.scrollWidth > t.clientWidth + 2 && getComputedStyle(t).overflowX === 'visible' && t.clientWidth > 0) probs.push(`text overflows: "${t.textContent.trim().slice(0, 24)}"`); }
  return probs;
};
async function page(b, phone, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: phone[1], height: phone[2] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', ...opts });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/favicon|fonts\.g/.test(m.text()) && p.errs.push(m.text()));
  await p.goto(URL0); await p.waitForTimeout(500); return p; }
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
async function layout(p, phone, screen) { const probs = await p.evaluate(LAYOUT); ok(`${phone[0]}: ${screen} lays out cleanly`, !probs.length, probs.slice(0, 4).join('; ')); await shot(p, `${phone[0].replace(/ /g, '')}-${screen}`); }
const wavFile = (name, x, sr) => { const f = path.join(os.tmpdir(), name + '.wav'); writeWav(f, x, sr); return f; };
const tone = (midi, cents, secs, sr = 48000) => { const hz = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12), n = Math.floor(secs * sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let h = 1; h <= 6; h++) v += Math.pow(h, -1.1) * Math.sin(2 * Math.PI * hz * h * i / sr); x[i] = 0.25 * v * (0.6 + 0.4 * Math.exp(-((i / sr) % 2) * 1.5)); } return x; };

const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7), run = k => !ONLY || ONLY.split(',').includes(k);
(async () => {
  // 1) every screen, every phone size, the full tap-through
  if (run('screens')) { const b = await launch();
  for (const phone of PHONES) { const p = await page(b, phone);
    ok(`${phone[0]}: version shows`, /Version \d+\.\d+\.\d+\+[0-9a-f]{7}/.test(await p.textContent('#verTxt')));
    await layout(p, phone, 'home');
    await p.click('#openLog'); await p.waitForTimeout(200); await layout(p, phone, 'problem-log'); await p.click('#closeLog');
    await p.click('#demo'); await p.waitForTimeout(400); await layout(p, phone, 'analyzing');
    await p.waitForSelector('#s-lesson:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(800);
    ok(`${phone[0]}: demo reads capo 2`, /2/.test(await p.textContent('#fCapo')), await p.textContent('#fCapo'));
    ok(`${phone[0]}: demo shows 4 chord shapes`, (await p.$$('#chords .chord')).length === 4);
    await layout(p, phone, 'lesson-chords');
    await p.click('[data-view="tab"]'); await p.waitForTimeout(800); await layout(p, phone, 'lesson-tab');
    await p.click('[data-view="both"]'); await p.waitForTimeout(800); await layout(p, phone, 'lesson-both');
    await p.click('#v-easy'); await p.waitForTimeout(200); await p.click('#v-studio');
    await p.click('#chords .chord'); await p.waitForTimeout(200);
    await p.click('#saveBtn'); await p.waitForTimeout(300); await layout(p, phone, 'save-sheet');
    await p.fill('#inTitle', 'Test song'); await p.click('#doSave'); await p.waitForTimeout(400);
    ok(`${phone[0]}: saving works`, /Saved/i.test(await p.textContent('#saveBtn')), await p.textContent('#saveBtn'));
    await p.click('#go-along'); await p.waitForTimeout(300); await layout(p, phone, 'play-along');
    await p.click('#toggle'); await p.waitForTimeout(2500); const t1 = await p.textContent('#tNow'); await p.click('#toggle');
    ok(`${phone[0]}: play-along plays`, t1 !== '0:00', t1);
    await p.click('[data-s="0.5"]'); await p.click('[data-s="1"]');
    await p.click('#s-along [data-back="lesson"]'); await p.click('#lessonBack'); await p.waitForTimeout(300);
    ok(`${phone[0]}: library count is 1`, (await p.textContent('#libCount')).trim() === '1');
    await p.click('#openLib'); await p.waitForTimeout(400); await layout(p, phone, 'library');
    await p.click('[data-open]'); await p.waitForTimeout(600); ok(`${phone[0]}: saved song opens`, await p.isVisible('#s-lesson'));
    await p.click('#lessonBack'); await p.waitForTimeout(300); await p.click('[data-del]'); await p.waitForTimeout(200); await layout(p, phone, 'library-delete');
    await p.click('[data-yes]'); await p.waitForTimeout(300); ok(`${phone[0]}: delete empties the library`, await p.isVisible('#libEmpty'));
    await p.click('#s-lib [data-back="pick"]'); await p.waitForTimeout(200);
    ok(`${phone[0]}: no script errors`, !p.errs.length, p.errs.join(' | '));
    await p.context().close(); }
  await b.close(); }

  // 2) tuner with a fake microphone: each string, sharp, flat and in tune
  if (run('tuner')) { const cases = [[40, -15, 'flat'], [45, 0, 'in'], [50, 12, 'sharp'], [55, -8, 'flat'], [59, 3, 'in'], [64, 20, 'sharp']];
  for (const [midi, c, want] of cases) { const f = wavFile(`tune-${midi}`, tone(midi, c, 6), 48000);
    const bt = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + f]);
    const p = await page(bt, PHONES[1], { permissions: ['microphone'] }); await p.click('#openTune'); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({ note: document.getElementById('tNote').textContent, read: document.getElementById('tRead').textContent, str: [...document.querySelectorAll('#tStr button')].findIndex(x => /cur|ok/.test(x.className)) }));
    const si = [40, 45, 50, 55, 59, 64].indexOf(midi), good = r.str === si && (want === 'in' ? r.read === 'In tune' : want === 'flat' ? /flat/.test(r.read) : /sharp/.test(r.read));
    ok(`tuner: string ${si + 1} at ${c > 0 ? '+' : ''}${c} cents says "${want}"`, good, `${r.note} "${r.read}" string ${r.str + 1}`);
    if (midi === 40) await layout(p, PHONES[1], 'tuner');
    await p.click('#s-tune [data-back="pick"]'); await p.waitForTimeout(200); ok(`tuner ${si + 1}: mic stops when leaving`, await p.evaluate(() => tun === null));
    ok(`tuner ${si + 1}: no script errors`, !p.errs.length, p.errs.join(' | ')); await bt.close(); } }

  // 3) listening flow with a fake microphone playing the demo song
  if (run('listen')) { const x = ENG.synthDemo(), f = wavFile('demo-mic', x, ENG.SR);
    const bl = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + f]);
    for (const phone of [PHONES[0]]) { const p = await page(bl, phone, { permissions: ['microphone'] });
      await p.click('#listen'); await p.waitForTimeout(1500); await layout(p, phone, 'listening');
      await p.waitForFunction(() => !document.getElementById('stopRec').disabled, null, { timeout: 15000 }); await p.waitForTimeout(6000);
      await p.click('#stopRec'); await p.waitForSelector('#s-lesson:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(500);
      ok('listen: mic recording reads capo 2 from the demo song', /2/.test(await p.textContent('#fCapo')), await p.textContent('#fCapo'));
      await layout(p, phone, 'lesson-from-mic'); ok('listen: no script errors', !p.errs.length, p.errs.join(' | ')); }
    await bl.close(); }

  // 4) microphone refused: a clear message, and it lands in the problem log
  if (run('refused')) { const bd = await launch(); const p = await page(bd, PHONES[1]);
    await p.click('#listen'); await p.waitForTimeout(1000);
    const msg = await p.textContent('#pickErr'), vis = await p.isVisible('#pickErr');
    ok('mic refused: tells the user what to do', vis && msg.length > 20, msg.slice(0, 80));
    ok('mic refused: written to the problem log', /\(\d+\)/.test(await p.textContent('#logN')));
    await p.click('#openTune'); await p.waitForTimeout(1000); ok('tuner mic refused: shows a message', await p.isVisible('#tErr'));
    await layout(p, PHONES[1], 'tuner-refused');
    // a crash anywhere is caught by the log
    await p.evaluate(() => setTimeout(() => { throw new Error('test crash'); })); await p.waitForTimeout(300);
    ok('problem log catches crashes', await p.evaluate(() => LOG.read().some(e => e.msg.includes('test crash'))));
    await bd.close(); }

  // 5) guitar splitter (server), against a stand-in server: hidden by default, sends the recording when switched on,
  //    reads the guitar it gets back, and still works (logged) when the server fails
  if (run('splitter')) { const x = ENG.synthDemo(), f = wavFile('demo-mic2', x, ENG.SR), clean = Buffer.from(ENG.wav(x));
    const bs = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + f]);
    { const p = await page(bs, PHONES[1]); ok('splitter: switch hidden until a server is set', !(await p.isVisible('#splitRow'))); await p.context().close(); }
    for (const [label, status] of [['server works', 200], ['server fails', 500]]) {
      const ctx = await bs.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', permissions: ['microphone'] });
      await ctx.addInitScript(() => { globalThis.SPLIT_URL_TEST = 'https://split.test'; });
      let sent = 0; await ctx.route('https://split.test/**', r => { sent = (r.request().postDataBuffer() || []).length; r.fulfill(status === 200 ? { status, body: clean, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' } } : { status, body: 'boom', headers: { 'access-control-allow-origin': '*' } }); });
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto(URL0); await p.waitForTimeout(500);
      if (status === 200) { ok('splitter: switch shows once a server is set', await p.isVisible('#splitRow')); await layout(p, PHONES[1], 'pick-with-splitter'); }
      await p.check('#splitOn'); await p.click('#listen'); await p.waitForFunction(() => !document.getElementById('stopRec').disabled, null, { timeout: 15000 }); await p.waitForTimeout(4000);
      await p.click('#stopRec'); await p.waitForSelector('#s-lesson:not([hidden])', { timeout: 90000 }); await p.waitForTimeout(300);
      ok(`splitter (${label}): sent the recording`, sent > 100000, `${sent} bytes`);
      ok(`splitter (${label}): lesson reads capo 2`, /2/.test(await p.textContent('#fCapo')), await p.textContent('#fCapo'));
      const logged = await p.evaluate(() => LOG.read().some(e => e.kind === 'splitter'));
      ok(`splitter (${label}): ${status === 200 ? 'nothing' : 'the failure'} written to the problem log`, status === 200 ? !logged : logged);
      ok(`splitter (${label}): no script errors`, !p.errs.length, p.errs.join(' | ')); await ctx.close(); }
    await bs.close(); }

  const md = `### UI checks (${results.length - fails}/${results.length} passed)\n\n${results.filter(r => !r[1]).map(r => `- ✗ ${r[0]}: ${r[2]}`).join('\n') || 'All passed.'}\n`;
  fs.writeFileSync(path.join(__dirname, 'out', 'ui.md'), md); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(`ui: ${results.length - fails}/${results.length} passed`); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
