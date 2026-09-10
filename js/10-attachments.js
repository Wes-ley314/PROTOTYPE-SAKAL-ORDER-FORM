/* ══════════════════════════════════════════════════
   ORDER FORM PDF
   One PDF per order. The file goes up to a Drive
   folder beside the sheet and the order keeps the
   link, so every phone on the floor opens the same
   paper. Nothing heavy is ever stored on the device.
   ══════════════════════════════════════════════════ */

var PDF_MAX_MB = 8;
var pdfBusy = {};            /* order number → true while a file is on its way up */
var pdfViewing = '';         /* the order whose form is on screen, if any */
var pdfBackend = null;       /* null = not asked yet, true/false = the sheet's answer */

/* ── Does the sheet know how to take a PDF? ──
   Worth asking before sending one. A script still on V8 has no UPLOAD_PDF,
   so the post would fall through to its order handler and be read as a save
   of the order it names — which is a far worse outcome than a clear no. */
async function pdfBackendReady(recheck) {
  if (pdfBackend !== null && !recheck) return pdfBackend;
  try {
    var r = await fetch(API_URL + '?pdf=1', {redirect: 'follow'});
    var res = {};
    try { res = JSON.parse(await r.text()); } catch(_) { res = {}; }
    pdfBackend = res.status === 'success' && res.pdf === true;
  } catch (err) {
    pdfBackend = false;
  }
  return pdfBackend;
}

function pdfFor(num)  { return orderPdfs[String(num == null ? '' : num)] || null; }
function hasPdf(num)  { return !!pdfFor(num); }

/* Moving an attachment when the order is renumbered in the edit modal. */
function renameOrderPdf(oldNum, newNum) {
  var a = String(oldNum || ''), b = String(newNum || '');
  if (!a || !b || a === b || !orderPdfs[a]) return;
  orderPdfs[b] = orderPdfs[a];
  delete orderPdfs[a];
  persistAttachments();
}

/* ── The control on an order card ── */
function pdfButton(num) {
  var key = String(num == null ? '' : num), q = esc(key), p = pdfFor(key);

  if (pdfBusy[key]) {
    return '<button class="btn sm" disabled>Uploading…</button>';
  }

  if (!p) {
    return '<button class="btn sm gold" onclick="pickOrderPdf(\''+q+'\')" '
      + 'title="Attach the order form as a PDF">Attach PDF</button>';
  }
  return '<button class="btn sm" onclick="openOrderPdf(\''+q+'\')" title="'+esc(p.name || 'Order form')+'">PDF ✓</button>'
    + '<button class="icon-btn" onclick="pickOrderPdf(\''+q+'\')" aria-label="Replace the PDF" title="Replace the PDF">'
    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    +   '<path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
    + '</button>'
    + '<button class="icon-btn danger" onclick="confirmRemovePdf(\''+q+'\')" aria-label="Remove the PDF" title="Remove the PDF">'
    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    + '</button>';
}

/* The file's name, read out under the order it belongs to. */
function pdfStrip(o) {
  var p = pdfFor(o && o.orderNum); if (!p) return '';
  return '<div class="oc-note oc-pdf">'
    + '<span class="oc-pdf-key">Order form</span>'
    + '<a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.name)+'</a>'
    + (p.uploaded ? '<span class="oc-pdf-when">attached '+esc(formatDisplayDate(p.uploaded))+'</span>' : '')
    + '</div>';
}

/* ── Picking, sending, opening, removing ── */
function pickOrderPdf(num) {
  var key = String(num == null ? '' : num);
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  inp.style.display = 'none';
  inp.onchange = function() {
    var f = inp.files && inp.files[0];
    document.body.removeChild(inp);
    if (f) uploadOrderPdf(key, f);
  };
  document.body.appendChild(inp);
  inp.click();
}

