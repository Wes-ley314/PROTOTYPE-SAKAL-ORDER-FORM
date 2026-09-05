/*
 * Equivalence harness — proves a converted screen behaves like the one it
 * replaced.
 *
 *   node tools/compare.js            all converted screens
 *   node tools/compare.js leads      just one
 *
 * For each screen it boots the app twice — once with the pre-refactor file
 * from tools/reference/, once with the CrudScreen version — drives both
 * through the same list of actions, and diffs the page and the data after
 * every step.
 *
 * Toast wording is checked separately, because the rewrite deliberately
 * corrects a bug the original screens all shared: the "am I editing?" flag
 * was read for the message AFTER the close function had already cleared it,
 * so editing an existing record always said "added".
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function boot(swapFrom, swapTo) {
  const inlined = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => {
    const file = f === swapFrom ? swapTo : f;
    return '<script>\n' + fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n</script>';
  });
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = new JSDOM(inlined, {
    url: 'https://localhost/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  dom.window.fetch = () => Promise.reject(new Error('offline'));
  return dom.window;
}

const set = (w, id, v) => { const e = w.document.getElementById(id); if (e) e.value = v; };

/* ── what each screen is, and how to exercise it ────────────────────── */

const SCREENS = {
  stock: {
    file: 'js/06-stock.js',
    collection: 'stock',
    watch: ['stock-content', 'stock-stats'],
    form: ['sk-item', 'sk-cat', 'sk-loc', 'sk-brand', 'sk-color', 'sk-price', 'sk-purchased', 'sk-supplier', 'sk-remark'],
    marks: ['sk-reorder', 'sk-delete', 'stock-modal', 'stock-modal-title'],
    buttons: ['[data-stockcat]', '[data-stockloc]'],
    persist: 'persistStock',
    seed: [
      { id: 's1', item: 'Horn button 20L', cat: 'Buttons', loc: 'Batam', brand: 'Amann', color: 'Dark brown', price: '0.80', purchased: '2026-06-02', supplier: 'https://amann.com/shop', remark: 'matt', reorder: false },
      { id: 's2', item: 'Bemberg lining', cat: 'Lining', loc: 'Singapore', brand: 'Asahi', color: 'Navy', price: '9.50', purchased: '2026-05-11', supplier: 'Textile House', remark: '', reorder: true },
      { id: 's3', item: 'Suit hanger', cat: 'Packaging', loc: 'Batam', brand: '', color: 'Black', price: '1.20', purchased: '', supplier: '', remark: 'wooden', reorder: false },
      { id: 's4', item: 'Canvas hair cloth', cat: 'Others', loc: 'Batam', brand: 'Hymo', color: 'Natural', price: '14.00', purchased: '2026-04-20', supplier: '', remark: '', reorder: true },
    ],
    steps: [
      ['render', w => w.renderStock()],
      ['filter Lining', w => w.setStockCat('Lining')],
      ['filter all', w => w.setStockCat('all')],
      ['loc Batam', w => w.setStockLoc('Batam')],
      ['loc all', w => w.setStockLoc('all')],
      ['reorder filter on', w => w.toggleStockReorderFilter()],
      ['reorder filter off', w => w.toggleStockReorderFilter()],
      ['search button', w => { set(w, 'stock-search', 'button'); w.renderStock(); }],
      ['search miss', w => { set(w, 'stock-search', 'zzz'); w.renderStock(); }],
      ['clear search', w => { set(w, 'stock-search', ''); w.renderStock(); }],
      ['toggle reorder s1', w => w.toggleStockReorder('s1')],
      ['open s2', w => w.openStockModal('s2')],
      ['edit + save', w => { set(w, 'sk-color', 'Midnight'); w.saveStockForm(); }],
      ['open blank', w => { w.setStockCat('Lining'); w.openStockModal(); }],
      ['add new', w => { set(w, 'sk-item', 'Silk thread'); w.toggleSkReorder(); w.saveStockForm(); }],
      ['reject empty', w => { w.setStockCat('all'); w.openStockModal(); w.saveStockForm(); }],
      ['delete s3', w => { w.closeStockModal(); w.openStockModal('s3'); w.deleteStockRow(); }],
    ],
  },

  leads: {
    file: 'js/07-leads.js',
    collection: 'leads',
    watch: ['leads-content', 'leads-stats'],
    form: ['ld-name', 'ld-date', 'ld-phone', 'ld-email', 'ld-source', 'ld-consult', 'ld-purchdate', 'ld-follow', 'ld-remarks'],
    marks: ['ld-booked', 'ld-attended', 'ld-purchased', 'ld-delete', 'lead-modal', 'lead-modal-title'],
    buttons: ['[data-leadfilter]'],
    persist: 'persistLeads',
    seed: [
      { id: 'l1', date: '2026-07-30', name: 'Teo I-Jen', phone: '9111 2222', email: 't@x.com', source: 'Website', booked: 'Yes', attended: 'Yes', purchased: 'Yes', consultDate: '2026-08-02', purchaseDate: '2026-08-05', followUp: '', remarks: 'navy 3pc' },
      { id: 'l2', date: '2026-08-11', name: 'Marcus Lim', phone: '9333 4444', email: '', source: 'Instagram', booked: 'Yes', attended: 'No', purchased: 'No', consultDate: '2026-08-20', purchaseDate: '', followUp: '2026-08-25', remarks: '' },
      { id: 'l3', date: '2026-08-20', name: 'Priya Nair', phone: '', email: 'p@y.com', source: 'Walk-in', booked: 'No', attended: 'No', purchased: 'No', consultDate: '', purchaseDate: '', followUp: '2026-01-01', remarks: 'wedding' },
    ],
    steps: [
      ['render', w => w.renderLeads()],
      ['filter new', w => w.setLeadFilter('new')],
      ['filter booked', w => w.setLeadFilter('booked')],
      ['filter attended', w => w.setLeadFilter('attended')],
      ['filter won', w => w.setLeadFilter('won')],
      ['filter followup', w => w.setLeadFilter('followup')],
      ['filter all', w => w.setLeadFilter('all')],
      ['search marcus', w => { set(w, 'leads-search', 'marcus'); w.renderLeads(); }],
      ['search instagram', w => { set(w, 'leads-search', 'instagram'); w.renderLeads(); }],
      ['clear search', w => { set(w, 'leads-search', ''); w.renderLeads(); }],
      ['cycle booked l3', w => w.cycleLead('l3', 'booked')],
      ['cycle attended l3', w => w.cycleLead('l3', 'attended')],
      ['cycle purchased l3', w => w.cycleLead('l3', 'purchased')],
      ['cycle purchased off', w => w.cycleLead('l3', 'purchased')],
      ['open l2', w => w.openLeadModal('l2')],
      ['edit + save', w => { set(w, 'ld-phone', '9000 0000'); w.toggleLd('attended'); w.saveLeadForm(); }],
      ['open blank', w => w.openLeadModal()],
      ['add new', w => { set(w, 'ld-name', 'Chen Wei'); set(w, 'ld-phone', '8123'); w.saveLeadForm(); }],
      ['reject empty', w => { w.openLeadModal(); w.saveLeadForm(); }],
      ['delete l1', w => { w.closeLeadModal(); w.openLeadModal('l1'); w.deleteLead(); }],
    ],
  },
  customers: {
    file: 'js/08-customers.js',
    collection: 'customers',
    watch: ['cust-content', 'cust-stats'],
    form: ['cs-name', 'cs-phone', 'cs-email', 'cs-note'],
    marks: ['cs-delete', 'cust-modal', 'cust-modal-title', 'cs-name-err'],
    buttons: ['[data-custfilter]'],
    persist: 'persistCustomers',
    seed: [
      { id: 'c1', name: 'Teo I-Jen', phone: '9111 2222', email: 't@x.com', note: 'prefers navy' },
      { id: 'c2', name: 'Marcus Lim', phone: '9333 4444', email: '', note: '' },
      { id: 'c3', name: 'Priya Nair', phone: '', email: 'p@y.com', note: 'wedding party' },
    ],
    steps: [
      ['render', w => w.renderCustomers()],
      ['filter repeat', w => w.setCustFilter('repeat')],
      ['filter nocontact', w => w.setCustFilter('nocontact')],
      ['filter all', w => w.setCustFilter('all')],
      ['search marcus', w => { set(w, 'cust-search', 'marcus'); w.renderCustomers(); }],
      ['search email', w => { set(w, 'cust-search', 'p@y'); w.renderCustomers(); }],
      ['search miss', w => { set(w, 'cust-search', 'zzz'); w.renderCustomers(); }],
      ['clear search', w => { set(w, 'cust-search', ''); w.renderCustomers(); }],
      ['open c2', w => w.openCustModal('c2')],
      ['edit + save', w => { set(w, 'cs-email', 'm@lim.com'); w.saveCustomer(); }],
      ['open blank', w => w.openCustModal()],
      ['add new', w => { set(w, 'cs-name', 'Chen Wei'); set(w, 'cs-phone', '8123'); w.saveCustomer(); }],
      ['reject empty', w => { w.openCustModal(); w.saveCustomer(); }],
      ['reject duplicate name', w => { set(w, 'cs-name', 'teo  i-jen'); w.saveCustomer(); }],
      ['rename to own name is fine', w => { w.closeCustModal(); w.openCustModal('c1'); w.saveCustomer(); }],
      ['delete c3', w => { w.openCustModal('c3'); w.deleteCustomer(); }],
    ],
  },
  ops: {
    file: 'js/09-ops.js',
    collection: 'opitems',
    watch: ['ops-content', 'ops-stats'],
    form: ['op-type', 'op-number', 'op-provider', 'op-holder', 'op-expiry', 'op-amount', 'op-topup', 'op-note'],
    marks: ['op-delete', 'ops-modal', 'ops-modal-title', 'op-sim-block', 'op-card-block', 'op-number-err'],
    buttons: ['[data-opsfilter]'],
    persist: 'persistOps',
    seed: [
      { id: 'o1', type: 'SIM Card', number: '8123 4567', provider: 'Singtel', holder: 'Office', expiry: '2026-09-20', amount: '', topup: '', note: 'shop line' },
      { id: 'o2', type: 'SIM Card', number: '9234 5678', provider: 'M1', holder: 'Benjamin', expiry: '2027-06-01', amount: '', topup: '', note: '' },
      { id: 'o3', type: 'Ez-Link Card', number: '1000 2000', provider: 'TransitLink', holder: 'Wesley', expiry: '', amount: 24.5, topup: '2026-02-01', note: 'Batam runs' },
      { id: 'o4', type: 'NETS Card', number: '3000 4000', provider: '', holder: 'Lina', expiry: '', amount: '', topup: '2026-08-20', note: '' },
    ],
    steps: [
      ['render', w => w.renderOps()],
      ['filter SIM', w => w.setOpsFilter('SIM Card')],
      ['filter Ez-Link', w => w.setOpsFilter('Ez-Link Card')],
      ['filter NETS', w => w.setOpsFilter('NETS Card')],
      ['filter all', w => w.setOpsFilter('all')],
      ['search singtel', w => { set(w, 'ops-search', 'singtel'); w.renderOps(); }],
      ['search holder', w => { set(w, 'ops-search', 'wesley'); w.renderOps(); }],
      ['search miss', w => { set(w, 'ops-search', 'zzz'); w.renderOps(); }],
      ['clear search', w => { set(w, 'ops-search', ''); w.renderOps(); }],
      ['open sim o1', w => w.openOpsModal('o1')],
      ['edit sim + save', w => { set(w, 'op-provider', 'Starhub'); w.saveOpItem(); }],
      ['open card o3', w => w.openOpsModal('o3')],
      ['switch type to SIM', w => { set(w, 'op-type', 'SIM Card'); w.onOpTypeChange(); }],
      ['switch back to card', w => { set(w, 'op-type', 'Ez-Link Card'); w.onOpTypeChange(); }],
      ['edit card + save', w => { set(w, 'op-amount', '40'); w.saveOpItem(); }],
      ['open blank under filter', w => { w.setOpsFilter('NETS Card'); w.openOpsModal(); }],
      ['add new', w => { set(w, 'op-number', '5555 6666'); w.saveOpItem(); }],
      ['reject empty', w => { w.setOpsFilter('all'); w.openOpsModal(); w.saveOpItem(); }],
      ['delete o4', w => { w.closeOpsModal(); w.openOpsModal('o4'); w.deleteOpItem(); }],
    ],
  },
  pricelist: {
    file: 'js/05-pricelist.js',
    collection: 'pricelist',
    watch: ['price-content', 'price-stats', 'price-tabs', 'brand-options', 'type-options'],
    form: ['pl-cat', 'pl-brand', 'pl-name', 'pl-type', 'pl-tier', 'pl-perm',
           'pl-p2', 'pl-p3', 'pl-pj', 'pl-pv', 'pl-pt', 'pl-pshirt', 'pl-plj', 'pl-pljv', 'pl-pcon',
           'price-brand', 'price-tier'],
    marks: ['pl-stocked', 'pl-delete', 'price-modal', 'price-modal-title',
            'pl-suit-block', 'pl-shirt-block', 'pl-lining-block', 'pl-con-block', 'pl-brand-err'],
    buttons: [],
    persist: 'persistPriceList',
    seed: [
      { id: 'f1', cat: 'Suiting', brand: 'LORO PIANA', name: 'Four Seasons', type: 'Wool', tier: 'YELLOW', tierName: 'PREMIUM', p2: 899, p3: 1099, pJ: 699, pV: 249, pT: 299, perM: 60, stocked: true },
      { id: 'f2', cat: 'Suiting', brand: 'DUGDALE', name: 'Royal Classic', type: 'Wool', tier: 'GREEN', tierName: 'STANDARD', p2: 699, p3: 849, pJ: 549, pV: 199, pT: 249, perM: 40, stocked: false },
      { id: 'f3', cat: 'Shirting', brand: 'THOMAS MASON', name: 'Journey', type: 'Cotton', tier: '', tierName: '', pShirt: 189, stocked: true },
      { id: 'f4', cat: 'Lining', brand: 'BEMBERG', name: 'Cupro Navy', type: '', tier: '', tierName: '', pJ: 60, pJV: 85, stocked: true },
      { id: 'f5', cat: 'Construction', brand: 'SAKAL', name: 'Full canvas', type: '', tier: '', tierName: '', pCon: 200, stocked: true },
    ],
    steps: [
      ['render suiting', w => w.renderPriceList()],
      ['tab Shirting', w => w.setPriceTab('Shirting')],
      ['tab Lining', w => w.setPriceTab('Lining')],
      ['tab Construction', w => w.setPriceTab('Construction')],
      ['tab Tiers', w => w.setPriceTab('Tiers')],
      ['back to Suiting', w => w.setPriceTab('Suiting')],
      ['brand filter', w => { set(w, 'price-brand', 'DUGDALE'); w.renderPriceList(); }],
      ['brand filter off', w => { set(w, 'price-brand', ''); w.renderPriceList(); }],
      ['tier filter', w => { set(w, 'price-tier', 'YELLOW'); w.renderPriceList(); }],
      ['tier filter off', w => { set(w, 'price-tier', ''); w.renderPriceList(); }],
      ['search loro', w => { set(w, 'price-search', 'loro'); w.renderPriceList(); }],
      ['search miss', w => { set(w, 'price-search', 'zzz'); w.renderPriceList(); }],
      ['clear search', w => { set(w, 'price-search', ''); w.renderPriceList(); }],
      ['open f1', w => w.openPriceModal('f1')],
      ['apply tier prices', w => { set(w, 'pl-tier', 'GREEN'); w.applyTierPrices(); }],
      ['edit + save', w => w.savePriceForm()],
      ['open f3 shirting', w => w.openPriceModal('f3')],
      ['switch cat to Lining', w => { set(w, 'pl-cat', 'Lining'); w.onPlCatChange(); }],
      ['switch cat back', w => { set(w, 'pl-cat', 'Shirting'); w.onPlCatChange(); }],
      ['toggle stocked + save', w => { w.togglePlStocked(); w.savePriceForm(); }],
      ['open blank', w => { w.setPriceTab('Construction'); w.openPriceModal(); }],
      ['add new', w => { set(w, 'pl-brand', 'SAKAL'); set(w, 'pl-name', 'Pick stitch'); set(w, 'pl-pcon', '80'); w.savePriceForm(); }],
      ['reject empty', w => { w.openPriceModal(); w.savePriceForm(); }],
      ['delete f5', w => { w.closePriceModal(); w.openPriceModal('f5'); w.deletePriceRow(); }],
      ['final render', w => { w.setPriceTab('Suiting'); }],
    ],
  },
};

