/*
 * Checks the PDF half of the Apps Script backend without deploying it.
 *   node tools/backend-check.js
 */
const m = require('./gas-harness.js');
const B64 = Buffer.from('%PDF-1.4 pretend').toString('base64');
const fails = [], ok = [];
const t = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  ← ' + (x || '')));
const J = r => JSON.parse(r.getContent());

/* an order list with two orders on it */
const sh = global.__addSheet('SAKAL ORDER LIST');
m.ensureHeaders_(sh);
sh.getRange(2, 1, 1, 12).setValues([['2601','2026-09-01','2026-11-15','','[]',0,'{}','',false,'ts','Nathaniel','+65 8123 4567']]);
sh.getRange(3, 1, 1, 12).setValues([['2602','2026-09-02','2026-12-02','','[]',0,'{}','',false,'ts','Faizal','+65 9000 0000']]);

t('header row carries Order Form PDF in M', sh.getRange(1,13).getValue() === 'Order Form PDF');
t('findOrderRow_ finds 2602 on row 3', m.findOrderRow_(sh, '2602') === 3);
t('findOrderRow_ misses an unknown order', m.findOrderRow_(sh, '9999') === -1);

/* ── upload ── */
let res = J(m.uploadPdf_({orderNum: '2602', name: 'faizal form.pdf', data: B64}));
t('upload succeeds', res.status === 'success', JSON.stringify(res));
t('file named with the order number', res.file.name === '2602 — faizal form.pdf', res.file && res.file.name);
t('answers with a Drive view link', /^https:\/\/drive\.google\.com\/file\/d\/.+\/view$/.test(res.file.url));
t('column M written as a link', res.cell === 'link', res.cell);
t('M holds a HYPERLINK to the file', String(sh.getRange(3,13).getValue()).indexOf('=HYPERLINK("' + res.file.url) === 0,
  String(sh.getRange(3,13).getValue()));
t('the other order is untouched', sh.getRange(2,13).getValue() === '');
t('file is link-shared', global.__drive.files[res.file.id].sharing === 'ANYONE_WITH_LINK/VIEW');

/* an order save must not wipe M */
const before = sh.getRange(3,13).getValue();
sh.getRange(3, 1, 1, 12).setValues([['2602','2026-09-02','2026-12-20','','[]',1,'{}','note',false,'ts2','Faizal','+65 9000 0000']]);
t('an ordinary order save leaves M alone', sh.getRange(3,13).getValue() === before);

/* ── re-attach bins the old one ── */
const firstId = res.file.id;
res = J(m.uploadPdf_({orderNum: '2602', name: 'faizal form v2.pdf', data: B64}));
t('re-attach succeeds', res.status === 'success');
t('the old file went to the bin', global.__drive.files[firstId].trashed === true);
t('the new file is live', global.__drive.files[res.file.id].trashed === false);
t('M now points at the new file', String(sh.getRange(3,13).getValue()).indexOf(res.file.url) > -1);

