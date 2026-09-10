// ========================================
// SAKAL ORDER - GAS BACKEND V9
//
// V9 = V8, unchanged, plus the order-form PDF.
//
// NEW IN V9
//   The suit order form built into the app is gone. Staff attach the paper
//   order form as a PDF instead — one per order. The app posts the file,
//   this files it in a Drive folder beside the sheet, and hands the link
//   back. Column M on the order list shows it, so the sheet on its own is
//   enough to open any order's form.
//
//   1. UPLOAD_PDF / DELETE_PDF — the file goes to a Drive folder named by
//      PDF_FOLDER, one per order. Re-attaching bins the old one first, so
//      two versions never sit side by side.
//   2. Column M 'Order Form PDF' — written by the upload, cleared by the
//      delete. The order save never touches it (it writes A–L only), so it
//      survives every other change to the row.
//   3. 'attachments' joins MODULE_NAMES — the app keeps its own map of
//      order number → file, and that is what it reads back on other devices.
//   4. The Invoicing mirror's 'Suit order form' column is now
//      'Order form PDF' and carries the link.
//   5. ?pdf=1 on doGet answers "yes, this script takes PDFs". The app asks
//      before it sends one, so a sheet still on V8 says so plainly rather
//      than being posted a file it would read as an order save.
//
// UNCHANGED FROM V8: signing in, tokens, the lockout, every line of the
// order path, the version guard, the module store, the mirrors, the AI hook.
//
// ⚠ BEFORE YOU DEPLOY
//   The first upload asks Google for permission to use Drive, because this
//   script now creates files. Approve it, or every attach comes back failed.
//
// ⚠ THE MIRROR TABS ARE REWRITTEN IN FULL ON EVERY SAVE.
//   Do not type into 'Invoicing' or 'Delta'.
// ========================================

const SHEET_ID   = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_NAME = 'SAKAL ORDER LIST';
const LOG_NAME   = 'Logs';

const HEADERS = [
  'Order Number',        // A
  'Date',                // B
  'Due Date',            // C
  'Fitting Date',        // D
  'Items (JSON)',        // E
  'Fitted',              // F
  'Fitted Dates (JSON)', // G
  'Remarks',             // H
  'Archived',            // I
  'Last Updated',         // J  ← this is the version stamp the guard compares
  'Name',                 // K
  'Contact',              // L
  'Order Form PDF'        // M  ← V9. Written by the PDF handlers, never by a save.
];

// ── HELPERS ──────────────────────────────────────────────────────────────────

function ensureHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsUpdate = HEADERS.some((h, i) => firstRow[i] !== h);
  if (needsUpdate) {
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setValues([HEADERS])
         .setBackground('#1C1C30')
         .setFontColor('#FFFFFF')
         .setFontWeight('bold');
  }
  // Force Last Updated (J), Name (K), Contact (L) and Order Form PDF (M) to plain text.
  // J must stay an exact ISO string — it is the version stamp the guard compares,
  // so Sheets must not reinterpret it as a date. K/L stop "+65..." being read as a
  // formula. M is left alone by the order save and only the PDF handlers write it.
  sheet.getRange(2, 10, sheet.getMaxRows() - 1, 3).setNumberFormat('@');
}

function parseDate_(val) {
  if (!val) return '';

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, 'Asia/Singapore', 'yyyy-MM-dd');
  }

  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return Utilities.formatDate(d, 'Asia/Singapore', 'yyyy-MM-dd');
  }

  const s = String(val).trim();
  if (!s || s === '—' || s === 'undefined' || s === 'null') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[3] + '-' + m1[2].padStart(2, '0') + '-' + m1[1].padStart(2, '0');

  const match = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  return '';
}

function todayString_() {
  return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd');
}

// normalize contact numbers
// - "12345678"     -> "+65 12345678"   (no code given -> default Singapore)
// - "+6512345678"  -> "+65 12345678"
// - "+6212345678"  -> "+62 12345678"
const KNOWN_COUNTRY_CODES_ = [
  '673','852','853','886', // 3-digit-ish (Brunei, HK, Macau, Taiwan)
  '65','62','60','66','63','82','81','86','91','44','61','64', // common 2-digit
  '1' // NANP (US/Canada) - 1 digit, checked last
];

function normalizeContact_(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return '';

  let code, rest;

  if (hasPlus) {
    const sorted = KNOWN_COUNTRY_CODES_.slice().sort((a, b) => b.length - a.length);
    const match = sorted.find(c => s.startsWith(c));
    if (match) {
      code = match;
      rest = s.substring(match.length);
    } else {
      code = s.substring(0, 2);
      rest = s.substring(2);
    }
  } else {
    code = '65';
    rest = s;
  }

  if (!rest) return '+' + code;
  return '+' + code + ' ' + rest;
}

// ── REPAIR TOOLS ─────────────────────────────────────────────────────────────
// NOTE: this function is a SUSPECT for the wrong-date bug. It guesses a date
// from the first four digits of the order number, so order "2505123" becomes
// 2025-05-01. If it was ever run against rows that only *looked* empty, it
// rewrote them. It now defaults to DRY RUN — it only logs what it would do.
// Read the log, and only then set DRY_RUN to false.
function repairEmptyDates() {
  const DRY_RUN = true;   // ← set to false only after reviewing the log

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Sheet tidak ditemukan!'); return; }

  const rows    = sheet.getDataRange().getValues();
  const today   = todayString_();
  let   fixed   = 0;
  let   skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || String(r[0]).trim() === '') { skipped++; continue; }

    const existingDate = parseDate_(r[1]);

    if (!existingDate) {
      const orderNum = String(r[0]).trim();
      let guessedDate = '';

      const m = orderNum.match(/^(\d{2})(\d{2})/);
      if (m) {
        const yr    = '20' + m[1];
        const mo    = m[2];
        const moNum = parseInt(mo, 10);
        if (moNum >= 1 && moNum <= 12) guessedDate = yr + '-' + mo + '-01';
      }

      const dateToWrite = guessedDate || today;
      if (!DRY_RUN) sheet.getRange(i + 1, 2).setValue(dateToWrite);
      Logger.log((DRY_RUN ? '[DRY RUN] would fix' : 'Fixed') +
                 ' row ' + (i + 1) + ' order ' + orderNum + ' → date: ' + dateToWrite);
      fixed++;
    }
  }

  Logger.log('=== repairEmptyDates ' + (DRY_RUN ? '(DRY RUN) ' : '') + 'selesai: ' +
             fixed + ' baris, ' + skipped + ' baris dilewati ===');
  SpreadsheetApp.getUi().alert(
    (DRY_RUN ? 'DRY RUN — nothing was written.\n' : 'Repair selesai!\n') +
    fixed + ' baris.\nCek Logs untuk detail.');
}

