// Opens the live site and checks: it serves the version in version.json (retrying while Pages' cache catches up),
// the page loads with no script errors, and the demo song reads back right.
const fs = require('fs'), path = require('path'), { chromium } = require(process.env.PW_PATH || 'playwright-core');
const SITE = process.env.SITE_URL || 'https://prestonnoland2020-hub.github.io/Voicing/';
const want = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version;
(async () => {
  let got = '';
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(SITE + '?t=' + Date.now(), { cache: 'no-store' }); const h = await r.text(); got = (h.match(/name="voicing-version" content="([^"]+)"/) || [])[1] || `(no version, HTTP ${r.status})`; }
    catch (e) { got = 'fetch failed: ' + e.message; }
    if (got === want) break;
    console.log(`live shows ${got}, waiting for ${want}`); await new Promise(r => setTimeout(r, 30000));
  }
  if (got !== want) { console.error(`FAIL live site is on ${got}, expected ${want}`); process.exit(1); }
  console.log('ok   live site serves', want);
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 393, height: 852 } }), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(SITE + '?t=' + Date.now()); await p.click('#demo'); await p.waitForSelector('#s-lesson:not([hidden])', { timeout: 60000 });
  const capo = await p.textContent('#fCapo'), n = (await p.$$('#chords .chord')).length; await b.close();
  const good = /2/.test(capo) && n === 4 && !errs.length;
  console.log(good ? 'ok   live demo reads capo 2 and 4 chords, no errors' : `FAIL live demo: capo "${capo}", ${n} chords, errors ${errs.join(' | ')}`);
  process.exitCode = good ? 0 : 1;
})();
