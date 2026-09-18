/* ══════════════════════════════════════════════════
   INVOICE PDF + EMAIL
   Turns an invoice into a proper A4 tax invoice — the
   shop's own fonts, logo, UEN and GST number —
   and emails it to the client from the shop's address.

   The PDF is drawn here, in the browser, so what you
   preview is exactly what the client receives. The
   Apps Script only does the sending (and files a copy
   in Drive): see SAKAL-INVOICE-MAILER.gs.

   The PDF libraries are loaded the first time an
   invoice PDF is asked for, not with the app.
   Who the invoice is from lives in js/00-config.js.
   ══════════════════════════════════════════════════ */

var INV_PDF_LIBS = [
  'js/lib/vendor/jspdf.umd.min.js',
  'js/lib/vendor/invoice-fonts.js'
];
/* Nice to have. If it will not load, the invoice is drawn without it. */
var INV_PDF_EXTRAS = ['js/lib/vendor/sakal-logo.js'];
var invPdfLoading = null;
var invPdfView = null;          /* {id, url, name, draft} for the invoice on screen */
var invMailId = '';             /* the invoice the email form is for */
var mailBackend = null;         /* null = not asked yet; else the sheet's answer */

function loadScriptOnce(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = function() { resolve(); };
    s.onerror = function() { s.remove(); reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}
function loadInvoicePdfLibs() {
  if (window.jspdf && window.SAKAL_PDF_FONTS) return Promise.resolve();
  if (!invPdfLoading) {
    invPdfLoading = INV_PDF_LIBS.reduce(function(p, src) {
      return p.then(function() { return loadScriptOnce(src); });
    }, Promise.resolve()).catch(function(err) { invPdfLoading = null; throw err; });
    invPdfLoading = invPdfLoading.then(function() {
      return INV_PDF_EXTRAS.reduce(function(p, src) {
        return p.then(function() { return loadScriptOnce(src).catch(function() {}); });
      }, Promise.resolve());
    });
  }
  return invPdfLoading;
}

/* ── The numbers on the invoice ── */
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function invoiceFigures(v) {
  var B = INVOICE_BUSINESS, rate = Number(B.gstRate) || 0;
  var sub = invoiceSubtotal(v), disc = Number(v.discount) || 0;
  var net = Math.max(0, sub - disc);
  var gst, before, total;
  if (B.pricesIncludeGst) {
    total = round2(net); gst = round2(total * rate / (100 + rate)); before = round2(total - gst);
  } else {
    before = round2(net); gst = round2(before * rate / 100); total = round2(before + gst);
  }
  var paid = round2(v.paid);
  return { sub: round2(sub), disc: round2(disc), before: before, gst: gst, rate: rate,
           total: total, paid: paid, balance: round2(Math.max(0, total - paid)) };
}

function invoicePdfName(v) {
  return 'SAKAL Tax Invoice ' + String(v.no || 'draft').replace(/[^\w.-]+/g, '') + '.pdf';
}

function fillTemplate(t, v) {
  var f = invoiceFigures(v);
  return String(t || '')
    .replace(/\{client\}/g, v.client || 'there')
    .replace(/\{no\}/g, v.no || '')
    .replace(/\{total\}/g, money(f.total))
    .replace(/\{balance\}/g, money(f.balance));
}

/* ── Drawing ── */
var PDF_INK = [22, 21, 15], PDF_MUTED = [110, 106, 97], PDF_FAINT = [150, 145, 136],
    PDF_GOLD = [168, 132, 47], PDF_LINE = [228, 225, 217], PDF_SOFT = [246, 244, 239],
    PDF_STAMP = [188, 32, 38];

function buildInvoicePdf(v) {
  var B = INVOICE_BUSINESS, F = invoiceFigures(v);
  var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  var fonts = window.SAKAL_PDF_FONTS;
  doc.addFileToVFS('CormorantGaramond-Medium.ttf', fonts['CormorantGaramond-Medium.ttf']);
  doc.addFont('CormorantGaramond-Medium.ttf', 'Cormorant', 'normal');
  doc.addFileToVFS('Jost-Regular.ttf', fonts['Jost-Regular.ttf']);
  doc.addFont('Jost-Regular.ttf', 'Jost', 'normal');
  doc.addFileToVFS('Jost-SemiBold.ttf', fonts['Jost-SemiBold.ttf']);
  doc.addFont('Jost-SemiBold.ttf', 'Jost', 'bold');

  var title = (B.gstRegNo ? 'Tax Invoice ' : 'Invoice ') + (v.no || '');
  doc.setProperties({ title: title, subject: title + ' — ' + (v.client || ''),
                      author: B.legalName, creator: B.brand + ' Workshop' });

  var W = 210, H = 297, L = 18, R = 192, y = 0;
  var FOOT = 22;

  function color(c) { doc.setTextColor(c[0], c[1], c[2]); }
  function font(face, style, size, c) { doc.setFont(face, style || 'normal'); doc.setFontSize(size); color(c || PDF_INK); }
  function rule(yy, c, w) { doc.setDrawColor((c || PDF_LINE)[0], (c || PDF_LINE)[1], (c || PDF_LINE)[2]); doc.setLineWidth(w || 0.25); doc.line(L, yy, R, yy); }
  function spaced(t, x, yy, cs, align) {
    t = String(t);
    if (align === 'right') x -= doc.getTextWidth(t) + cs * (t.length - 1);
    else if (align === 'center') x -= (doc.getTextWidth(t) + cs * (t.length - 1)) / 2;
    doc.text(t, x, yy, { charSpace: cs });
  }
  function label(t, x, yy, align) { font('Jost', 'normal', 6.8, PDF_FAINT); spaced(String(t).toUpperCase(), x, yy, 0.45, align); }
  /* Nothing left to pay: the stamp, pressed beside the balance the way it
     would be onto a paper invoice. Drawn, not typed, so it stays
     crisp however far the invoice is zoomed or printed. */
  function paidStamp(xRight, cy) {
    var w = 31, h = 12.6, x = xRight - w;
    doc.setDrawColor(PDF_STAMP[0], PDF_STAMP[1], PDF_STAMP[2]); doc.setLineWidth(0.9);
    doc.roundedRect(x, cy - h / 2, w, h, 1.4, 1.4, 'S');
    font('Cormorant', 'normal', 21, PDF_STAMP);
    doc.text('Paid', x + w / 2, cy + 2.9, { align: 'center' });
  }

  /* The shop's mark, drawn `h` tall. Gives back how wide it came out, or 0
     if there is no logo to draw — the name then sits at the margin as before. */
  function drawLogo(x, yy, h) {
    var art = window.SAKAL_LOGO;
    if (!art || !art.data) return 0;
    var w = h * (Number(art.ratio) || 1);
    try { doc.addImage(art.data, art.type || 'PNG', x, yy, w, h); } catch (e) { return 0; }
    return w;
  }
  function room(h) {
    if (y + h <= H - FOOT - 2) return false;
    doc.addPage();
    var m = drawLogo(L, 10.6, 6.6);
    font('Cormorant', 'normal', 14); spaced(B.brand, m ? L + m + 2.6 : L, 16, 1.2);
    font('Jost', 'normal', 7.6, PDF_MUTED);
    doc.text((B.gstRegNo ? 'Tax invoice ' : 'Invoice ') + (v.no || '') + ' (continued)', R, 16, { align: 'right' });
    rule(19);
    y = 26;
    return true;
  }

  /* ── Letterhead ── */
  y = 24;
  var mark = drawLogo(L, y - 9.4, 11.4);        // the mark, sitting on the name's own line
  font('Cormorant', 'normal', 30);
  doc.text(B.brand, mark ? L + mark + 4.4 : L - 0.4, y, { charSpace: 2.6 });
  font('Jost', 'bold', 8.6); doc.text(B.legalName, L, y + 8);
  font('Jost', 'normal', 8, PDF_MUTED);
  var head = (B.address || []).slice();
  var ids = ['UEN ' + B.uen];
  if (B.gstRegNo) ids.push('GST Reg. No. ' + B.gstRegNo);
  head.push(ids.join('  ·  '));
  head.push([B.email, B.phone, B.website].filter(Boolean).join('  ·  '));
  head.forEach(function(t, i) { doc.text(t, L, y + 12.5 + i * 4.1); });

  font('Cormorant', 'normal', 23);
  spaced(B.gstRegNo ? 'TAX INVOICE' : 'INVOICE', R, y, 1.2, 'right');

  var meta = [['Invoice no.', v.no || '—'], ['Date', formatDisplayDate(v.issued || todayYMD())]];
  if (v.orderNum) meta.push(['Order no.', v.orderNum]);
  if (v.fitting) meta.push(['Fitting', formatDisplayDate(v.fitting)]);
  if (v.due) meta.push(['Garments ready', formatDisplayDate(v.due)]);
  if (v.staff) meta.push(['Attended by', v.staff]);
  meta.forEach(function(m, i) {
    var yy = y + 8 + i * 4.6;
    label(m[0], R - 34, yy, 'right');
    font('Jost', i === 0 ? 'bold' : 'normal', 8.6); doc.text(String(m[1]), R, yy, { align: 'right' });
  });

  y = Math.max(y + 12.5 + head.length * 4.1, y + 8 + meta.length * 4.6) + 4;
  doc.setDrawColor(PDF_GOLD[0], PDF_GOLD[1], PDF_GOLD[2]); doc.setLineWidth(0.6); doc.line(L, y, R, y);
  y += 9;

  /* ── Billed to, and where the bill stands ── */
  label('Billed to', L, y);
  var who = [];
  font('Jost', 'bold', 11); doc.text(v.client || '—', L, y + 5.5);
  String(v.address || '').split(/\n|,\s*(?=\S)/).map(function(s) { return s.trim(); }).filter(Boolean)
    .forEach(function(s) { who.push(s); });
  if (v.phone) who.push(v.phone);
  if (v.email) who.push(v.email);
  font('Jost', 'normal', 8.6, PDF_MUTED);
  who.forEach(function(t, i) { doc.text(t, L, y + 10.5 + i * 4.2); });

  var bx = 128, bw = R - bx, bh = 22;
  var settled = F.total > 0 && F.balance <= 0.004;
  doc.setFillColor(PDF_SOFT[0], PDF_SOFT[1], PDF_SOFT[2]);
  doc.roundedRect(bx, y - 3, bw, bh, 2, 2, 'F');
  if (settled) paidStamp(bx - 6, y + 8);       // the stamp sits beside the balance
  label(F.paid > 0 ? 'Balance due' : 'Amount due', bx + 5, y + 2.5);
  font('Jost', 'bold', 16); doc.text('S$ ' + money(F.balance), bx + 5, y + 10.5);
  font('Jost', 'normal', 7.6, PDF_MUTED);
  doc.text(settled ? 'S$ ' + money(F.paid) + ' received with thanks'
         : F.paid > 0 ? 'of S$ ' + money(F.total) + ' · S$ ' + money(F.paid) + ' received'
                      : 'Please pay by ' + (v.due ? formatDisplayDate(v.due) : 'collection'), bx + 5, y + 15.5);
  y = Math.max(y + 10.5 + who.length * 4.2, y + bh) + 6;

  /* ── Line items ── */
  var cNo = L + 2, cDesc = L + 10, cQty = 140, cUnit = 165, cAmt = R - 2, descW = cQty - 12 - cDesc;
  function tableHead() {
    doc.setFillColor(PDF_SOFT[0], PDF_SOFT[1], PDF_SOFT[2]);
    doc.rect(L, y, R - L, 8, 'F');
    label('#', cNo, y + 5.2); label('Description', cDesc, y + 5.2);
    label('Qty', cQty, y + 5.2, 'right'); label('Unit price', cUnit, y + 5.2, 'right'); label('Amount (S$)', cAmt, y + 5.2, 'right');
    y += 8;
  }
  tableHead();

  var lines = (v.lines || []).filter(function(l) { return String(l.desc || '').trim() || Number(l.unit); });
  if (!lines.length) lines = [{ desc: '—', qty: '', unit: '' }];
  lines.forEach(function(l, i) {
    font('Jost', 'normal', 9.4);
    var main = doc.splitTextToSize(String(l.desc || '—'), descW);
    var subs = [];
    (l.parts || []).forEach(function(p) {
      var bits = [];
      if (p.fabric) bits.push('fabric ' + p.fabric);
      if (p.lining) bits.push('lining ' + p.lining);
      if (bits.length) subs.push(p.product + ' — ' + bits.join(' · '));
    });
    font('Jost', 'normal', 7.8);
    var subLines = [];
    subs.forEach(function(s) { subLines = subLines.concat(doc.splitTextToSize(s, descW)); });
    var h = 4 + main.length * 4.4 + subLines.length * 3.7 + 3;
    if (room(h)) tableHead();

    var top = y + 5;
    font('Jost', 'normal', 8.4, PDF_FAINT); doc.text(String(i + 1), cNo, top);
    font('Jost', 'normal', 9.4); doc.text(main, cDesc, top);
    var qty = Number(l.qty) || 0, unit = Number(l.unit) || 0;
    if (l.qty !== '' || l.unit !== '') {
      doc.text(String(qty), cQty, top, { align: 'right' });
      doc.text(money(unit), cUnit, top, { align: 'right' });
      doc.text(money(qty * unit), cAmt, top, { align: 'right' });
    }
    if (subLines.length) {
      font('Jost', 'normal', 7.8, PDF_MUTED);
      doc.text(subLines, cDesc, top + main.length * 4.4 - 0.4);
    }
    y += h;
    doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]); doc.setLineWidth(0.2); doc.line(L, y, R, y);
  });

  /* ── Totals ── */
  var rows = [['Subtotal', money(F.sub)]];
  if (F.disc) rows.push(['Discount', '− ' + money(F.disc)]);
  if (INVOICE_BUSINESS.pricesIncludeGst) {
    rows.push(['total', money(F.total)]);
    if (F.rate) {
      rows.push(['Amount before GST', money(F.before)]);
      rows.push(['GST ' + F.rate + '% (included)', money(F.gst)]);
    }
  } else {
    if (F.rate) rows.push(['GST ' + F.rate + '%', money(F.gst)]);
    rows.push(['total', money(F.total)]);
  }
  if (F.paid) { rows.push(['Amount received', '− ' + money(F.paid)]); rows.push(['balance', money(F.balance)]); }

  var need = rows.length * 6 + 14;
  room(need);
  y += 6;
  var totTop = y, tx = 118;
  rows.forEach(function(r) {
    if (r[0] === 'total' || r[0] === 'balance') {
      doc.setDrawColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]); doc.setLineWidth(0.35); doc.line(tx, y - 1.5, R, y - 1.5);
      font('Jost', 'bold', 9.4);
      doc.text(r[0] === 'total' ? 'Total (S$)' + (F.rate && INVOICE_BUSINESS.pricesIncludeGst ? ', incl. GST' : '') : 'Balance due (S$)', tx, y + 4);
      font('Jost', 'bold', 11); doc.text(r[1], R, y + 4.2, { align: 'right' });
      y += 9;
    } else {
      font('Jost', 'normal', 8.6, PDF_MUTED); doc.text(r[0], tx, y + 3);
      font('Jost', 'normal', 8.8); doc.text(r[1], R, y + 3, { align: 'right' });
      y += 5.6;
    }
  });

  /* remarks sit beside the totals when they fit */
  if (v.note) {
    var noteLines = doc.splitTextToSize(String(v.note), 88);
    label('Notes', L, totTop + 3);
    font('Jost', 'normal', 8.4, PDF_MUTED); doc.text(noteLines.slice(0, 8), L, totTop + 8);
    y = Math.max(y, totTop + 8 + Math.min(8, noteLines.length) * 3.8);
  }
  y += 6;

  /* ── Footer, on every page ── */
  var pages = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= pages; pg++) {
    doc.setPage(pg);
    font('Cormorant', 'normal', 12);
    doc.text('Thank you for choosing ' + B.brand + '.', W / 2, H - 17, { align: 'center' });
    rule(H - 13);
    font('Jost', 'normal', 6.8, PDF_FAINT);
    doc.text('This is a computer-generated ' + (B.gstRegNo ? 'tax ' : '') + 'invoice. No signature is required.', L, H - 8.5);
    doc.text('Page ' + pg + ' of ' + pages, R, H - 8.5, { align: 'right' });
  }
  return doc;
}

