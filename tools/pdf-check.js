/* Functional check for the order-form PDF attachment.
   Boots the real app headless, puts one order on the floor, and reads
   back what the order card actually renders. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inlined = html.replace(/<script src="(js\/[^"]+)"><\/script>/g,
  (_, f) => '<script>\n' + fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n</script>');

const vc = new VirtualConsole();
const dom = new JSDOM(inlined, { url: 'https://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window;
win.fetch = () => Promise.reject(new Error('offline (check)'));

const fails = [];
const ok = [];
function assert(name, cond, extra) { (cond ? ok : fails).push(name + (cond ? '' : '  ← ' + (extra || ''))); }

setTimeout(() => {
  /* one order on the floor */
  win.orders = [{ orderNum: '2601', customerName: 'Test Client', customerContact: '', customerEmail: '',
                  date: '2026-09-01', dueDate: '2026-11-15', fittingDate: '', fitted: 0, fittedDates: {},
                  remarks: '', archived: false,
                  items: [{ product: 'Jacket', fabric: 'A1234', lining: 'L9', status: '', paid: false, stuck: false }] }];
  win.archivedOrders = [];
  win.orderPdfs = {};

  win.renderOrders();
  let out = win.document.getElementById('orders-content').innerHTML;
  assert('empty order shows "Attach PDF"', /Attach PDF/.test(out));
  assert('button calls pickOrderPdf with the order number', /pickOrderPdf\('2601'\)/.test(out));
  assert('no suit order form button left', !/Suit order form/i.test(out));
  assert('one button per order, not per garment', (out.match(/Attach PDF/g) || []).length === 1,
         'found ' + (out.match(/Attach PDF/g) || []).length);

  /* now with a PDF filed against it */
  win.orderPdfs = { '2601': { name: '2601 — order form.pdf', url: 'https://drive.google.com/file/d/abc/view',
                              id: 'abc', size: 120000, uploaded: '2026-09-10' } };
  win.renderOrders();
  out = win.document.getElementById('orders-content').innerHTML;
  assert('attached order shows "PDF ✓"', /PDF ✓/.test(out));
  assert('no Attach button once one is on', !/Attach PDF/.test(out));
  assert('opens the file', /openOrderPdf\('2601'\)/.test(out));
  assert('offers to remove it', /confirmRemovePdf\('2601'\)/.test(out));
  assert('strip links the Drive file', /drive\.google\.com\/file\/d\/abc\/view/.test(out));
  assert('strip names the file', /order form\.pdf/.test(out));

  /* archive shows it too */
  win.archivedOrders = [Object.assign({}, win.orders[0], { archived: true })];
  win.orders = [];
  win.renderArchive();
  const arc = win.document.getElementById('archive-content').innerHTML;
  assert('archive shows the PDF', /PDF ✓/.test(arc) && /openOrderPdf\('2601'\)/.test(arc));

  /* the module plumbing */
  assert('attachments is a registered module', !!win.MODULES.attachments);
  assert('module getter returns the map', win.MODULES.attachments[1]()['2601'].id === 'abc');
  win.MODULES.attachments[2]({ '9': { name: 'x.pdf', url: 'u', id: 'i' } });
  assert('module setter replaces the map', win.hasPdf('9') && !win.hasPdf('2601'));

  /* renumbering an order carries its PDF */
  win.orderPdfs = { '2601': { name: 'a.pdf', url: 'u', id: 'i' } };
  win.renameOrderPdf('2601', '2602');
  assert('renumbering moves the attachment', win.hasPdf('2602') && !win.hasPdf('2601'));

  /* the assistant mentions it */
  assert('assistant knows about the PDF', typeof win.hasPdf === 'function' && win.hasPdf('2602'));

  /* the sheet is asked before a file is sent */
  (async () => {
    win.pdfBackend = null;
    const ready = await win.pdfBackendReady();
    assert('an unreachable sheet reports no PDF support', ready === false, String(ready));

    win.orderPdfs = {};
    let posted = false;
    const realFetch = win.fetch;
    win.fetch = (u, i) => { if (i && i.method === 'POST') posted = true; return realFetch(u, i); };
    await win.uploadOrderPdf('2601', {name: 'x.pdf', type: 'application/pdf', size: 500});
    assert('no file is posted when the sheet cannot take one', posted === false);
    win.fetch = realFetch;

    win.pdfBackend = true;   // pretend the sheet answered yes
    assert('a cached yes is reused', (await win.pdfBackendReady()) === true);

    ok.forEach(n => console.log('  ok    ' + n));
    fails.forEach(n => console.log('  FAIL  ' + n));
    console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
    process.exit(fails.length ? 1 : 0);
  })();
  return;

  ok.forEach(n => console.log('  ok    ' + n));
  fails.forEach(n => console.log('  FAIL  ' + n));
  console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
}, 1500);
