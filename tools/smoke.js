/*
 * Smoke test — boots the real index.html in a headless DOM and reports
 * anything that would have thrown in the browser.
 *
 *   npm install jsdom      (once)
 *   node tools/smoke.js
 *
 * How it loads the code matters.  Each js/ file is injected as its OWN
 * <script> element, in document order — the same thing Chrome does.  That
 * keeps the shared top-level const/let scope that classic scripts get.
 * Reading the files and eval()-ing them instead would give a false result:
 * separate eval() calls each get their own lexical scope, so cross-file
 * const references would fail here that work fine in the browser.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* pull the referenced files out of index.html, in order */
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">/g)].map(m => m[1]);
const jsFiles = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);

[...cssFiles, ...jsFiles].forEach(f => {
  if (!fs.existsSync(path.join(ROOT, f))) errors.push('index.html references missing file: ' + f);
});
if (errors.length) {
  errors.forEach(e => console.log('FAIL  ' + e));
  process.exit(1);
}

/* inline each script file as its own <script> element */
const inlined = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => {
  const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return '<script>\n' + body + '\n</script>';
});

/* the app logs a fetch failure when the sheet is unreachable; that is the
   correct offline behaviour, not a defect, so it must not fail the test */
const EXPECTED = /offline \(smoke test\)/;

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = (e && e.message) ? e.message : String(e);
  if (!EXPECTED.test(m)) errors.push('uncaught: ' + m);
});
vc.on('error', (...a) => {
  const m = a.join(' ').slice(0, 200);
  if (!EXPECTED.test(m)) errors.push('console.error: ' + m);
});
vc.on('warn', (...a) => warnings.push('console.warn: ' + a.join(' ').slice(0, 200)));

const dom = new JSDOM(inlined, {
  url: 'https://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const win = dom.window;

/* the app calls Apps Script on boot — keep the test offline and quiet */
win.fetch = () => Promise.reject(new Error('offline (smoke test)'));

setTimeout(check, 1500);

function check() {
  const doc = win.document;

  /* 1. functions the inline on*= handlers call must exist */
  const called = new Set();
  for (const m of html.matchAll(/\bon(?:click|change|input|submit|keyup|blur)\s*=\s*"([^"]*)"/g)) {
    for (const f of m[1].matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) called.add(f[1]);
  }
  const kw = new Set(['if', 'for', 'while', 'return', 'typeof', 'switch', 'catch', 'function', 'new']);
  const missing = [...called].filter(n => !kw.has(n) && typeof win[n] !== 'function');

  /* 2. ids the code looks up should exist in the markup */
  const wanted = new Set();
  for (const f of jsFiles) {
    const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const i of body.matchAll(/\$\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) wanted.add(i[1]);
  }
  const absent = [...wanted].filter(id => !doc.getElementById(id));

  /* 3. key globals landed */
  const expect = ['orders', 'invoices', 'stock', 'leads', 'renderAll', 'showToast'];
  const gone = expect.filter(n => typeof win[n] === 'undefined');

  if (missing.length) errors.push('inline handlers call undefined functions: ' + missing.join(', '));
  if (absent.length) warnings.push('$(id) with no element (' + absent.length + '): ' + absent.slice(0, 12).join(', '));
  if (gone.length) errors.push('expected globals missing after boot: ' + gone.join(', '));

  console.log('css files           : ' + cssFiles.length);
  console.log('js files            : ' + jsFiles.length);
  console.log('inline handler fns  : ' + called.size + ' referenced, ' + missing.length + ' missing');
  console.log('$(id) lookups       : ' + wanted.size + ' referenced, ' + absent.length + ' absent');
  console.log('');
  warnings.forEach(w => console.log('WARN  ' + w));
  if (errors.length) {
    errors.forEach(e => console.log('FAIL  ' + e));
    console.log('\n' + errors.length + ' failure(s)');
    process.exit(1);
  }
  console.log('PASS — app boots clean');
  process.exit(0);
}
