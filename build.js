// Builds index.html (the live site) from src/. Run: node build.js   Check only: node build.js --check
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const pkg = JSON.parse(rd('package.json'));
const body = rd('src/app.html').replace('/*ENGINE*/', () => rd('src/engine.js')).replace('<title>Voicing Guitar Prototype</title>', '<title>Voicing</title>');
// The guitar splitter's address, once it's deployed (server/README.md). Empty file or no file: the switch stays hidden.
const splitFile = path.join(__dirname, 'server', 'split-url.txt'), split = fs.existsSync(splitFile) ? fs.readFileSync(splitFile, 'utf8').trim() : '';
if (split && !/^https:\/\/[a-z0-9.-]+\.modal\.run\/?$/.test(split)) { console.error('server/split-url.txt must be one https://….modal.run address'); process.exit(1); }
const page = (rd('src/head.html') + body.slice(body.indexOf('<title>'))).split("'/*SPLIT_URL*/'.startsWith('/*') ? '' : '/*SPLIT_URL*/'").join(JSON.stringify(split));
const hash = crypto.createHash('sha256').update(page).digest('hex').slice(0, 7), version = `${pkg.version}+${hash}`;
const out = page.split('/*VERSION*/').join(version).replace('<title>Voicing</title>', `<title>Voicing</title><meta name="voicing-version" content="${version}">`);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync('index.html') ? rd('index.html') : '';
  if (cur !== out) { console.error('index.html is out of date. Run: node build.js'); process.exit(1); }
  console.log('index.html is up to date:', version);
} else {
  fs.writeFileSync(path.join(__dirname, 'index.html'), out);
  fs.writeFileSync(path.join(__dirname, 'version.json'), JSON.stringify({ version }, null, 1) + '\n');
  console.log('built', version, out.length, 'bytes');
}