function repairContactFormat() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Sheet tidak ditemukan!'); return; }

  sheet.getRange(2, 12, sheet.getMaxRows() - 1, 1).setNumberFormat('@');

  const rows = sheet.getDataRange().getValues();
  let fixed = 0;

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i][11];
    if (!raw) continue;
    const s = String(raw).trim();
    if (s.indexOf('ERROR') > -1) continue;
    const normalized = normalizeContact_(s);
    if (normalized && normalized !== s) {
      sheet.getRange(i + 1, 12).setValue(normalized);
      fixed++;
    }
  }
  Logger.log('repairContactFormat: ' + fixed + ' kontak diperbaiki.');
  SpreadsheetApp.getUi().alert('Repair kontak selesai!\n' + fixed + ' baris diperbaiki.');
}


// ═════════════════════════════════════════════════════════════════════════════
// V7 — EVERYTHING THAT IS NOT AN ORDER
// ═════════════════════════════════════════════════════════════════════════════

const MODULE_SHEET = 'Modules';
const CHUNK = 40000;            // a cell holds 50,000 characters; leave room

// 'delta' is the one the app was posting with nowhere to land.
// 'attachments' is new in V9 — order number → the PDF filed against it.
const MODULE_NAMES = ['measurements', 'invoices', 'pricelist', 'stock',
                      'leads', 'customers', 'ops', 'delta', 'attachments'];

// Which lists also get written out as readable rows, and into which tab.
// Add a line here plus a builder function to mirror another list.
const MIRRORS = {
  invoices: {sheet: 'Invoicing', build: invoiceRows_},
  delta:    {sheet: 'Delta',     build: deltaRows_}
};

function moduleSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MODULE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MODULE_SHEET);
    sh.appendRow(['module', 'part', 'data', 'updated']);
    sh.hideSheet();
  }
  return sh;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Stores one list. Rewrites only that list's rows. */
function saveModule_(body) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const name = String(body.module || '').trim();
    if (MODULE_NAMES.indexOf(name) === -1) {
      return jsonOut_({status: 'error', message: 'Unknown module: ' + name});
    }

    const sh = moduleSheet_();
    const text = JSON.stringify(body.payload === undefined ? null : body.payload);
    const stamp = new Date().toISOString();

    // Drop this module's existing rows, bottom up so the indexes hold.
    const last = sh.getLastRow();
    if (last > 1) {
      const col = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let r = col.length - 1; r >= 0; r--) {
        if (String(col[r][0]) === name) sh.deleteRow(r + 2);
      }
    }

    // Write it back in chunks a cell can hold.
    const rows = [];
    for (let i = 0, part = 0; i < text.length; i += CHUNK, part++) {
      rows.push([name, part, text.substring(i, i + CHUNK), stamp]);
    }
    if (!rows.length) rows.push([name, 0, '', stamp]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);

    // The readable copy. A failure here must never cost us the save,
    // so it is caught and reported rather than thrown.
    let mirrored = '';
    try {
      mirrored = writeMirror_(name, body.payload);
    } catch (e) {
      mirrored = 'failed: ' + String(e);
    }

    return jsonOut_({status: 'success', module: name, parts: rows.length,
                     updated: stamp, mirrored: mirrored});
  } catch (err) {
    return jsonOut_({status: 'error', message: String(err)});
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Reads ONE stored list back, without dragging the rest along.
 *  New in V9 — the invoice mirror needs the attachments map and nothing else. */
function readModule_(name) {
  try {
    const sh = moduleSheet_();
    const last = sh.getLastRow();
    if (last < 2) return null;

    const parts = [];
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (row) {
      if (String(row[0]) !== name) return;
      parts.push({part: Number(row[1]) || 0, data: String(row[2] == null ? '' : row[2])});
    });
    if (!parts.length) return null;

    parts.sort(function (a, b) { return a.part - b.part; });
    return JSON.parse(parts.map(function (c) { return c.data; }).join(''));
  } catch (e) {
    return null;
  }
}

/** Hands every stored list back in one response. */
function getModules_() {
  try {
    const sh = moduleSheet_();
    const out = {};
    const last = sh.getLastRow();

    if (last > 1) {
      const vals = sh.getRange(2, 1, last - 1, 3).getValues();
      const buckets = {};
      vals.forEach(function (row) {
        const name = String(row[0]);
        if (!name) return;
        if (!buckets[name]) buckets[name] = [];
        buckets[name].push({part: Number(row[1]) || 0, data: String(row[2] == null ? '' : row[2])});
      });
      Object.keys(buckets).forEach(function (name) {
        buckets[name].sort(function (a, b) { return a.part - b.part; });
        const text = buckets[name].map(function (c) { return c.data; }).join('');
        if (!text) return;
        try { out[name] = JSON.parse(text); } catch (e) { /* leave it out rather than send rubbish */ }
      });
    }

    return jsonOut_({status: 'success', modules: out});
  } catch (err) {
    return jsonOut_({status: 'error', message: String(err)});
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// NEW IN V9 — THE ORDER FORM PDF
//
// One file per order. The app sends it as text; this turns it back into a
// PDF, files it in Drive, writes the link into column M of the order row,
// and answers with the link the app keeps.
//
// The bytes never go into the sheet — a cell cannot hold a file, and even
// as text a PDF would blow the 50,000-character limit several times over.
// Drive holds the file; the sheet holds the way to it.
// ═════════════════════════════════════════════════════════════════════════════

/* WHERE THE FILES GO, and — the part that matters — WHO ENDS UP OWNING THEM.
   A file made by this script normally belongs to whichever account the script
   runs as. That is fine until that person leaves, takes their Drive with them,
   and the shop's order forms go with it.

   PDF_FOLDER_ID fixes that. Put in the id of a folder on the business's
   SHARED DRIVE and every order form is owned by the business itself, whoever
   the script happens to run as. It also sidesteps ownership transfer between
   two different Google organisations, which Google does not allow at all.

   The id is the long code in the folder's address:
     drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i  ← that part
   The account the script runs as must be a member of that Shared Drive with
   Content manager rights, or writing will fail.

   Leave it '' and the script falls back to a folder named PDF_FOLDER in the
   running account's own My Drive. */
const PDF_FOLDER_ID = '';
const PDF_FOLDER = 'ŠAKAL order forms';

// Link sharing on = a phone on the shop floor opens the file without signing
// in to this Google account. Set it to false to keep every file private, and
// everyone who needs one has to be given access in Drive by hand.
const PDF_LINK_SHARING = true;

// How the link shows up in column M of the order list:
//   'link'  a clickable file name (works everywhere, no setup)      ← default
//   'chip'  a real Drive smart chip, with a hover preview of the PDF
//   'off'   leave column M alone; the app still keeps the link
//
// 'chip' needs the advanced Sheets service switched on, once:
//   Apps Script editor → Services (+) → Google Sheets API → Add.
// If it is not on, this quietly falls back to 'link' rather than failing
// the upload — the file is already safely in Drive by that point.
const PDF_CELL_MODE = 'link';

function pdfFolder_() {
  if (PDF_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(PDF_FOLDER_ID);
    } catch (e) {
      throw new Error('PDF_FOLDER_ID is set, but this account cannot open that '
        + 'folder. Check the id, and that the account the script runs as is a '
        + 'member of that Shared Drive with Content manager rights. ' + e);
    }
  }
  const it = DriveApp.getFoldersByName(PDF_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PDF_FOLDER);
}

/** Row number of one order on the order list, or -1. */
function findOrderRow_(sheet, orderNum) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const col = sheet.getRange(2, 1, last - 1, 1).getValues();
  const key = String(orderNum || '').trim();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === key && key) return i + 2;
  }
  return -1;
}

