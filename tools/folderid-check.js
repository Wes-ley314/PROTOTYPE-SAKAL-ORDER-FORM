/*
 * Proves the Shared-Drive folder path in apps-script/SAKAL-BACKEND-V9.gs:
 * PDF_FOLDER_ID wins when set, a wrong id fails with a sentence a human can
 * act on, and a blank id still falls back to My Drive.
 *
 *   node tools/folderid-check.js .
 *
 * NOTE ON THE eval WRAPPER: a bare eval() of the script would hoist every
 * function declaration into THIS module's scope, so loading a second variant
 * would silently overwrite the first one's helpers and the first variant would
 * start using the second's constants. Wrapping each load in its own function
 * keeps the three variants apart.
 */
const fs = require('fs'), path = require('path');
const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..'));
require(path.join(REPO, 'tools', 'gas-harness.js'));   // installs the fake Google

const SRC = fs.readFileSync(path.join(REPO, 'apps-script', 'SAKAL-BACKEND-V9.gs'), 'utf8')
  .replace(/^const SHEET_ID.*$/m, "const SHEET_ID = 'SHEET_ID';");

/** Loads the backend with PDF_FOLDER_ID set to `id`, in a scope of its own. */
function load(id) {
  const body = SRC.replace("const PDF_FOLDER_ID = '';", "const PDF_FOLDER_ID = '" + id + "';");
  return eval('(function () {' + body
    + '\n; return {uploadPdf_: uploadPdf_, checkDriveAccess: checkDriveAccess,'
    + '          pdfFolder_: pdfFolder_, PDF_FOLDER_ID: PDF_FOLDER_ID}; })()');
}

const fails = [], ok = [];
const t = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  ← ' + (x || '')));
const J = r => JSON.parse(r.getContent());
const B64 = Buffer.from('%PDF-1.4 pretend').toString('base64');

/* A folder on the business's Shared Drive. Files made here have no personal
   owner — which is the whole point of using one. */
const shared = {
  getName: () => 'Order forms (Shared Drive)',
  createFile(blob) {
    const f = {
      id: 'sd' + Object.keys(global.__drive.files).length, name: blob.name, bytes: blob.bytes,
      trashed: false, sharing: null,
      getId() { return this.id; }, getName() { return this.name; },
      getSize() { return this.bytes.length; },
      setTrashed(v) { this.trashed = v; return this; },
      setSharing() { return this; },
      getOwner: () => null
    };
    global.__drive.files[f.id] = f;
    return f;
  },
  getFiles() {
    const l = Object.values(global.__drive.files).filter(f => !f.trashed);
    let i = 0;
    return { hasNext: () => i < l.length, next: () => l[i++] };
  }
};
global.__drive.byId['SHARED123'] = shared;

const sh = global.__addSheet('SAKAL ORDER LIST');
sh.getRange(2, 1, 1, 12).setValues([['2601','2026-09-01','','','[]',0,'{}','',false,'ts','A','']]);

/* ── a folder id, as the business would set it ── */
const withId = load('SHARED123');
t('the constant reaches the script', withId.PDF_FOLDER_ID === 'SHARED123', withId.PDF_FOLDER_ID);
t('the id resolves to that folder', withId.pdfFolder_().getName() === 'Order forms (Shared Drive)');

let res = J(withId.uploadPdf_({orderNum: '2601', name: 'form.pdf', data: B64}));
t('upload succeeds against a folder id', res.status === 'success', res.message);
t('the file landed in the Shared Drive folder', String(res.file.id).indexOf('sd') === 0, res.file && res.file.id);
t('the file has no personal owner', global.__drive.files[res.file.id].getOwner() === null);
t('column M is still written', String(sh.getRange(2, 13).getValue()).indexOf('=HYPERLINK') === 0);

/* ── a wrong id ── */
res = J(load('NOPE').uploadPdf_({orderNum: '2601', name: 'form.pdf', data: B64}));
t('a wrong id is refused', res.status === 'error');
t('and says what to check', /Content manager/.test(res.message || ''), res.message);

/* ── no id: the old behaviour, unchanged ── */
const noId = load('');
t('a blank id falls back to My Drive', noId.pdfFolder_().getName() === 'ŠAKAL order forms');
res = J(noId.uploadPdf_({orderNum: '2601', name: 'form.pdf', data: B64}));
t('the fallback still uploads', res.status === 'success', res.message);

/* ── the first variant must still be its own thing ── */
t('loading a second variant did not disturb the first',
  withId.pdfFolder_().getName() === 'Order forms (Shared Drive)');

withId.checkDriveAccess();
t('checkDriveAccess survives a folder id', true);

ok.forEach(n => console.log('  ok    ' + n));
fails.forEach(n => console.log('  FAIL  ' + n));
console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