/* a filename with a slash in it must not become a path */
const nasty = J(m.uploadPdf_({orderNum: '2601', name: 'a/b:c*d?.pdf', data: B64}));
t('dangerous filename is scrubbed', !/[\\\/:*?"<>|]/.test(nasty.file.name.replace('2601 — ','')), nasty.file.name);
t('extension forced to .pdf', /\.pdf$/.test(nasty.file.name));
const noext = J(m.uploadPdf_({orderNum: '2601', name: 'scan', data: B64}));
t('a name with no extension gets one', noext.file.name === '2601 — scan.pdf', noext.file.name);

/* ── refusals ── */
t('no order number is refused', J(m.uploadPdf_({name: 'x.pdf', data: B64})).status === 'error');
t('no file is refused', J(m.uploadPdf_({orderNum: '2601'})).status === 'error');
t('delete with no id is refused', J(m.deletePdf_({})).status === 'error');
t('delete of an unknown id errors cleanly', J(m.deletePdf_({fileId: 'nope'})).status === 'error');

/* ── delete clears the cell ── */
const live = J(m.uploadPdf_({orderNum: '2602', name: 'final.pdf', data: B64}));
t('M is filled before the delete', sh.getRange(3,13).getValue() !== '');
const del = J(m.deletePdf_({fileId: live.file.id}));
t('delete succeeds', del.status === 'success');
t('file is binned', global.__drive.files[live.file.id].trashed === true);
t('M is cleared by the delete', sh.getRange(3,13).getValue() === '');
t('the 2601 cell survived', sh.getRange(2,13).getValue() !== '');

/* ── the attachments module ── */
t('attachments is an accepted module', m.MODULE_NAMES.indexOf('attachments') > -1);
const saved = J(m.saveModule_({module: 'attachments', payload: {'2601': {name: 'a.pdf', url: 'https://drive/x', id: 'i1'}}}));
t('attachments saves', saved.status === 'success', saved.message);
t('readModule_ reads it back', (m.readModule_('attachments') || {})['2601'].url === 'https://drive/x');
t('an unknown module is still refused', J(m.saveModule_({module: 'nonsense', payload: []})).status === 'error');

/* ── the invoice mirror ── */
const rows = m.invoiceRows_([{no: 'INV-1', orderNum: '2601', client: 'Nathaniel', issued: '2026-09-01',
  lines: [{desc: '2-piece suit', qty: 1, unit: 1200, parts: [{product: 'Jacket', fabric: 'A1'}, {product: 'Trousers', fabric: 'A1'}]}]}]);
t('mirror header says Order form PDF', rows[0][14] === 'Order form PDF', rows[0][14]);
t('mirror row carries the PDF link', rows[1][14] === 'https://drive/x', rows[1][14]);
t('mirror row width is intact', rows[1].length === m.INVOICE_HEAD.length);
t('mirror money still lands on the first row only', rows[1][20] === 1200 && rows[2][20] === '');
const empty = m.invoiceRows_([{no: 'INV-2', orderNum: '2601', lines: []}]);
t('an invoice with no lines still lines up', empty[1].length === m.INVOICE_HEAD.length && empty[1][14] === 'https://drive/x');

/* ── the chip path ── */
global.__enableChips();
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps-script', 'SAKAL-BACKEND-V9.gs'), 'utf8')
  .replace(/^const SHEET_ID.*$/m, "const SHEET_ID='SHEET_ID';").replace("const PDF_CELL_MODE = 'link';", "const PDF_CELL_MODE = 'chip';");
const chipMode = eval(src + ';({uploadPdf_})');
const chipRes = JSON.parse(chipMode.uploadPdf_({orderNum: '2601', name: 'chip.pdf', data: B64}).getContent());
t('chip mode reports a chip', chipRes.cell === 'chip', chipRes.cell);
const call = global.__chipCalls[global.__chipCalls.length - 1];
const cell = call.requests[0].updateCells;
t('chip request writes into column M', cell.start.columnIndex === 12);
t('chip request targets the 2601 row', cell.start.rowIndex === 1);
t('chip placeholder is a single @', cell.rows[0].values[0].userEnteredValue.stringValue === '@');
t('chip points at the Drive file', cell.rows[0].values[0].chipRuns[0].chip.richLinkProperties.uri === chipRes.file.url);

/* chip mode with the service missing must fall back, not fail */
delete global.Sheets;
const fallback = JSON.parse(chipMode.uploadPdf_({orderNum: '2601', name: 'fallback.pdf', data: B64}).getContent());
t('chip mode falls back to a link when the service is off', fallback.status === 'success' && fallback.cell === 'link', fallback.cell);

/* ── auth still guards the new actions ── */
t('UPLOAD_PDF without a token is refused',
  JSON.parse(m.doPost({postData: {contents: JSON.stringify({action: 'UPLOAD_PDF', orderNum: '2601', data: B64})}}).getContent()).status === 'unauthorized');
t('DELETE_PDF without a token is refused',
  JSON.parse(m.doPost({postData: {contents: JSON.stringify({action: 'DELETE_PDF', fileId: 'x'})}}).getContent()).status === 'unauthorized');

ok.forEach(n => console.log('  ok    ' + n));
fails.forEach(n => console.log('  FAIL  ' + n));
console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