/** Puts the file into column M, however PDF_CELL_MODE says to. */
function writePdfCell_(orderNum, file) {
  if (PDF_CELL_MODE === 'off') return 'off';
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return 'no sheet';

    const row = findOrderRow_(sheet, orderNum);
    if (row < 0) return 'no row for order ' + orderNum;

    const url = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    if (PDF_CELL_MODE === 'chip' && typeof Sheets !== 'undefined') {
      try {
        // A file chip is one '@' in the cell text with a chip run pinned to it.
        // Only Drive links can be written this way, which is exactly what we have.
        Sheets.Spreadsheets.batchUpdate({requests: [{
          updateCells: {
            rows: [{values: [{
              userEnteredValue: {stringValue: '@'},
              chipRuns: [{startIndex: 0, chip: {richLinkProperties: {uri: url}}}]
            }]}],
            fields: 'userEnteredValue,chipRuns',
            start: {sheetId: sheet.getSheetId(), rowIndex: row - 1, columnIndex: 12}
          }
        }]}, SHEET_ID);
        return 'chip';
      } catch (e) {
        // Service not enabled, or no Drive scope granted for it. Fall through
        // to the plain link — never lose the upload over a nicety.
        Logger.log('chip failed, using a link instead: ' + e);
      }
    }

    const name = String(file.getName()).replace(/"/g, '""');
    sheet.getRange(row, 13).setFormula('=HYPERLINK("' + url + '","' + name + '")');
    return 'link';
  } catch (e) {
    return 'failed: ' + String(e);
  }
}

/** Takes column M back out when the PDF comes off the order. */
function clearPdfCell_(orderNum) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return;
    const row = findOrderRow_(sheet, orderNum);
    if (row > 0) sheet.getRange(row, 13).clearContent();
  } catch (e) { /* the link coming off the order is what matters */ }
}

/** Takes one PDF and files it under the order number. */
function uploadPdf_(body) {
  try {
    const num  = String(body.orderNum || '').trim();
    const data = String(body.data || '');
    if (!num)  return jsonOut_({status: 'error', message: 'No order number on the upload.'});
    if (!data) return jsonOut_({status: 'error', message: 'No file on the upload.'});

    // A filename is not to be trusted with slashes in it.
    let given = String(body.name || '').replace(/[\\\/:*?"<>|]/g, ' ').trim();
    if (given.slice(-4).toLowerCase() !== '.pdf') given += '.pdf';

    const prefix = num + ' — ';
    const name = prefix + given;
    const folder = pdfFolder_();

    // One PDF per order: anything already filed under this number goes to the
    // bin, so a re-attach never leaves two versions side by side.
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().indexOf(prefix) === 0) {
        try { f.setTrashed(true); } catch (e) {}
      }
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(data), 'application/pdf', name);
    const file = folder.createFile(blob);

    if (PDF_LINK_SHARING) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) { /* a domain that forbids link sharing keeps the file private */ }
    }

    const shown = writePdfCell_(num, file);

    return jsonOut_({status: 'success', cell: shown, file: {
      id: file.getId(),
      name: name,
      url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      size: file.getSize(),
      updated: new Date().toISOString()
    }});
  } catch (err) {
    return jsonOut_({status: 'error', message: String(err)});
  }
}

/** Bins one PDF. Drive keeps it in the bin for 30 days if this was a mistake. */
function deletePdf_(body) {
  try {
    const id = String(body.fileId || '').trim();
    if (!id) return jsonOut_({status: 'error', message: 'No file id on the request.'});

    const file = DriveApp.getFileById(id);
    const name = file.getName();
    file.setTrashed(true);

    // The name carries the order number, so column M can be cleared without
    // the app having to tell us which order this was.
    const cut = name.indexOf(' — ');
    if (cut > 0) clearPdfCell_(name.substring(0, cut));

    return jsonOut_({status: 'success', id: id});
  } catch (err) {
    return jsonOut_({status: 'error', message: String(err)});
  }
}

/** Run once from the editor to fill column M from what is already stored —
 *  useful after a restore, or if the column was ever cleared by hand. */
function rebuildPdfColumn() {
  const map = readModule_('attachments') || {};
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('No order sheet.'); return; }

  let done = 0, missing = 0;
  Object.keys(map).forEach(function (num) {
    const rec = map[num];
    if (!rec || !rec.id) return;
    try {
      writePdfCell_(num, DriveApp.getFileById(rec.id));
      done++;
    } catch (e) { missing++; Logger.log(num + ': ' + e); }
  });
  Logger.log('rebuildPdfColumn: ' + done + ' written, ' + missing + ' could not be found.');
}