async function uploadOrderPdf(num, file) {
  var key = String(num == null ? '' : num);
  if (!key) return;

  var looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!looksPdf) { showToast('That is not a PDF. Save the order form as a PDF and try again.'); return; }
  if (file.size > PDF_MAX_MB * 1024 * 1024) {
    showToast('That PDF is ' + (file.size / 1048576).toFixed(1) + ' MB. Keep it under ' + PDF_MAX_MB + ' MB.');
    return;
  }

  if (!(await pdfBackendReady())) {
    showToast('The sheet cannot take PDFs yet. Paste SAKAL-BACKEND-V9 into Apps Script and redeploy.');
    setSync('warn', 'Sheet not ready for PDFs');
    return;
  }

  var p = pdfFor(key);          // what was there before, if anything
  pdfBusy[key] = true;
  renderOrders(); renderArchive();
  setSync('warn', (p ? 'Replacing the PDF…' : 'Sending the PDF…'));

  try {
    var b64 = await fileToBase64(file);
    var r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'UPLOAD_PDF', orderNum: key, name: file.name || '', data: b64})
    });
    var text = await r.text(), res = {};
    try { res = JSON.parse(text); } catch(_) { res = {}; }
    if (res.status === 'unauthorized') throw new Error('Signed out — sign in and try again');
    if (res.status !== 'success' || !res.file || !res.file.url) {
      throw new Error(res.message
        || (res.status === 'conflict'
              ? 'The sheet read the upload as an order save — its script is still on V8'
              : 'The sheet did not take the file'));
    }

    orderPdfs[key] = {
      name:     res.file.name || file.name || 'Order form.pdf',
      url:      res.file.url,
      id:       res.file.id || '',
      size:     file.size,
      uploaded: todayYMD()
    };
    persistAttachments();

    // Replaced from inside the viewer? Show the new one where the old was.
    if (pdfViewing === key) {
      $('pdf-sub').textContent = 'Order ' + key + ' · ' + orderPdfs[key].name;
      $('pdf-fallback').classList.remove('show');
      $('pdf-frame').src = drivePreviewUrl(orderPdfs[key]);
    }

    showToast(p ? 'PDF replaced on order ' + key : 'PDF attached to order ' + key);
  } catch (err) {
    console.error('PDF upload failed:', err);
    pdfBackend = null;            // ask again next time; the script may have just been fixed
    setSync('bad', p ? 'PDF not replaced' : 'PDF not attached');
    // Say what the sheet actually said. A guess at the cause helps nobody
    // standing at the counter with a customer waiting.
    showToast('Could not ' + (p ? 'replace' : 'attach') + ' the PDF — '
      + String(err && err.message ? err.message : err));
  } finally {
    delete pdfBusy[key];
    renderOrders(); renderArchive();
  }
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload  = function() {
      var s = String(r.result || ''), i = s.indexOf(',');
      resolve(i === -1 ? s : s.slice(i + 1));
    };
    r.onerror = function() { reject(new Error('The file could not be read')); };
    r.readAsDataURL(file);
  });
}

/* ── The viewer ──
   Drive renders the PDF for us at /preview, which is the same page you get
   in Drive minus its chrome. It only loads inside another page while the
   file is link-shared; if it will not, the fallback offers the tab instead. */
function drivePreviewUrl(p) {
  if (p.id) return 'https://drive.google.com/file/d/' + p.id + '/preview';
  return String(p.url || '').replace(/\/view(\?.*)?$/, '/preview');
}

function openOrderPdf(num) {
  var key = String(num == null ? '' : num), p = pdfFor(key); if (!p) return;

  pdfViewing = key;
  $('pdf-sub').textContent = 'Order ' + key + ' · ' + p.name;
  $('pdf-fallback').classList.remove('show');

  var f = $('pdf-frame');
  var loaded = false;
  f.onload = function() { loaded = true; $('pdf-fallback').classList.remove('show'); };
  f.src = drivePreviewUrl(p);

  $('pdf-over').classList.add('open');
  document.body.style.overflow = 'hidden';

  // If nothing has rendered after a moment, offer the tab instead.
  setTimeout(function() { if (!loaded) $('pdf-fallback').classList.add('show'); }, 3500);
}

function closePdfViewer() {
  $('pdf-over').classList.remove('open');
  document.body.style.overflow = '';
  var f = $('pdf-frame');
  f.onload = null; f.removeAttribute('src');
  pdfViewing = '';
}

function openViewedPdfInDrive() {
  var p = pdfFor(pdfViewing); if (!p) return;
  var w = window.open(p.url, '_blank', 'noopener');
  if (!w) showToast('Allow pop-ups for this site to open the PDF.');
}

/* Replacing is attaching again — the sheet bins the old file as it files
   the new one, so an order never ends up with two forms. */
function replaceViewedPdf() { if (pdfViewing) pickOrderPdf(pdfViewing); }
function removeViewedPdf()  { if (pdfViewing) confirmRemovePdf(pdfViewing); }

function confirmRemovePdf(num) {
  var key = String(num == null ? '' : num), p = pdfFor(key); if (!p) return;
  $('confirm-title').textContent = 'Remove this PDF?';
  $('confirm-msg').innerHTML = '<strong>'+esc(p.name)+'</strong> comes off order <strong>'+esc(key)
    + '</strong> and goes to the bin in Drive.';
  var b = $('confirm-go');
  b.textContent = 'Remove'; b.className = 'btn btn-danger';
  b.onclick = function() { closeConfirmModal(); removeOrderPdf(key); };
  $('confirm-modal').classList.add('open');
}

/* The link comes off the order either way. A Drive that refuses to bin the
   file is worth saying out loud, but it must not strand the order. */
async function removeOrderPdf(num) {
  var key = String(num == null ? '' : num), p = pdfFor(key); if (!p) return;
  if (pdfViewing === key) closePdfViewer();
  delete orderPdfs[key];
  persistAttachments();
  renderOrders(); renderArchive();
  showToast('PDF removed from order ' + key);

  if (!p.id) return;
  try {
    var r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'DELETE_PDF', fileId: p.id})
    });
    var res = {};
    try { res = JSON.parse(await r.text()); } catch(_) { res = {}; }
    if (res.status !== 'success') console.warn('PDF left in Drive:', res.message || 'no answer');
  } catch (err) {
    console.warn('PDF left in Drive:', err);
  }
}