async function invoicePdfFor(v) {
  await loadInvoicePdfLibs();
  var doc = buildInvoicePdf(v);
  return { doc: doc, blob: doc.output('blob'), name: invoicePdfName(v) };
}

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = function() { reject(new Error('The PDF could not be read')); };
    r.readAsDataURL(blob);
  });
}

/* ── The invoice as the form currently shows it (for a preview before saving) ── */
function invoiceFromForm() {
  var base = invEditId ? (invoices.find(function(x) { return x.id === invEditId; }) || {}) : {};
  return Object.assign({}, base, {
    no: $('inv-no').value.trim() || nextInvoiceNo(),
    orderNum: $('inv-order').value.trim(),
    client: $('inv-client').value.trim(), email: $('inv-email').value.trim(),
    phone: $('inv-phone').value.trim(), address: $('inv-address') ? $('inv-address').value.trim() : (base.address || ''),
    staff: invStaff, issued: $('inv-issued').value, due: $('inv-due').value, fitting: $('inv-fitting').value,
    lines: invLines.filter(function(l) { return String(l.desc || '').trim() || Number(l.unit); }),
    discount: Number($('inv-discount').value) || 0,
    paid: $('inv-paid') ? (Number($('inv-paid').value) || 0) : (base.paid || 0),
    note: $('inv-note').value.trim()
  });
}