// ── THE READABLE TABS ────────────────────────────────────────────────────────
// One-way: the app writes, the sheet shows. Reading back is always from the
// JSON above, because a flat grid cannot carry a line's garments home again
// in one piece.

function writeMirror_(name, payload) {
  const m = MIRRORS[name];
  if (!m) return '';

  const rows = m.build(payload || []);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(m.sheet);
  let fresh = false;
  if (!sh) { sh = ss.insertSheet(m.sheet); fresh = true; }

  // If the tab already holds something you typed yourself, keep a copy
  // before taking it over. Runs once — after that the header is ours.
  const saved = backupIfForeign_(sh, rows[0]);

  sh.clearContents();
  if (!rows.length) return m.sheet + ' (empty)';

  const width = rows[0].length;
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  if (fresh) sh.autoResizeColumns(1, width);

  return m.sheet + ' (' + (rows.length - 1) + ')' + (saved ? ' — old contents kept as "' + saved + '"' : '');
}

/** Copies a mirror tab aside if it holds anything that is not ours. */
function backupIfForeign_(sh, head) {
  if (sh.getLastRow() === 0) return '';
  const a1 = String(sh.getRange(1, 1).getValue() || '').trim();
  if (a1 === head[0]) return '';                 // already our layout
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = sh.getName() + ' (saved ' +
    Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd HHmm') + ')';
  sh.copyTo(ss).setName(name);
  return name;
}

function pad_(row, width) {
  while (row.length < width) row.push('');
  return row;
}

function yn_(v) { return v ? 'Yes' : 'No'; }


// ── Invoicing ──
// One row per garment, so fabric and lining have somewhere to sit.
// The identity columns repeat down every row so filters work, but the
// invoice-level money lands on the first row of each invoice only — otherwise
// summing the Total column would count a three-garment invoice three times.
// SUM(Line total) and SUM(Invoice total) both give you a true figure.
const INVOICE_HEAD = [
  'Invoice no.', 'Status', 'Issued', 'Due', 'Fitting',
  'Client', 'Phone', 'Email', 'Staff', 'Order no.',
  'Line item', 'Garment', 'Fabric', 'Lining', 'Order form PDF',
  'Qty', 'Unit price', 'Line total',
  'Subtotal', 'Discount', 'Invoice total', 'Paid', 'Balance',
  'Note', 'Updated'
];

function invoiceRows_(list) {
  const out = [INVOICE_HEAD.slice()];
  // V9: the form column now carries the order's PDF, looked up once.
  const pdfs = readModule_('attachments') || {};

  (list || []).forEach(function (v) {
    const lines = v.lines || [];

    let sub = 0;
    lines.forEach(function (l) { sub += (Number(l.qty) || 0) * (Number(l.unit) || 0); });
    const disc  = Number(v.discount) || 0;
    const total = Math.max(0, sub - disc);
    const paid  = Number(v.paid) || 0;

    // Same three states the app shows on the invoice list.
    const status = (paid >= total - 0.005 && (total > 0 || v.sent))
      ? 'Paid'
      : (v.sent ? 'Sent' : 'Draft');

    const head = [v.no || '', status, v.issued || '', v.due || '', v.fitting || '',
                  v.client || '', v.phone || '', v.email || '', v.staff || '', v.orderNum || ''];

    const pdf = pdfs[String(v.orderNum || '')];
    const pdfUrl = (pdf && pdf.url) ? pdf.url : '';

    const body = [];

    lines.forEach(function (l) {
      const qty = Number(l.qty) || 0, unit = Number(l.unit) || 0;
      // A "2-piece suit" line carries a part per garment; a plain line does not.
      const parts = (l.parts && l.parts.length) ? l.parts : [null];

      parts.forEach(function (p, pi) {
        body.push(head.concat([
          l.desc || '',
          p ? (p.product || '') : (l.garments || []).join(' · '),
          p ? (p.fabric || '') : (l.fabric || ''),
          p ? (p.lining || '') : (l.lining || ''),
          pdfUrl,
          pi === 0 ? qty : '',
          pi === 0 ? unit : '',
          pi === 0 ? qty * unit : '',
          '', '', '', '', '',          // invoice money — first row only, filled below
          v.note || '', v.updated || ''
        ]));
      });
    });

    // An invoice with no line items still deserves a row.
    if (!body.length) {
      body.push(head.concat(['', '', '', '', pdfUrl, '', '', '',
                             '', '', '', '', '',
                             v.note || '', v.updated || '']));
    }

    body[0][18] = sub;
    body[0][19] = disc;
    body[0][20] = total;
    body[0][21] = paid;
    body[0][22] = total - paid;

    body.forEach(function (r) { out.push(pad_(r, INVOICE_HEAD.length)); });
  });

  return out;
}


// ── Delta ──
// One row per Delta order. The charge is whatever the app worked out and
// saved, so the price of a canvas or an add-on stays defined in one place
// and this never drifts from it.
const DELTA_HEAD = [
  'Delta no.', 'Placed', 'Due', 'Canvas', 'Add-ons', 'Charge (S$)', 'Stage',
  'Back-End', 'Bin', 'Delivered', 'Paid', 'Invoiced', 'Archived'
];

function deltaRows_(list) {
  const out = [DELTA_HEAD.slice()];

  (list || []).forEach(function (o) {
    // Read in the same order the app reads it, so the two never disagree.
    const stage = o.backend ? 'Back-End'
                : (o.bin ? 'Bin'
                : (o.delivered ? 'Delivered' : 'Not started'));

    const charge = (o.total === undefined || o.total === null || o.total === '')
      ? '' : Number(o.total);

    out.push(pad_([
      o.orderNum || '', o.date || '', o.dueDate || '', o.canvas || '',
      (o.addons || []).join(' · '),
      charge,
      stage,
      yn_(o.backend), yn_(o.bin), yn_(o.delivered),
      yn_(o.paid), yn_(o.invoice), yn_(o.archived)
    ], DELTA_HEAD.length));
  });

  return out;
}


/** Run once from the editor to fill the readable tabs from what is already
 *  stored, without touching the app. Check View → Logs afterwards. */
