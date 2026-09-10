/*
 * A stand-in Apps Script — just real enough to run apps-script/SAKAL-BACKEND-V9.gs
 * outside Google. Fake Drive, fake sheet, fake Utilities. Used by backend-check.js.
 *   node tools/backend-check.js
 */
const fs = require('fs');

function Range(sheet, r, c, nr, nc) { this.sh = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
Range.prototype.getValues = function () {
  const out = [];
  for (let i = 0; i < this.nr; i++) {
    const row = [];
    for (let j = 0; j < this.nc; j++) row.push((this.sh.cells[this.r - 1 + i] || [])[this.c - 1 + j] ?? '');
    out.push(row);
  }
  return out;
};
Range.prototype.getValue = function () { return this.getValues()[0][0]; };
Range.prototype.setValues = function (v) {
  v.forEach((row, i) => { const R = this.r - 1 + i;
    if (!this.sh.cells[R]) this.sh.cells[R] = [];
    row.forEach((val, j) => { this.sh.cells[R][this.c - 1 + j] = val; }); });
  return this;
};
Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
Range.prototype.setFormula = function (f) { this.sh.formulas.push({r: this.r, c: this.c, f}); return this.setValue(f); };
Range.prototype.clearContent = function () { const R = this.r - 1; if (this.sh.cells[R]) this.sh.cells[R][this.c - 1] = ''; return this; };
['setBackground','setFontColor','setFontWeight','setNumberFormat'].forEach(m => Range.prototype[m] = function () { return this; });

function Sheet(name) { this.name = name; this.cells = []; this.formulas = []; this.id = Math.floor(Math.random() * 1e6); }
Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr, nc); };
Sheet.prototype.getLastRow = function () { let n = 0; this.cells.forEach((row, i) => { if (row && row.some(v => v !== '' && v != null)) n = i + 1; }); return n; };
Sheet.prototype.getMaxRows = function () { return 1000; };
Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), 20); };
Sheet.prototype.getName = function () { return this.name; };
Sheet.prototype.getSheetId = function () { return this.id; };
Sheet.prototype.appendRow = function (r) { this.getRange(this.getLastRow() + 1, 1, 1, r.length).setValues([r]); };
Sheet.prototype.deleteRow = function (r) { this.cells.splice(r - 1, 1); };
['hideSheet','setFrozenRows','autoResizeColumns','clearContents'].forEach(m => Sheet.prototype[m] = function () {
  if (m === 'clearContents') this.cells = []; return this; });
Sheet.prototype.copyTo = function () { return {setName: () => {}}; };

const BOOK = {sheets: {}};
function getSheet(n) { return BOOK.sheets[n] || null; }
function addSheet(n) { return (BOOK.sheets[n] = new Sheet(n)); }
const SS = { getId: () => 'SHEET_ID', getSheetByName: getSheet, insertSheet: addSheet };
global.SpreadsheetApp = { getActiveSpreadsheet: () => SS, openById: () => SS, getUi: () => ({alert: () => {}}) };
global.Session = { getEffectiveUser: () => ({getEmail: () => 'owner@example.com'}) };

const DRIVE = {files: {}, folders: {}, byId: {}};
function DFile(id, name, bytes) { this.id = id; this.name = name; this.bytes = bytes; this.trashed = false; this.sharing = null; }
DFile.prototype.getId = function () { return this.id; };
DFile.prototype.getName = function () { return this.name; };
DFile.prototype.getSize = function () { return this.bytes.length; };
DFile.prototype.setTrashed = function (t) { this.trashed = t; return this; };
DFile.prototype.setSharing = function (a, p) { this.sharing = a + '/' + p; return this; };
DFile.prototype.getOwner = function () { return {getEmail: () => 'owner@example.com'}; };

function DFolder(name) { this.name = name; }
DFolder.prototype.getName = function () { return this.name; };
DFolder.prototype.createFile = function (blob) {
  const f = new DFile('id' + (Object.keys(DRIVE.files).length + 1), blob.name, blob.bytes);
  DRIVE.files[f.id] = f; return f;
};
DFolder.prototype.getFiles = function () {
  const list = Object.values(DRIVE.files).filter(f => !f.trashed);
  let i = 0; return {hasNext: () => i < list.length, next: () => list[i++]};
};
global.DriveApp = {
  getRootFolder: () => ({getName: () => 'My Drive'}),
  getFolderById: id => { const f = DRIVE.byId[id]; if (!f) throw new Error('Not found: ' + id); return f; },
  getFoldersByName: n => { const has = !!DRIVE.folders[n]; let used = false;
    return {hasNext: () => has && !used, next: () => { used = true; return DRIVE.folders[n]; }}; },
  createFolder: n => (DRIVE.folders[n] = new DFolder(n)),
  getFileById: id => { const f = DRIVE.files[id]; if (!f) throw new Error('No item with the given ID'); return f; },
  Access: {ANYONE_WITH_LINK: 'ANYONE_WITH_LINK'}, Permission: {VIEW: 'VIEW'}
};

global.Utilities = {
  formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 10),
  base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
  base64Decode: s => Buffer.from(String(s), 'base64'),
  base64EncodeWebSafe: s => Buffer.from(String(s)).toString('base64url'),
  base64DecodeWebSafe: s => Buffer.from(String(s), 'base64url'),
  newBlob: (bytes, mime, name) => ({bytes, mime, name, getDataAsString: () => Buffer.from(bytes).toString('utf8')}),
  getUuid: () => 'xxxxxxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)),
  computeDigest: (a, s) => Buffer.from(require('crypto').createHash('sha256').update(String(s)).digest()),
  computeHmacSha256Signature: (p, k) => Buffer.from(require('crypto').createHmac('sha256', k).update(p).digest()),
  DigestAlgorithm: {SHA_256: 1}, Charset: {UTF_8: 1}, sleep: () => {}
};
global.ContentService = { createTextOutput: t => ({getContent: () => t, setMimeType: function () { return this; }}), MimeType: {JSON: 'json'} };
global.Logger = { log: m => console.log('    [log] ' + String(m).slice(0, 140)) };
global.PropertiesService = { getScriptProperties: () => { const p = {}; return {
  getProperty: k => p[k] || null, setProperty: (k, v) => { p[k] = v; }, deleteProperty: k => { delete p[k]; } }; } };
global.CacheService = { getScriptCache: () => ({get: () => null, put: () => {}, remove: () => {}}) };
global.LockService = { getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}}) };

const chipCalls = [];
global.__chipCalls = chipCalls;
global.__enableChips = function () { global.Sheets = {Spreadsheets: {batchUpdate: (req) => { chipCalls.push(req); return {}; }}}; };
global.__addSheet = addSheet;
global.__book = BOOK;
global.__drive = DRIVE;

const path = require('path');
const GS = path.join(__dirname, '..', 'apps-script', 'SAKAL-BACKEND-V9.gs');
const SRC = fs.readFileSync(GS, 'utf8')
       .replace(/^const SHEET_ID.*$/m, "const SHEET_ID = 'SHEET_ID';");
module.exports = eval(SRC + `
;({uploadPdf_, deletePdf_, invoiceRows_, saveModule_, getModules_, readModule_,
   ensureHeaders_, findOrderRow_, writePdfCell_, rebuildPdfColumn, doPost, HEADERS, INVOICE_HEAD,
   PDF_FOLDER, MODULE_NAMES})`);