function findInvoice(id) { return invoices.find(function(x) { return x.id === id; }) || null; }

/* ── Preview ── */
async function previewInvoicePdf(id) {
  var draft = !id;
  var v = draft ? invoiceFromForm() : findInvoice(id);
  if (!v) return;
  setSync('warn', 'Making the PDF…');
  try {
    var pdf = await invoicePdfFor(v);
    closeInvoicePdf();
    var url = URL.createObjectURL(pdf.blob);
    invPdfView = { id: id || invEditId || '', url: url, name: pdf.name, blob: pdf.blob, draft: draft };
    $('invpdf-title').textContent = (INVOICE_BUSINESS.gstRegNo ? 'Tax invoice ' : 'Invoice ') + (v.no || '');
    $('invpdf-sub').textContent = (v.client || 'No client yet') + ' · S$ ' + money(invoiceFigures(v).total)
      + (draft ? ' · preview of what is on the form' : '');
    $('invpdf-email').style.display = (v.email || !draft) ? '' : 'none';
    /* Android Chrome and a few others cannot draw a PDF inside a page. */
    var inline = navigator.pdfViewerEnabled !== false;
    $('invpdf-fallback').classList.toggle('show', !inline);
    $('invpdf-frame').style.display = inline ? '' : 'none';
    if (inline) $('invpdf-frame').src = url;
    $('invpdf-over').classList.add('open');
    document.body.style.overflow = 'hidden';
    setSync('', 'All changes saved');
  } catch (err) {
    console.error(err);
    setSync('bad', 'PDF not made');
    showToast('Could not make the PDF — ' + (err && err.message ? err.message : err));
  }
}