/* ── the runner ─────────────────────────────────────────────────────── */

function snapshot(w, cfg) {
  const d = w.document;
  const val = id => { const e = d.getElementById(id); return e ? e.value : null; };
  const mark = id => {
    const e = d.getElementById(id);
    return e ? e.className + '|' + (e.style ? e.style.display : '') + '|' + (e.textContent || '').slice(0, 80) : null;
  };
  return JSON.stringify({
    watch: cfg.watch.map(id => (d.getElementById(id) || {}).innerHTML || ''),
    form: cfg.form.map(val),
    marks: cfg.marks.map(mark),
    buttons: cfg.buttons.map(sel => [...d.querySelectorAll(sel)].map(b => b.className + '|' + b.textContent)),
    data: w[cfg.collection],
  }, null, 1);
}

function prime(w, cfg) {
  w[cfg.collection] = JSON.parse(JSON.stringify(cfg.seed));
  w[cfg.persist] = function () {};
  w.__toasts = [];
  w.showToast = function (m) { w.__toasts.push(m); };
  let n = 0;
  w.uid = function () { return 'FIXED' + (++n); };
}

const INTENDED = {
  'Stock item added': 'Stock item updated',
  'Lead added': 'Lead updated',
  'Customer added': 'Customer updated',
  'Card added': 'Card updated',
  'Fabric added': 'Fabric updated',
};

