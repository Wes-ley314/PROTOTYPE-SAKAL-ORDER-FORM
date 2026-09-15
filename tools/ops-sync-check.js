/*
 * The Operation page, shared between devices.
 * Boots the real app twice (two "phones") against the Apps Script backend
 * running on the fake sheet, and checks they stay in step.
 *   node tools/ops-sync-check.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('./gas-harness.js');                       // fake Sheet/Drive globals

const ROOT = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'SAKAL-BACKEND-V10.gs'), 'utf8')
  .replace(/^const SHEET_ID.*$/m, "const SHEET_ID = 'SHEET_ID';")
  .replace('const AUTH_ENFORCE = true;', 'const AUTH_ENFORCE = false;');
const B = eval(GS + ';({doGet, doPost, readOperationDoc_})');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inlined = html.replace(/<script src="(js\/[^"]+)"><\/script>/g,
  (_, f) => '<script>\n' + fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n</script>');

const fails = [], ok = [];
const t = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  ← ' + (x || '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

let backend = 'v10';
const posts = [];

function device(name) {
  const dom = new JSDOM(inlined, { url: 'https://' + name + '.local/', runScripts: 'dangerously',
                                   pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.__offline = false;
  w.fetch = async (url, init) => {
    if (w.__offline) throw new Error('offline (check)');
    const u = new URL(url);
    let out;
    if (init && String(init.method).toUpperCase() === 'POST') {
      const body = JSON.parse(init.body);
      posts.push({ from: name, backend, action: body.action });
      if (backend === 'v9' && body.action === 'SYNC_OPERATION') out = '{"status":"success"}';   // a V9 would save it as an order
      else out = B.doPost({ postData: { contents: init.body } }).getContent();
    } else {
      const p = Object.fromEntries(u.searchParams.entries());
      if (backend === 'v9' && p.operation) out = JSON.stringify({ status: 'success', data: [] });
      else out = B.doGet({ parameter: p }).getContent();
    }
    return { ok: true, text: async () => out };
  };
  return w;
}
const motos = w => w.vehicles.map(v => v.owner + ':' + v.plate + ':' + v.taxMonth + ':' + v.plateYear).sort().join(' | ');
const find = (w, owner) => w.vehicles.find(v => v.owner === owner);
const sheetDoc = () => B.readOperationDoc_();

(async () => {
  const A = device('a'), Bd = device('b');
  await wait(600);
  await A.OpsSync.pull(true); await wait(50);
  await Bd.OpsSync.pull(true); await wait(50);

  /* ── starting point ── */
  t('both phones show Lia and Ares', motos(A) === 'Ares::7:2028 | Lia::7:2030' && motos(Bd) === motos(A), motos(A) + ' / ' + motos(Bd));
  let d = sheetDoc();
  t('sheet holds one JSON-LD document', d['@context'] && d['@context']['@vocab'] === 'https://schema.org/' && Array.isArray(d['@graph']));
  t('sheet has 4 cards + 2 motorcycles', d['@graph'].filter(n => !n.deleted).length === 6, d['@graph'].length);
  const lia = d['@graph'].find(n => n['@id'] === 'urn:sakal:motorcycle:moto-lia');
  t('Lia is a MotorcycleTax node', lia && lia['@type'] === 'MotorcycleTax' && lia.taxMonth === 7 && lia.plateYear === 2030, JSON.stringify(lia));
  t('records carry version + server stamp', lia && lia.version === 1 && /T/.test(lia.dateModified));
  await wait(400);   // let the boot-time save settle
  t('nothing left waiting on either phone', !A.OpsSync.hasPending() && !Bd.OpsSync.hasPending());

  /* ── the page draws them ── */
  A.go('ops');
  let out = A.document.getElementById('ops-moto').innerHTML;
  t('section drawn under the cards', /Motorcycle tax/.test(out));
  t('row reads Punya Lia · Pajak 07 · Plat 2030', /Punya Lia/.test(out) && /Pajak 07/.test(out) && /Plat 2030/.test(out));
  t('row reads Punya Ares · Plat 2028', /Punya Ares/.test(out) && /Plat 2028/.test(out));
  t('the sync line says shared', /Shared with every device/.test(A.document.getElementById('ops-sync-note').textContent),
    A.document.getElementById('ops-sync-note').textContent);
  A.setOpsFilter('Motorcycle');
  t('Motorcycle filter hides the cards', A.document.getElementById('ops-content').innerHTML === '' && /Punya Lia/.test(A.document.getElementById('ops-moto').innerHTML));
  A.setOpsFilter('SIM Card');
  t('card filter hides the motorcycles', A.document.getElementById('ops-moto').innerHTML === '');
  A.setOpsFilter('all');
  A.document.getElementById('ops-search').value = 'ares'; A.renderOps();
  out = A.document.getElementById('ops-moto').innerHTML;
  t('search finds by owner', /Punya Ares/.test(out) && !/Punya Lia/.test(out));
  A.document.getElementById('ops-search').value = ''; A.renderOps();

  /* ── status maths (today is pinned per case) ── */
  const RealDate = A.Date;
  const at = (ymd, fn) => { A.todayYMD = () => ymd; try { return fn(); } finally { A.todayYMD = () => new RealDate().toISOString().slice(0, 10); } };
  t('Sep 2026, pajak Jul → next Jul 2027', at('2026-09-15', () => A.motoTax({ taxMonth: 7 }).label) === 'Next Jul 2027');
  t('Jun 2026, pajak Jul → due soon', at('2026-06-10', () => A.motoTax({ taxMonth: 7 }).state) === 'soon');
  t('Sep 2026, paid 2025 → overdue', at('2026-09-15', () => A.motoTax({ taxMonth: 7, taxPaidYear: 2025 }).state) === 'late');
  t('Sep 2026, paid 2026 → next Jul 2027', at('2026-09-15', () => A.motoTax({ taxMonth: 7, taxPaidYear: 2026 }).label) === 'Next Jul 2027');
  t('plat 2030 is fine', at('2026-09-15', () => A.motoPlate({ taxMonth: 7, plateYear: 2030 }).state) === 'ok');
  t('plat 2026 (Jul) has expired', at('2026-09-15', () => A.motoPlate({ taxMonth: 7, plateYear: 2026 }).state) === 'late');
  t('plat 2028 flagged in May 2028', at('2028-05-01', () => A.motoPlate({ taxMonth: 7, plateYear: 2028 }).state) === 'soon');

  /* ── the modal ── */
  A.openMotoModal();
  A.saveMoto();
  t('empty owner is refused', A.document.getElementById('moto-owner-err').classList.contains('show') && A.vehicles.length === 2);
  A.document.getElementById('moto-owner').value = 'Budi';
  A.document.getElementById('moto-taxmonth').value = '3';
  A.document.getElementById('moto-plateyear').value = '20';
  A.saveMoto();
  t('a bad year is refused', A.document.getElementById('moto-plateyear-err').classList.contains('show') && A.vehicles.length === 2);
  A.document.getElementById('moto-plateyear').value = '2029';
  A.document.getElementById('moto-plate').value = 'bp 4411 ab';
  A.saveMoto();
  t('Budi added on A', !!find(A, 'Budi') && find(A, 'Budi').plate === 'BP 4411 AB' && find(A, 'Budi').taxMonth === 3);
  t('A has one change waiting', Object.keys(A.OpsSync._state().pending).length === 1);
  await A.OpsSync.push();
  await Bd.OpsSync.pull();
  t('B sees Budi after a pull', !!find(Bd, 'Budi') && find(Bd, 'Budi').plateYear === 2029, motos(Bd));

  /* ── two phones, two different records, at once ── */
  A.openMotoModal(find(A, 'Lia').id); A.document.getElementById('moto-plate').value = 'BP 1000 LA'; A.saveMoto();
  Bd.openMotoModal(find(Bd, 'Ares').id); Bd.document.getElementById('moto-note').value = 'Honda Beat'; Bd.saveMoto();
  await Promise.all([A.OpsSync.push(), Bd.OpsSync.push()]);
  await A.OpsSync.pull(); await Bd.OpsSync.pull();
  t('both edits kept on A', find(A, 'Lia').plate === 'BP 1000 LA' && find(A, 'Ares').note === 'Honda Beat', motos(A));
  t('both edits kept on B', find(Bd, 'Lia').plate === 'BP 1000 LA' && find(Bd, 'Ares').note === 'Honda Beat', motos(Bd));

  /* ── two phones, the same record ── */
  A.openMotoModal(find(A, 'Lia').id); A.document.getElementById('moto-plateyear').value = '2031'; A.saveMoto();
  Bd.openMotoModal(find(Bd, 'Lia').id); Bd.document.getElementById('moto-plateyear').value = '2032'; Bd.saveMoto();
  await A.OpsSync.push();
  let toast = '';
  const realToast = Bd.showToast; Bd.showToast = m => { toast = m; realToast(m); };
  await Bd.OpsSync.push();
  t('first save wins on the sheet', sheetDoc()['@graph'].find(n => n['@id'] === 'urn:sakal:motorcycle:moto-lia').plateYear === 2031);
  t('the second phone shows the winner', find(Bd, 'Lia').plateYear === 2031, find(Bd, 'Lia').plateYear);
  t('…and says so', /another device/.test(toast), toast);
  t('no change left stuck on B', Object.keys(Bd.OpsSync._state().pending).length === 0);

  /* ── a delete travels ── */
  Bd.openMotoModal(find(Bd, 'Budi').id); Bd.deleteMoto();
  await Bd.OpsSync.push();
  await A.OpsSync.pull();
  t('Budi gone from A', !find(A, 'Budi'), motos(A));
  t('sheet keeps a tombstone', sheetDoc()['@graph'].some(n => n['@id'].indexOf('motorcycle:') > 0 && n.deleted === true));
  const tab = global.__book.sheets['Operation'];
  const tabText = JSON.stringify(tab && tab.cells);
  t('readable Operation tab written', tab && /Motorcycle tax/.test(tabText) && /07 \(Jul\)/.test(tabText) && !/Budi/.test(tabText));

  /* ── cards sync the same way ── */
  const sim = A.opitems.find(o => o.type === 'SIM Card');
  A.openOpsModal(sim.id); A.document.getElementById('op-number').value = '+65 8123 4567'; A.saveOpItem();
  await A.OpsSync.push(); await Bd.OpsSync.pull();
  t('a SIM edit reaches B', Bd.opitems.find(o => o.id === sim.id).number === '+65 8123 4567');

  /* ── offline, then back ── */
  A.__offline = true;
  A.openMotoModal(); A.document.getElementById('moto-owner').value = 'Rina';
  A.document.getElementById('moto-taxmonth').value = '11'; A.document.getElementById('moto-plateyear').value = '2027'; A.saveMoto();
  await A.OpsSync.push();
  t('offline: kept on A, still waiting', !!find(A, 'Rina') && A.OpsSync.hasPending());
  t('offline: the page says so', /No connection/.test(A.document.getElementById('ops-sync-note').textContent));
  await A.OpsSync.pull();   // still offline
  t('offline: a failed pull does not lose it', !!find(A, 'Rina'));
  A.__offline = false;
  await A.OpsSync.push(); await Bd.OpsSync.pull();
  t('back online: Rina reaches B', !!find(Bd, 'Rina'), motos(Bd));

  /* ── a brand-new phone joins ── */
  const C = device('c');
  await wait(600); await C.OpsSync.pull(true); await wait(50);
  t('a new phone gets the shared list, not its seeds', motos(C) === motos(A) && !find(C, 'Budi'), motos(C) + ' vs ' + motos(A));

  /* ── an older phone's cards (the old whole-list copy) are not stranded ── */
  B.doPost({ postData: { contents: JSON.stringify({ action: 'SAVE_MODULE', module: 'ops',
    payload: [{ id: 'legacy1', type: 'NETS Card', number: '9999', provider: '', holder: 'Office', expiry: '', amount: 5, topup: '2026-09-01', note: 'from V9' }] }) } });
  const D = device('d');
  await wait(600); await D.OpsSync.push();
  await A.OpsSync.pull();
  t('legacy card uploaded once', A.opitems.some(o => o.id === 'legacy1' && o.number === '9999'));

  /* ── the sheet still on V9: never POST ── */
  backend = 'v9';
  const E = device('e');
  await wait(100); await E.OpsSync.pull(true);
  E.openMotoModal(); E.document.getElementById('moto-owner').value = 'Tono';
  E.document.getElementById('moto-taxmonth').value = '1'; E.document.getElementById('moto-plateyear').value = '2030'; E.saveMoto();
  await E.OpsSync.push();
  t('V9 sheet: no SYNC_OPERATION posted', !posts.some(p => p.backend === 'v9' && p.action === 'SYNC_OPERATION'),
    JSON.stringify(posts.filter(p => p.backend === 'v9')));
  t('V9 sheet: kept on the device and says why', !!find(E, 'Tono') && /V10/.test(E.document.getElementById('ops-sync-note').textContent),
    E.document.getElementById('ops-sync-note').textContent);
  backend = 'v10';

  /* ── the whole-list path never touches operation ── */
  t('ops no longer in the whole-list MODULES', !A.MODULES.ops);
  t('JSON-LD export', A.OpsSync.toJsonLd()['@graph'].length === A.opitems.length + A.vehicles.length);

  ok.forEach(n => console.log('  ok    ' + n));
  fails.forEach(n => console.log('  FAIL  ' + n));
  console.log('\n' + ok.length + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