function closeInvoicePdf() {
  var o = $('invpdf-over'); if (!o) return;
  o.classList.remove('open');
  document.body.style.overflow = '';
  $('invpdf-frame').removeAttribute('src');
  if (invPdfView && invPdfView.url) setTimeout(function(u) { return function() { URL.revokeObjectURL(u); }; }(invPdfView.url), 4000);
  invPdfView = null;
}

function downloadViewedInvoice() {
  if (!invPdfView) return;
  var a = document.createElement('a');
  a.href = invPdfView.url; a.download = invPdfView.name;
  document.body.appendChild(a); a.click(); a.remove();
}

async function downloadInvoicePdf(id) {
  var v = findInvoice(id); if (!v) return;
  try {
    var pdf = await invoicePdfFor(v);
    var url = URL.createObjectURL(pdf.blob);
    var a = document.createElement('a');
    a.href = url; a.download = pdf.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
  } catch (err) {
    showToast('Could not make the PDF — ' + (err && err.message ? err.message : err));
  }
}

function emailViewedInvoice() {
  if (!invPdfView) return;
  var view = invPdfView;
  closeInvoicePdf();
  if (view.draft) emailFromInvoiceModal();
  else openInvoiceEmail(view.id);
}

/* From the invoice form: save it first, then write the email. */
function emailFromInvoiceModal() {
  var saved = saveInvoice();
  if (saved) openInvoiceEmail(saved.id);
}