function runScreen(key) {
  return new Promise(resolve => {
    const cfg = SCREENS[key];
    const orig = 'tools/reference/' + path.basename(cfg.file) + '.orig';
    if (!fs.existsSync(path.join(ROOT, orig))) {
      console.log('  skip ' + key + ' — no reference copy at ' + orig);
      return resolve(true);
    }
    const a = boot(cfg.file, orig);
    const b = boot(cfg.file, cfg.file);

    setTimeout(() => {
      prime(a, cfg); prime(b, cfg);
      let failures = 0;

      for (const [label, act] of cfg.steps) {
        let ea = null, eb = null;
        try { act(a); } catch (e) { ea = e.message; }
        try { act(b); } catch (e) { eb = e.message; }
        if (ea || eb) {
          if (ea !== eb) { failures++; console.log('    DIFF  ' + label + ' — threw differently: ' + ea + ' / ' + eb); continue; }
        }
        const sa = snapshot(a, cfg), sb = snapshot(b, cfg);
        if (sa === sb) { console.log('    ok    ' + label); continue; }
        failures++;
        console.log('    DIFF  ' + label);
        const la = sa.split('\n'), lb = sb.split('\n');
        for (let i = 0; i < Math.max(la.length, lb.length); i++) {
          if (la[i] !== lb[i]) {
            console.log('          was : ' + String(la[i]).trim().slice(0, 140));
            console.log('          now : ' + String(lb[i]).trim().slice(0, 140));
            break;
          }
        }
      }

      let unexplained = 0;
      b.__toasts.forEach((msg, i) => {
        const was = a.__toasts[i];
        if (msg === was) return;
        if (INTENDED[was] === msg) {
          console.log('    fixed ' + '"' + was + '" -> "' + msg + '" (edit was mislabelled as add)');
        } else {
          unexplained++;
          console.log('    DIFF  toast "' + was + '" -> "' + msg + '"');
        }
      });

      const ok = !failures && !unexplained;
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + key + ' — ' + cfg.steps.length + ' steps, '
        + failures + ' differ, ' + unexplained + ' unexplained toast change(s)\n');
      resolve(ok);
    }, 1200);
  });
}

(async () => {
  const only = process.argv[2];
  const keys = only ? [only] : Object.keys(SCREENS);
  if (only && !SCREENS[only]) {
    console.log('unknown screen: ' + only + '. known: ' + Object.keys(SCREENS).join(', '));
    process.exit(1);
  }
  let allOk = true;
  for (const k of keys) {
    console.log(k);
    const ok = await runScreen(k);
    allOk = allOk && ok;
  }
  console.log(allOk ? 'ALL SCREENS EQUIVALENT' : 'SOME SCREENS DIFFER');
  process.exit(allOk ? 0 : 1);
})();