function rebuildMirrors() {
  const res = JSON.parse(getModules_().getContent());
  const mods = res.modules || {};
  Object.keys(MIRRORS).forEach(function (name) {
    if (mods[name]) Logger.log(writeMirror_(name, mods[name]));
    else Logger.log(name + ': nothing stored yet');
  });
}

/** Run once from the editor to check the sheet and permissions are fine.
 *  Writes one dummy Delta row, then prints everything stored. */
function testModules() {
  saveModule_({module: 'delta', payload: [{orderNum: '00000', dueDate: '2026-01-01',
    canvas: 'Half Canvas', addons: ['Surgeon'], total: 150, date: '1 Jan 2026',
    backend: true, bin: false, delivered: false, paid: false, invoice: false, archived: false}]});
  Logger.log(getModules_().getContent());
}

/** The smallest possible Drive call, with NOTHING catching it.
 *
 *  Run this FIRST. An exception caught inside uploadPdf_ never reaches the
 *  editor, so Google is never asked to show the permission screen and the
 *  run looks like a success with an error logged inside it. This one lets
 *  the failure escape, which is what makes the editor either show the
 *  "Authorization required" screen or fail loudly with the real reason.
 *
 *  If it fails with "You do not have permission to call DriveApp…" and no
 *  screen appears, the scopes are pinned in the manifest. Open Project
 *  Settings, tick "Show appsscript.json manifest file in editor", and make
 *  sure oauthScopes contains https://www.googleapis.com/auth/drive — or
 *  delete the oauthScopes list entirely and let Apps Script work it out. */
function checkDriveAccess() {
  Logger.log('running as : ' + Session.getEffectiveUser().getEmail());
  Logger.log('Drive root : ' + DriveApp.getRootFolder().getName());

  if (PDF_FOLDER_ID) {
    const f = pdfFolder_();          // throws with a plain explanation if wrong
    Logger.log('folder     : "' + f.getName() + '" (by id)');
    // Prove we can actually write there, then clean up after ourselves.
    const probe = f.createFile(Utilities.newBlob('probe', 'text/plain', '__sakal_probe.txt'));
    Logger.log('owner      : ' + (probe.getOwner()
      ? probe.getOwner().getEmail()
      : 'the Shared Drive itself — which is what you want'));
    probe.setTrashed(true);
    Logger.log('write test : fine, probe file binned again.');
  } else {
    const folders = DriveApp.getFoldersByName(PDF_FOLDER);
    Logger.log('folder     : "' + PDF_FOLDER + '" in My Drive'
      + (folders.hasNext() ? ' (already exists)' : ' (made on first upload)'));
    Logger.log('  note: files here belong to the account above, not to the shop.');
    Logger.log('  Set PDF_FOLDER_ID to a Shared Drive folder to change that.');
  }

  Logger.log('Now run testPdf.');
}

/** Run once from the editor to prove Drive is set up before the shop tries it.
 *  Makes a tiny PDF, files it under order 00000, then bins it again. */
function testPdf() {
  // Same reason as above: touch Drive outside the try/catch first, so a
  // missing permission surfaces here instead of being logged as text.
  DriveApp.getRootFolder().getName();

  const tiny = Utilities.base64Encode(
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const res = JSON.parse(uploadPdf_({orderNum: '00000', name: 'test.pdf', data: tiny}).getContent());
  Logger.log(JSON.stringify(res));
  if (res.status === 'success') {
    Logger.log('Drive is fine. Column M said: ' + res.cell);
    deletePdf_({fileId: res.file.id});
    Logger.log('Test file binned again.');
  } else {
    Logger.log('NOT working yet: ' + res.message);
  }
}


// ── THE ASSISTANT ────────────────────────────────────────────────────────────
// Lets the app ask Anthropic a question without the key ever leaving Google.
// Put the key in: Project Settings → Script Properties → Add script property
// → name ANTHROPIC_KEY, value sk-ant-…

function askAi_(body) {
  try {
    const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
    if (!key) {
      return jsonOut_({status: 'error',
        message: 'No ANTHROPIC_KEY in Script Properties yet.'});
    }
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'},
      payload: JSON.stringify(body.payload || {})
    });
    const data = JSON.parse(res.getContentText());
    if (data.error) return jsonOut_({status: 'error', message: data.error.message});
    const reply = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('\n');
    return jsonOut_({status: 'success', reply: reply});
  } catch (err) {
    return jsonOut_({status: 'error', message: String(err)});
  }
}

/** Lets the app check whether an assistant is set up before it asks anything. */
function aiReady_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  return jsonOut_({status: 'success', ai: !!key});
}


// ═════════════════════════════════════════════════════════════════════════════
// V8 — SIGNING IN
//
// Staff sign in with a username and password. The passwords live in a hidden
// 'Users' tab on this same sheet, salted and hashed — never in plain text, so
// anyone who opens the sheet still cannot read them.
//
// A successful sign-in hands back a signed token. Every other request must
// carry it, so the web app URL on its own is no longer a key to the shop.
// The token is signed with a secret this script generates for itself and
// keeps in Script Properties; it cannot be forged from the browser.
//
// FIRST RUN
//   1. Edit the list inside setupUsers() below.
//   2. Run setupUsers once from the editor.
//   3. Blank the passwords back out of setupUsers and save. They are hashed
//      into the sheet by then and are not needed here again.
// ═════════════════════════════════════════════════════════════════════════════

/* A note on names: every function a person is meant to RUN from the editor —
   setupUsers, diagnose, clearLockouts, testPdf, testModules, rebuildMirrors,
   rebuildPdfColumn, signOutEveryone, timeHash — deliberately has NO trailing
   underscore. Apps Script treats a trailing underscore as "private" and hides
   the function from the Run dropdown, so one added for tidiness makes the
   function impossible to run. Helpers nobody runs by hand keep theirs. */

const USER_SHEET   = 'Users';
const AUTH_ENFORCE = true;   // false = the login screen still shows, but the
                             // API stops checking. A fallback, not a setting
                             // to leave on.
const TOKEN_DAYS   = 7;      // how long a sign-in lasts before it asks again
const HASH_ROUNDS  = 5000;   // lower this if signing in feels slow
const MAX_TRIES    = 8;      // wrong passwords allowed per username…
const LOCKOUT_MIN  = 15;     // …within this many minutes

function userSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(USER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(USER_SHEET);
    sh.getRange(1, 1, 1, 7)
      .setValues([['Name', 'Username', 'Role', 'Salt', 'Hash', 'Active', 'Last signed in']])
      .setBackground('#1C1C30').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 4, sh.getMaxRows() - 1, 2).setNumberFormat('@');  // salt + hash stay text
    sh.hideSheet();
  }
  return sh;
}

/** Two separate secrets, and they must stay separate.
 *
 *  AUTH_SECRET signs tokens and is safe to rotate — that is exactly how
 *  signOutEveryone works.
 *
 *  PASSWORD_PEPPER goes into every password hash. Rotating it would make
 *  every stored hash unmatchable and lock the whole shop out for good, so
 *  nothing in this file ever touches it after it is first written.
 */
function authSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('AUTH_SECRET');
  if (!s) { s = randomKey_(64); props.setProperty('AUTH_SECRET', s); }
  return s;
}

function passwordPepper_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('PASSWORD_PEPPER');
  if (!s) { s = randomKey_(64); props.setProperty('PASSWORD_PEPPER', s); }
  return s;
}

function randomKey_(n) {
  let s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.substring(0, n);
}

/** Salted, peppered, and run round and round so a stolen sheet is still
 *  no use. Not bcrypt — Apps Script has none — but far past guessable. */
function hashPassword_(password, salt) {
  let acc = salt + ':' + String(password) + ':' + passwordPepper_();
  for (let i = 0; i < HASH_ROUNDS; i++) {
    acc = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, acc, Utilities.Charset.UTF_8));
  }
  return acc;
}

/** Compares without leaking, through timing, how much of it matched. */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── tokens ───────────────────────────────────────────────────────────────────

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, authSecret_()));
}

function makeToken_(username, role) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    u: username, r: role, exp: Date.now() + TOKEN_DAYS * 86400000
  }));
  return payload + '.' + sign_(payload);
}

function readToken_(token) {
  if (!token) return null;
  const s = String(token);
  const i = s.lastIndexOf('.');
  if (i < 1) return null;
  const payload = s.substring(0, i), sig = s.substring(i + 1);
  if (!safeEqual_(sig, sign_(payload))) return null;
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payload)).getDataAsString());
  } catch (e) { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

// ── users ────────────────────────────────────────────────────────────────────

function findUser_(username) {
  const sh = userSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, 7).getValues();
  const key = String(username || '').trim().toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).trim().toLowerCase() === key && key) {
      const active = rows[i][5];
      return {
        row: i + 2,
        name: rows[i][0], username: String(rows[i][1]).trim(), role: rows[i][2] || 'staff',
        salt: String(rows[i][3]), hash: String(rows[i][4]),
        active: !(active === false || String(active).trim().toLowerCase() === 'no')
      };
    }
  }
  return null;
}

/** Too many wrong guesses on one username and it goes quiet for a while. */
function tooManyTries_(username, bump) {
  const cache = CacheService.getScriptCache();
  const k = 'try:' + String(username || '').toLowerCase();
  let n = Number(cache.get(k)) || 0;
  if (bump) { n++; cache.put(k, String(n), LOCKOUT_MIN * 60); }
  return n > MAX_TRIES;
}

function login_(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (tooManyTries_(username, false)) {
    return jsonOut_({status: 'error',
      message: 'Too many tries. Wait ' + LOCKOUT_MIN + ' minutes.'});
  }

  const u = findUser_(username);

  // Hash either way, so an unknown username takes as long as a wrong password
  // and cannot be told apart from one.
  const attempt = hashPassword_(password, u ? u.salt : 'no-such-user-salt');

  if (!u || !u.active || !u.hash || !safeEqual_(attempt, u.hash)) {
    tooManyTries_(username, true);
    Utilities.sleep(400);
    return jsonOut_({status: 'error', message: 'Wrong username or password'});
  }

  CacheService.getScriptCache().remove('try:' + username.toLowerCase());
  userSheet_().getRange(u.row, 7).setValue(new Date());

  return jsonOut_({
    status: 'success',
    token: makeToken_(u.username, u.role),
    name: u.name, username: u.username, role: u.role,
    expires: Date.now() + TOKEN_DAYS * 86400000
  });
}

/** The gate every other request goes through. */
function requireAuth_(token) {
  if (!AUTH_ENFORCE) return {u: '(open)', r: 'owner'};
  const t = readToken_(token);
  if (!t) return null;
  const u = findUser_(t.u);          // looked up each time, so switching a
  if (!u || !u.active) return null;  // user to Active = No locks them out now
  return {u: u.username, r: u.role, name: u.name};
}

function unauthorized_() {
  return jsonOut_({status: 'unauthorized', message: 'Please sign in again'});
}

function changePassword_(body, who) {
  const u = findUser_(who.u);
  if (!u) return jsonOut_({status: 'error', message: 'No such user'});

  const current = String(body.current || '');
  if (!safeEqual_(hashPassword_(current, u.salt), u.hash)) {
    Utilities.sleep(400);
    return jsonOut_({status: 'error', message: 'Current password is wrong'});
  }

  const next = String(body.next || '');
  if (next.length < 8) {
    return jsonOut_({status: 'error', message: 'New password must be at least 8 characters'});
  }

  const salt = randomKey_(32);
  const sh = userSheet_();
  sh.getRange(u.row, 4, 1, 2).setNumberFormat('@').setValues([[salt, hashPassword_(next, salt)]]);
  return jsonOut_({status: 'success', message: 'Password changed'});
}

// ── run these from the editor ────────────────────────────────────────────────

/**
 * Adds or resets the people who can sign in.
 *
 * Fill in the passwords, run this once, then BLANK THEM OUT AGAIN and save —
 * by then they are hashed into the sheet and this list is just a liability.
 * Running it again on an existing username resets that password and leaves
 * everything else alone.
 *
 * Roles: 'owner' sees everything. 'staff' is the shop floor. Anything else,
 * including 'admin', is read by the app as shop floor — it only ever asks
 * "is this owner?". Use 'owner' or 'staff' and nothing in between.
 */