/* ── Can the sheet send email? ──
   Asked before the first send. A script without the mailer would read an
   unknown POST as an order save, which must never happen. */
async function mailBackendReady(recheck) {
  if (mailBackend && mailBackend.mail && !recheck) return mailBackend;
  try {
    var r = await fetch(API_URL + '?mail=1', { redirect: 'follow' });
    var res = {};
    try { res = JSON.parse(await r.text()); } catch (_) { res = {}; }
    mailBackend = (res.status === 'success' && res.mail === true) ? res : { mail: false };
  } catch (err) {
    mailBackend = { mail: false, offline: true };
  }
  return mailBackend;
}

/* ── The email form ── */
var EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
function emailList(s) {
  return String(s || '').split(/[,;\s]+/).map(function(x) { return x.trim(); }).filter(Boolean);
}
function notAnEmail(e) { return !EMAIL_RE.test(e); }

/* One place decides how a bad address is shown, so To and Cc behave alike. */
function invMailErr(field, msg) {
  var err = $('invmail-' + field + '-err');
  if (err) { err.textContent = msg; err.classList.add('show'); }
  $('invmail-' + field).classList.add('err');
}
function clearInvMailErr(field) {
  var err = $('invmail-' + field + '-err');
  if (err) err.classList.remove('show');
  $('invmail-' + field).classList.remove('err');
}

