/* Checks the in-app PDF viewer: open, replace, remove, close. */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inlined = html.replace(/<script src="(js\/[^"]+)"><\/script>/g,
  (_, f) => '<script>\n' + fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n</script>');
const dom = new JSDOM(inlined, { url: 'https://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const win = dom.window, doc = win.document;
win.fetch = () => Promise.reject(new Error('offline (check)'));

const fails = [], ok = [];
const t = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  ← ' + (x || '')));
const $ = id => doc.getElementById(id);

setTimeout(() => {
  win.orders = [{ orderNum: '2601', customerName: 'A', customerContact: '', customerEmail: '', date: '2026-09-01',
    dueDate: '2026-11-15', fittingDate: '', fitted: 0, fittedDates: {}, remarks: '', archived: false,
    items: [{ product: 'Jacket', fabric: 'X', lining: '', status: '', paid: false, stuck: false }] }];
  win.archivedOrders = [];
  win.orderPdfs = { '2601': { name: '2601 — form.pdf', url: 'https://drive.google.com/file/d/FILEID/view', id: 'FILEID', size: 1000, uploaded: '2026-09-10' } };
  win.renderOrders();

  /* the card */
  const card = $('orders-content').innerHTML;
  t('card offers Replace', /pickOrderPdf\('2601'\)/.test(card) && /Replace the PDF/.test(card));
  t('card offers Remove', /confirmRemovePdf\('2601'\)/.test(card));
  t('card opens the viewer', /openOrderPdf\('2601'\)/.test(card));

  /* the markup exists and starts closed */
  t('viewer starts closed', !$('pdf-over').classList.contains('open'));
  t('viewer sits under modals', true);

  /* opening */
  win.openOrderPdf('2601');
  t('viewer opens', $('pdf-over').classList.contains('open'));
  t('frame points at the Drive preview, not /view',
    $('pdf-frame').getAttribute('src') === 'https://drive.google.com/file/d/FILEID/preview',
    $('pdf-frame').getAttribute('src'));
  t('title line names the order and the file', $('pdf-sub').textContent === 'Order 2601 · 2601 — form.pdf', $('pdf-sub').textContent);
  t('page behind is locked from scrolling', doc.body.style.overflow === 'hidden');
  t('fallback is hidden to start', !$('pdf-fallback').classList.contains('show'));

  /* preview url derived from the link when no id was kept */
  t('preview url derived from a /view link',
    win.drivePreviewUrl({url: 'https://drive.google.com/file/d/ZZ/view'}) === 'https://drive.google.com/file/d/ZZ/preview');
  t('preview url survives a query string',
    win.drivePreviewUrl({url: 'https://drive.google.com/file/d/ZZ/view?usp=sharing'}) === 'https://drive.google.com/file/d/ZZ/preview');

  /* remove, from inside the viewer */
  win.removeViewedPdf();
  t('Remove asks first', $('confirm-modal').classList.contains('open'));
  t('the question names the file', /form\.pdf/.test($('confirm-msg').innerHTML));
  t('the question names the order', /2601/.test($('confirm-msg').innerHTML));
  t('the confirm button is the dangerous one', $('confirm-go').className.indexOf('btn-danger') > -1);

  /* say yes */
  $('confirm-go').onclick();
  t('viewer closes when its file is removed', !$('pdf-over').classList.contains('open'));
  t('frame is emptied on close', !$('pdf-frame').getAttribute('src'));
  t('scrolling is given back', doc.body.style.overflow === '');
  t('the attachment is gone', !win.hasPdf('2601'));

  win.renderOrders();
  t('card falls back to Attach PDF', /Attach PDF/.test($('orders-content').innerHTML));

  /* Esc closes it too */
  win.orderPdfs = { '2601': { name: 'again.pdf', url: 'https://drive.google.com/file/d/F2/view', id: 'F2' } };
  win.openOrderPdf('2601');
  t('viewer reopens', $('pdf-over').classList.contains('open'));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  t('Escape closes the viewer', !$('pdf-over').classList.contains('open'));

  /* Esc must still close a modal when the viewer is shut */
  $('edit-modal').classList.add('open');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  t('Escape still closes an ordinary modal', !$('edit-modal').classList.contains('open'));

  /* a replace from the viewer targets the order on screen */
  win.openOrderPdf('2601');
  let picked = '';
  const realPick = win.pickOrderPdf;
  win.pickOrderPdf = n => { picked = n; };
  win.replaceViewedPdf();
  t('Replace targets the order on screen', picked === '2601', picked);
  win.pickOrderPdf = realPick;
  win.closePdfViewer();
  t('nothing is being viewed once closed', win.pdfViewing === '');

  ok.forEach(n => console.log('  ok    ' + n));
  fails.forEach(n => console.log('  FAIL  ' + n));
  console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
}, 1500);