function setupUsers() {
  const people = [
    // Name,      username,   password,   role
    ['Wesley',   'wesley',   '',          'owner'],
    ['Jackson',  'jackson',  '',          'owner'],
    ['Lina',     'lina',     '',          'staff']
  ];

  const sh = userSheet_();
  let added = 0, reset = 0, skipped = 0;

  people.forEach(function (p) {
    const name = p[0], username = String(p[1]).trim(), password = String(p[2]), role = p[3] || 'staff';
    if (!username) return;
    if (!password) { skipped++; return; }          // blank = leave this one alone
    if (password.length < 8) {
      Logger.log('SKIPPED ' + username + ' — password under 8 characters');
      skipped++; return;
    }

    const salt = randomKey_(32);
    const hash = hashPassword_(password, salt);
    const existing = findUser_(username);

    if (existing) {
      sh.getRange(existing.row, 1, 1, 6).setValues([[name, username, role, salt, hash, 'Yes']]);
      sh.getRange(existing.row, 4, 1, 2).setNumberFormat('@');
      reset++;
    } else {
      const row = sh.getLastRow() + 1;
      sh.getRange(row, 4, 1, 2).setNumberFormat('@');
      sh.getRange(row, 1, 1, 7).setValues([[name, username, role, salt, hash, 'Yes', '']]);
      added++;
    }
  });

  Logger.log('setupUsers: ' + added + ' added, ' + reset + ' reset, ' + skipped + ' left alone.');
  Logger.log('Now blank the passwords out of setupUsers and save.');
}

/** ── WHY CAN NOBODY SIGN IN? ──
 *  Run this from the editor and read View → Logs. It never prints a secret,
 *  only whether one is set, so it is safe to paste the output to anyone.
 *
 *  What the answers mean:
 *    "spreadsheet" is not your usual sheet  → this script is bound to the
 *        wrong file. Everything else will look empty. Open the right sheet
 *        and use ITS Apps Script project.
 *    AUTH_SECRET / PASSWORD_PEPPER "just made"  → this project had none
 *        until now, so it is a NEW project. Every password hash in the Users
 *        tab was made with the old project's pepper and can never match, and
 *        every saved sign-in was signed with the old secret. Run setupUsers
 *        with fresh passwords and everyone signs in again.
 *    a user with "hash: empty"  → setupUsers has not run for that person.
 *    "locked out"  → too many wrong tries. It clears itself; or run
 *        clearLockouts() to clear it now.
 */
function diagnose() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('spreadsheet : ' + ss.getName());
  Logger.log('tabs        : ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));

  const props = PropertiesService.getScriptProperties();
  const hadSecret = !!props.getProperty('AUTH_SECRET');
  const hadPepper = !!props.getProperty('PASSWORD_PEPPER');
  Logger.log('AUTH_SECRET : ' + (hadSecret ? 'set' : 'MISSING — will be just made on first use'));
  Logger.log('PASSWORD_PEPPER : ' + (hadPepper ? 'set' : 'MISSING — will be just made on first use'));
  if (!hadPepper) {
    Logger.log('  ⚠ No pepper means this project never hashed a password. Any hash');
    Logger.log('    already in the Users tab was made elsewhere and cannot match.');
    Logger.log('    Fix: run setupUsers with fresh passwords.');
  }
  if (!hadSecret) {
    Logger.log('  ⚠ No signing secret means every saved sign-in is void. Everyone');
    Logger.log('    signs in again once the passwords are set.');
  }

  const orders = ss.getSheetByName(SHEET_NAME);
  Logger.log('order tab   : ' + (orders ? SHEET_NAME + ', ' + Math.max(0, orders.getLastRow() - 1) + ' orders'
                                        : 'MISSING (' + SHEET_NAME + ')'));

  const sh = ss.getSheetByName(USER_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('users       : NONE. Run setupUsers.');
  } else {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    Logger.log('users       : ' + rows.length);
    const cache = CacheService.getScriptCache();
    rows.forEach(function (r) {
      const name = String(r[1]).trim();
      const locked = (Number(cache.get('try:' + name.toLowerCase())) || 0) > MAX_TRIES;
      Logger.log('  · ' + name
        + ' | role ' + (r[2] || 'staff')
        + ' | salt ' + (String(r[3]).length ? 'set' : 'EMPTY')
        + ' | hash ' + (String(r[4]).length ? 'set' : 'EMPTY')
        + ' | active ' + (String(r[5]).trim().toLowerCase() === 'no' ? 'NO' : 'yes')
        + (locked ? ' | LOCKED OUT right now' : ''));
    });
  }

  Logger.log('AUTH_ENFORCE: ' + AUTH_ENFORCE);
  Logger.log('hashing     : ' + (hashPassword_('x', 'y') === hashPassword_('x', 'y')
    ? 'steady (the same password always makes the same hash)'
    : 'UNSTEADY — something is very wrong'));
}

/** Clears the wrong-password lockout for everyone, now rather than in 15 minutes. */
function clearLockouts() {
  const sh = userSheet_();
  if (sh.getLastRow() < 2) { Logger.log('No users.'); return; }
  const cache = CacheService.getScriptCache();
  sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    cache.remove('try:' + String(r[0]).trim().toLowerCase());
  });
  Logger.log('Lockouts cleared. Try signing in again.');
}

/** How long one sign-in takes on this account, so HASH_ROUNDS can be tuned. */
function timeHash() {
  const t = Date.now();
  hashPassword_('measuring-only', randomKey_(32));
  Logger.log(HASH_ROUNDS + ' rounds took ' + (Date.now() - t) + ' ms. '
    + 'Under about 1500 ms is comfortable.');
}

/** Signs everyone out everywhere, at once, by changing the signing secret.
 *  Use it if a device goes missing. */
function signOutEveryone() {
  PropertiesService.getScriptProperties().deleteProperty('AUTH_SECRET');
  authSecret_();
  Logger.log('Every token is now void. Passwords are unaffected — everyone signs in again.');
}