function openInvoiceEmail(id) {
  var v = findInvoice(id);
  if (!v) { showToast('Save the invoice first.'); return; }
  invMailId = id;
  var B = INVOICE_BUSINESS, F = invoiceFigures(v);
  $('invmail-title').textContent = 'Email invoice ' + (v.no || '');
  $('invmail-from').textContent = B.email;
  $('invmail-to').value = v.email || '';
  $('invmail-cc').value = '';
  $('invmail-subject').value = fillTemplate(B.emailSubject, v);
  $('invmail-body').value = fillTemplate(B.emailMessage, v);
  $('invmail-file').textContent = invoicePdfName(v);
  $('invmail-sum').textContent = 'S$ ' + money(F.total) + (F.paid ? ' · balance S$ ' + money(F.balance) : '');
  var last = (v.emails || [])[(v.emails || []).length - 1];
  $('invmail-history').textContent = last
    ? 'Last emailed ' + formatDisplayDate(last.at) + ' to ' + last.to + (last.by ? ' by ' + last.by : '')
      + ((v.emails || []).length > 1 ? ' · ' + v.emails.length + ' times in all' : '')
    : '';
  $('invmail-warn').classList.remove('show');
  clearInvMailErr('to'); clearInvMailErr('cc');
  $('invmail-send').disabled = false; $('invmail-send').textContent = 'Send email';
  $('invmail-modal').classList.add('open');
  setTimeout(function() { (v.email ? $('invmail-body') : $('invmail-to')).focus(); }, 60);

  // Ask the sheet now, so a missing mailer shows before anyone types.
  mailBackendReady(true).then(function(m) {
    if (invMailId !== id) return;
    if (!m.mail) {
      $('invmail-warn').textContent = m.offline
        ? 'No connection to the sheet right now — the email cannot go out until it is back.'
        : 'The sheet cannot send email yet. Add SAKAL-INVOICE-MAILER.gs to the Apps Script and redeploy (see the README).';
      $('invmail-warn').classList.add('show');
    } else if (m.from && String(m.from).toLowerCase() !== String(B.email).toLowerCase()) {
      $('invmail-from').textContent = m.from + ' (replies go to ' + B.email + ')';
    }
  });
}
function closeInvoiceEmail() { $('invmail-modal').classList.remove('open'); invMailId = ''; }

function previewEmailedInvoice() { if (invMailId) previewInvoicePdf(invMailId); }

async function sendInvoiceEmail() {
  var v = findInvoice(invMailId); if (!v) return;
  var to = emailList($('invmail-to').value), cc = emailList($('invmail-cc').value);
  var badTo = to.filter(notAnEmail), badCc = cc.filter(notAnEmail);
  clearInvMailErr('to'); clearInvMailErr('cc');
  /* whichever box the trouble is in is the one that says so */
  if (badCc.length) invMailErr('cc', '"' + badCc[0] + '" is not an email address');
  if (!to.length)        invMailErr('to', 'Who is it going to?');
  else if (badTo.length) invMailErr('to', '"' + badTo[0] + '" is not an email address');
  if (!to.length || badTo.length || badCc.length) {
    $(badTo.length || !to.length ? 'invmail-to' : 'invmail-cc').focus();
    return;
  }
  var subject = $('invmail-subject').value.trim() || fillTemplate(INVOICE_BUSINESS.emailSubject, v);
  var message = $('invmail-body').value;

  var btn = $('invmail-send');
  btn.disabled = true; btn.textContent = 'Checking the sheet…';
  var m = await mailBackendReady(true);
  if (!m.mail) {
    btn.disabled = false; btn.textContent = 'Send email';
    $('invmail-warn').textContent = m.offline
      ? 'No connection to the sheet — nothing was sent.'
      : 'The sheet cannot send email yet — nothing was sent. Add SAKAL-INVOICE-MAILER.gs to the Apps Script and redeploy.';
    $('invmail-warn').classList.add('show');
    return;
  }

  btn.textContent = 'Sending…';
  setSync('warn', 'Emailing invoice ' + v.no + '…');
  try {
    var pdf = await invoicePdfFor(v);
    var b64 = await blobToBase64(pdf.blob);
    var F = invoiceFigures(v);
    var r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'EMAIL_INVOICE',
        to: to.join(','), cc: cc.join(','), subject: subject, message: message,
        invoiceNo: v.no || '', orderNum: v.orderNum || '', client: v.client || '',
        total: money(F.total), balance: money(F.balance), issued: formatDisplayDate(v.issued),
        business: { brand: INVOICE_BUSINESS.brand, legalName: INVOICE_BUSINESS.legalName, uen: INVOICE_BUSINESS.uen,
                    address: (INVOICE_BUSINESS.address || []).join(', '), email: INVOICE_BUSINESS.email,
                    website: INVOICE_BUSINESS.website },
        filename: pdf.name, pdf: b64
      })
    });
    var text = await r.text(), res = {};
    try { res = JSON.parse(text); } catch (_) { res = {}; }
    if (res.status === 'unauthorized') throw new Error('Signed out — sign in and try again');
    if (res.status !== 'success') throw new Error(res.message || 'The sheet did not send it');

    var who = (window.SakalAuth && SakalAuth.name()) || '';
    v.sent = true;
    v.emails = (v.emails || []).concat([{ to: to.join(', '), cc: cc.join(', '), at: res.sentAt || new Date().toISOString(),
                                          by: who, from: res.from || '' }]);
    if (res.file && res.file.url) v.pdfFile = res.file;
    v.updated = todayYMD();
    persistInvoices();
    renderInvoices();
    closeInvoiceEmail();
    setSync('', 'All changes saved');
    showToast('Invoice ' + v.no + ' emailed to ' + to.join(', ')
      + (res.from && String(res.from).toLowerCase() !== String(INVOICE_BUSINESS.email).toLowerCase() ? ' (sent from ' + res.from + ')' : ''), 7000);
  } catch (err) {
    console.error('Invoice email failed:', err);
    mailBackend = null;
    setSync('bad', 'Invoice not emailed');
    btn.disabled = false; btn.textContent = 'Send email';
    $('invmail-warn').textContent = 'Not sent — ' + (err && err.message ? err.message : err);
    $('invmail-warn').classList.add('show');
  }
}

/* the row on the invoice list: when it last went out */
function invoiceEmailLine(v) {
  var last = (v.emails || [])[(v.emails || []).length - 1];
  if (!last) return '';
  return '<div class="cell-sub inv-emailed">Emailed ' + esc(shortDate(last.at) || formatDisplayDate(last.at))
    + ' to ' + esc(last.to) + '</div>';
}