// ── doPost ───────────────────────────────────────────────────────────────────
function doPost(e) {
  // ── V8 hook ──
  // Signing in is the one thing that needs no token. Everything else is
  // refused without one. These run BEFORE the order lock is taken, on
  // purpose: saveModule_ takes its own script lock, and one execution
  // waiting on a lock it already holds would sit there until it times out.
  let body = null;
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  if (body && body.action === 'LOGIN') return login_(body);

  const who = requireAuth_(body && body.token);
  if (!who) return unauthorized_();

  if (body.action === 'CHANGE_PASSWORD') return changePassword_(body, who);
  if (body.action === 'SAVE_MODULE')     return saveModule_(body);
  // ── V9 hook ──
  // Uploading is slow — a few seconds for a big scan — and it touches Drive,
  // not the order sheet. It stays outside the order lock for the same reason
  // SAVE_MODULE does.
  if (body.action === 'UPLOAD_PDF')      return uploadPdf_(body);
  if (body.action === 'DELETE_PDF')      return deletePdf_(body);
  if (body.action === 'ASK_AI')          return askAi_(body);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return err_(new Error('Server busy, please try again'));
  }

  try {
    const data = body || JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.openById(SHEET_ID);

    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet);

    let logSheet = ss.getSheetByName(LOG_NAME);
    if (!logSheet) {
      logSheet = ss.insertSheet(LOG_NAME);
      logSheet.getRange(1, 1, 1, 4)
              .setValues([['Timestamp', 'Action', 'Order Number', 'Result']])
              .setBackground('#1C1C30').setFontColor('#FFFFFF').setFontWeight('bold');
    }

    const action   = data.action === 'DELETE' ? 'DELETE' : 'SAVE/UPDATE';
    const orderNum = String(data.orderNum || '').trim();

    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() == orderNum) { rowIndex = i + 1; break; }
    }

    if (action === 'DELETE') {
      if (rowIndex > -1) sheet.deleteRow(rowIndex);
      logSheet.appendRow([new Date(), action, orderNum, 'deleted']);
      lock.releaseLock();
      return ok_({ message: 'Deleted' });
    }

    // ── VERSION GUARD (replaces the old client-clock comparison) ──────────────
    // The client sends back the 'Last Updated' value it received from the server.
    // If column J no longer matches, this client loaded the order before someone
    // else changed it — its copy of the whole order (including every item status)
    // is stale, so writing it would silently undo the other person's work.
    // Refuse, and let the client reload.
    if (rowIndex > -1) {
      const currentVersion = String(values[rowIndex - 1][9] || '');
      const baseVersion    = String(data.baseVersion || '');
      if (currentVersion && baseVersion !== currentVersion) {
        logSheet.appendRow([new Date(), action, orderNum,
                            'CONFLICT — rejected (client base: ' + (baseVersion || 'none') +
                            ', sheet: ' + currentVersion + ')']);
        lock.releaseLock();
        return conflict_(orderNum);
      }
    }

    // ── Ordered date is server-owned ─────────────────────────────────────────
    // Never taken from the client. New row = today in SGT. Existing row = keep
    // whatever is already in the sheet. A wrong device clock cannot reach it.
    const existingDate = rowIndex > -1 ? parseDate_(values[rowIndex - 1][1]) : '';
    const orderDate    = existingDate || todayString_();

    const itemsJson       = JSON.stringify(data.items || []);
    const fittedDatesJson = JSON.stringify(data.fittedDates || {});
    const nowTs           = new Date().toISOString();

    // A–L only. Column M (the PDF) is written by uploadPdf_ and must survive
    // every ordinary save, so it is deliberately outside this row.
    const orderRow = [
      orderNum,
      orderDate,                                                    // B - server-owned
      data.dueDate     ? String(data.dueDate).split('T')[0]     : '',
      data.fittingDate ? String(data.fittingDate).split('T')[0] : '',
      itemsJson,
      data.fitted != null ? Number(data.fitted) || 0 : 0,           // F - always a number
      fittedDatesJson,
      data.remarks   || '',
      data.archived === true ? true : false,
      nowTs,                                                        // J - new version stamp
      data.customerName || '',                                      // K - Name
      normalizeContact_(data.customerContact)                       // L - Contact
    ];

    // Determine target row FIRST, force J:L to plain text, THEN write.
    const targetRow = rowIndex > -1 ? rowIndex : sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 10, 1, 3).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, orderRow.length).setValues([orderRow]);

    logSheet.appendRow([new Date(), action, orderNum,
                        rowIndex > -1 ? 'updated row ' + targetRow : 'created row ' + targetRow]);

    lock.releaseLock();
    // Hand back the authoritative values so the client can correct itself.
    return ok_({ lastUpdated: nowTs, date: orderDate });

  } catch (err) {
    try { lock.releaseLock(); } catch (_) {}
    return err_(err);
  }
}

// ── doGet ────────────────────────────────────────────────────────────────────
function doGet(e) {
  // ── V8 hook ──
  // ?ping=1 is the one open call — it lets the app learn that signing in is
  // required before it has anything to sign in with. Everything else needs
  // its token on ?t=.
  const p = (e && e.parameter) || {};
  if (p.ping) return jsonOut_({status: 'success', auth: AUTH_ENFORCE});

  const who = requireAuth_(p.t);
  if (!who) return unauthorized_();

  if (p.modules) return getModules_();
  if (p.ai)      return aiReady_();
  // ?pdf=1 — "do you know how to take a PDF?" The app asks before it sends
  // one, so a script still on V8 gets told so instead of being posted a file
  // it would mistake for an order save.
  if (p.pdf)     return jsonOut_({status: 'success', pdf: true,
                                  folder: PDF_FOLDER, cell: PDF_CELL_MODE});

  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return ok_({ data: [] });

    const rows = sheet.getDataRange().getValues();
    const data = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r[0] === '') continue;

      let fittedDates = {};
      try { fittedDates = JSON.parse(r[6] || '{}'); } catch (_) {}

      let items = [];
      try { items = JSON.parse(r[4] || '[]'); } catch (_) {}

      data.push({
        orderNum:    String(r[0]).trim(),
        date:        parseDate_(r[1]),
        dueDate:     parseDate_(r[2]),
        fittingDate: parseDate_(r[3]),
        items:       items,
        fitted:      Number(r[5]) || 0,   // always a number, even if the cell is text
        fittedDates: fittedDates,
        remarks:     r[7] || '',
        archived:    r[8] === true || r[8] === 'true',
        lastUpdated: String(r[9] || ''),  // the version the client must send back
        customerName:    r[10] || '',
        customerContact: r[11] || ''
      });
    }

    return ok_({ data: data });

  } catch (err) {
    return err_(err);
  }
}

// ── RESPONSES ────────────────────────────────────────────────────────────────
function ok_(extra) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ status: 'success' }, extra)))
    .setMimeType(ContentService.MimeType.JSON);
}
function conflict_(orderNum) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'conflict',
      message: 'Order was changed on another device',
      orderNum: orderNum
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
function err_(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: e.toString() }))
    .setMimeType(ContentService.MimeType.JSON);
}
