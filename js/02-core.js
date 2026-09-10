/* ══════════════════════════════════════════════════════════════
   ŠAKAL Workshop
   Orders + Archive sync to the Apps Script sheet.
   Measurements, price list, stock, leads and invoices are stored on
   this device — see SYNC STUB below to push them to the same sheet.
   ══════════════════════════════════════════════════════════════ */

/* API_URL now lives in js/00-config.js, so login.html and the app
   read the same address. It loads before this file. */

/* ── Constants ── */
var PRODUCTS     = ['Jacket','Trousers','Shirt','Vest','Safari Jacket','Overcoat'];
var PRODUCT_IDS  = {'Jacket':'jacket','Trousers':'trousers','Shirt':'shirt','Vest':'vest','Safari Jacket':'safari','Overcoat':'overcoat'};
var NEEDS_LINING = ['Jacket','Vest','Overcoat'];
var STATUS_STATES_NO_DELTA = ['','Fabric Ordered','Bin','Batam','In-store','Take Home'];
var STATUS_STATES_NO_BATAM = ['','Fabric Ordered','Bin','Delta','In-store','Take Home'];
var NO_DELTA_PRODUCTS = ['Jacket','Overcoat','Vest'];
var NO_BATAM_PRODUCTS = ['Shirt','Trousers'];
var TL_LABELS = ['','Baste fitting','Fitting','Final / take home'];
var TL_SHORT  = ['','Baste','Fitting','Final'];

var PAGES = {
  invoice:   { eyebrow:'Floor',    title:'Invoices' },
  orders:    { eyebrow:'Floor',    title:'Orders' },
  delta:     { eyebrow:'Floor',    title:'Delta' },
  chat:      { eyebrow:'Floor',    title:'Assistant' },
  customers: { eyebrow:'Records',  title:'Customers' },
  price:     { eyebrow:'Records',  title:'Price list' },
  stock:     { eyebrow:'Records',  title:'Stock' },
  ops:       { eyebrow:'Records',  title:'Operation' },
  leads:     { eyebrow:'Business', title:'Leads' },
  archive:   { eyebrow:'Closed',   title:'Archive' }
};

/* ── State ── */
var orders = [], archivedOrders = [];
var stock = [], invoices = [], pricelist = [], leads = [], customers = [], opitems = [], deltaOrders = [];
/* order number → the one order-form PDF filed against it, as a Drive link */
var orderPdfs = {};
var currentSort = 'newest', currentArchiveSort = 'newest', currentPage = 'invoice';
var activeStatusFilter = null, activeStuckFilter = false, activeUnpaidFilter = false, activeProductFilters = {};
var filterOrderedFrom='', filterOrderedTo='', filterDueFrom='', filterDueTo='';
var editIdx = -1, delPendingType = '', delPendingOi = -1, delPendingIi = -1;
var tlPendingOi = -1, tlPendingNext = 0, tlEditingExisting = false;
var arcTlPendingIdx = -1, arcTlPendingNext = 0, arcTlEditingExisting = false;
var archivePendingIdx = -1, restorePendingIdx = -1;
var filtersOpen = false;

/* ── Small helpers ── */
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function $(id) { return document.getElementById(id); }
function money(n) { n = Number(n) || 0; return n.toLocaleString('en-SG', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function money0(n) { n = Number(n) || 0; return n.toLocaleString('en-SG', {maximumFractionDigits:0}); }
function todayYMD() { var t = new Date(); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
/* Long messages — a refusal from the sheet, say — need longer on screen than
   "Saved" does, and a tap to dismiss once they have been read. */
function showToast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  var ms = String(msg).length > 60 ? 9000 : 2600;
  t._h = setTimeout(function(){ t.classList.remove('show'); }, ms);
  t.style.pointerEvents = 'auto';
  t.onclick = function(){ clearTimeout(t._h); t.classList.remove('show'); };
}
function setSync(state, text) {
  ['sync-dot','sync-dot-2'].forEach(function(id){ var d = $(id); if (d) d.className = 'sync-dot' + (state ? ' ' + state : ''); });
  ['sync-text','sync-text-2'].forEach(function(id){ var s = $(id); if (s) s.textContent = text; });
}
function hit(v, term) { return String(v == null ? '' : v).toLowerCase().indexOf(term) !== -1; }
function findOrder(num) {
  return orders.find(function(o){ return o.orderNum === num; })
      || archivedOrders.find(function(o){ return o.orderNum === num; }) || null;
}

/* ── Dates ── */
function parseToYMD(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
  var m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[3] + '-' + m1[2].padStart(2,'0') + '-' + m1[1].padStart(2,'0');
  var months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  var m2 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m2) { var mo = months[m2[1].toLowerCase().substring(0,3)]; if (mo) return m2[3]+'-'+String(mo).padStart(2,'0')+'-'+m2[2].padStart(2,'0'); }
  var m3 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m3) { var mo2 = months[m3[2].toLowerCase().substring(0,3)]; if (mo2) return m3[3]+'-'+String(mo2).padStart(2,'0')+'-'+m3[1].padStart(2,'0'); }
  var m4 = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (m4) { var mo3 = months[m4[1].toLowerCase()]; if (mo3) return m4[3]+'-'+String(mo3).padStart(2,'0')+'-'+m4[2].padStart(2,'0'); }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  return '';
}
function formatDisplayDate(val) {
  if (!val) return '—';
  var ymd = parseToYMD(val); if (!ymd) return '—';
  var p = ymd.split('-');
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(p[2],10) + ' ' + M[parseInt(p[1],10)-1] + ' ' + p[0];
}
function shortDate(val) {
  var ymd = parseToYMD(val); if (!ymd) return '';
  var p = ymd.split('-');
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(p[2],10) + ' ' + M[parseInt(p[1],10)-1];
}
function isDueSoon(val) {
  if (!val) return false;
  var ymd = parseToYMD(val); if (!ymd) return false;
  var d = new Date(ymd), n = new Date(); n.setHours(0,0,0,0);
  var diff = (d - n) / 86400000; return diff >= 0 && diff <= 3;
}
function isOverdue(val) {
  if (!val) return false;
  var ymd = parseToYMD(val); if (!ymd) return false;
  return new Date(ymd) < new Date(todayYMD());
}

function normalizeOrder(o) {
  o.orderNum        = String(o.orderNum || '').trim();
  o.customerName    = typeof o.customerName === 'string' ? o.customerName : '';
  o.customerContact = typeof o.customerContact === 'string' ? o.customerContact : '';
  o.customerEmail   = typeof o.customerEmail === 'string' ? o.customerEmail : '';
  o.date            = parseToYMD(o.date);
  o.dueDate         = parseToYMD(o.dueDate);
  o.fittingDate     = parseToYMD(o.fittingDate);
  o.remarks         = typeof o.remarks === 'string' ? o.remarks : '';
  o.fitted          = parseInt(o.fitted, 10) || 0;
  o.fittedDates     = (o.fittedDates && typeof o.fittedDates === 'object') ? o.fittedDates : {};
  o.archived        = o.archived === true || o.archived === 'true';
  o.lastUpdated     = o.lastUpdated || '';
  o.baseVersion     = o.lastUpdated;
  return o;
}

/* ── Sync (orders + archive → Apps Script) ── */
var lastSyncTime = 0, syncTimers = {}, pendingWrites = 0;
function hasPendingSync() { return pendingWrites > 0 || Object.keys(syncTimers).length > 0 || hasPendingModuleSync(); }

function flushPendingSyncs() {
  Object.keys(syncTimers).forEach(function(key) {
    clearTimeout(syncTimers[key]); delete syncTimers[key];
    var latest = orders.find(function(o){ return o.orderNum === key; })
              || archivedOrders.find(function(o){ return o.orderNum === key; });
    if (latest) _doSync(Object.assign({}, latest, {baseVersion: latest.baseVersion || ''}), false);
  });
}

function syncToServer(orderData, isDelete) {
  if (!orderData || !orderData.orderNum) { console.warn('syncToServer: bad payload', orderData); return; }
  isDelete = isDelete || false;
  saveToLocalStorage();
  lastSyncTime = Date.now();
  if (isDelete) { _say('warn','Deleting…'); _doSync({action:'DELETE', orderNum: orderData.orderNum}, true); return; }
  var key = orderData.orderNum;
  _say('warn','Saving…');
  if (syncTimers[key]) clearTimeout(syncTimers[key]);
  syncTimers[key] = setTimeout(function() {
    delete syncTimers[key];
    var latest = orders.find(function(o){ return o.orderNum === key; })
              || archivedOrders.find(function(o){ return o.orderNum === key; });
    if (!latest) return;
    _doSync(Object.assign({}, latest, {baseVersion: latest.baseVersion || ''}), false);
  }, 1500);
}

var quietSync = false;
function _say(state, text, toast) {
  if (quietSync) return;
  setSync(state, text); if (toast) showToast(toast);
}

async function _doSync(payload, isDelete) {
  pendingWrites++;
  try {
    var r = await fetch(API_URL, {method:'POST', body:JSON.stringify(payload), headers:{'Content-Type':'text/plain;charset=utf-8'}, redirect:'follow'});
    var text = await r.text(); var result = {};
    try { result = JSON.parse(text); } catch(_) { result = {status: text.indexOf('success') !== -1 ? 'success' : 'error'}; }

    if (result.status === 'conflict') {
      _say('warn','Changed elsewhere — reloading','This order changed on another device. Reloading.');
      if (!quietSync) await fetchOrdersFromServer();
      return false;
    }
    if (result.status === 'success') {
      var t = orders.concat(archivedOrders).find(function(o){ return o.orderNum === payload.orderNum; });
      var dateChanged = false;
      if (t) {
        if (result.lastUpdated) { t.lastUpdated = result.lastUpdated; t.baseVersion = result.lastUpdated; }
        if (result.date && t.date !== result.date) { t.date = result.date; dateChanged = true; }
      }
      saveToLocalStorage();
      if (dateChanged) renderOrders();
      _say('', isDelete ? 'Deleted' : 'All changes saved', isDelete ? 'Deleted' : 'Saved');
      return true;
    } else {
      _say('bad','Not saved','Not saved. Hit refresh and try again.');
      return false;
    }
  } catch(err) {
    console.error('Sync error:', err);
    _say('bad','No connection — local only','No connection. The change is on this device only.');
    return false;
  } finally {
    pendingWrites = Math.max(0, pendingWrites - 1);
  }
}

async function fetchOrdersFromServer() {
  setSync('warn','Loading…');
  try {
    var r = await fetch(API_URL, {redirect:'follow'});
    var _t = await r.text(); var result = {};
    try { result = JSON.parse(_t); } catch(_) { result = {status: _t.indexOf('success') !== -1 ? 'success' : 'error'}; }
    if (result.status === 'success') {
      orders = []; archivedOrders = [];
      (result.data || []).forEach(function(o) {
        normalizeOrder(o);
        if (o.archived) archivedOrders.push(o); else orders.push(o);
      });
      renderAll();
      setSync('','All changes saved');
      showToast('Up to date');
      saveToLocalStorage();
    } else { throw new Error('API error'); }
  } catch(err) {
    console.error('Fetch error:', err);
    setSync('bad','Offline — showing cache');
    showToast('Could not reach the sheet. Showing the last cached copy.');
    loadFromLocalStorage();
  }
}

/* ── Local storage ──
   Every list is cached on the device so the shop keeps working with no
   signal, and pushed to the same Google Sheet the orders come from so
   nothing lives on one phone only. */
function loadFromLocalStorage() {
  try {
    var saved = localStorage.getItem('sakal-orders');
    if (saved) {
      var data = JSON.parse(saved);
      orders         = (data.orders   || []).map(normalizeOrder);
      archivedOrders = (data.archived || []).map(normalizeOrder);
    }
  } catch(e) { console.log('Cache read failed:', e); }
  renderAll();
}
function saveToLocalStorage() {
  try { localStorage.setItem('sakal-orders', JSON.stringify({orders:orders, archived:archivedOrders, lastSaved:new Date().toISOString()})); }
  catch(e) { console.log('Cache write failed'); }
}

/* First run seeds from the spreadsheets; after that this device's copy wins
   until the sheet answers. Older keys are picked up so nothing raised on a
   previous version is stranded. */
var LEGACY_KEYS = {
  'sakal-invoices2': ['sakal-invoices'],
  'sakal-stock3':    ['sakal-stock2', 'sakal-stock']
};
function readLocal(key, seed) {
  try {
    var raw = localStorage.getItem(key);
    if (raw === null) {
      (LEGACY_KEYS[key] || []).forEach(function(old) {
        if (raw !== null) return;
        var v = localStorage.getItem(old);
        if (v && v !== '[]' && v !== '{}') { raw = v; localStorage.setItem(key, v); }
      });
    }
    if (raw === null) { localStorage.setItem(key, JSON.stringify(seed)); return JSON.parse(JSON.stringify(seed)); }
    return JSON.parse(raw);
  } catch(e) { return JSON.parse(JSON.stringify(seed)); }
}

/* name → [storage key, getter, setter] for everything that is not an order */
var MODULES = {
  invoices:     ['sakal-invoices2',    function(){ return invoices;     }, function(v){ invoices = v || []; }],
  pricelist:    ['sakal-pricelist',    function(){ return pricelist;    }, function(v){ pricelist = v || []; }],
  stock:        ['sakal-stock3',       function(){ return stock;        }, function(v){ stock = v || []; }],
  leads:        ['sakal-leads',        function(){ return leads;        }, function(v){ leads = v || []; }],
  customers:    ['sakal-customers',    function(){ return customers;    }, function(v){ customers = v || []; }],
  ops:          ['sakal-ops',          function(){ return opitems;      }, function(v){ opitems = v || []; }],
  delta:        ['sakal-delta-v2',     function(){ return deltaOrders;  }, function(v){ deltaOrders = v || []; }],
  attachments:  ['sakal-attachments',  function(){ return orderPdfs;    }, function(v){ orderPdfs = v || {}; }]
};

function loadLocalModules() {
  pricelist    = readLocal('sakal-pricelist', SEED_PRICELIST);
  stock        = readLocal('sakal-stock3',    SEED_STOCK);
  leads        = readLocal('sakal-leads',     SEED_LEADS);
  invoices     = readLocal('sakal-invoices2', []);
  // A saved price list from an earlier version has no construction charges.
  if (!pricelist.some(function(f){ return f.cat === 'Construction'; })) {
    pricelist = pricelist.concat(JSON.parse(JSON.stringify(SEED_CONSTRUCTION)));
  }
  customers    = readLocal('sakal-customers', []);
  opitems      = readLocal('sakal-ops',       SEED_OPS);
  deltaOrders  = readLocal('sakal-delta-v2',  SEED_DELTA);
  orderPdfs    = readLocal('sakal-attachments', {});
}

function persistModule(name) {
  var m = MODULES[name]; if (!m) return;
  try { localStorage.setItem(m[0], JSON.stringify(m[1]())); } catch(e) { console.log('Cache write failed for ' + name); }
  syncModule(name, m[1]());
}
function persistStock()        { persistModule('stock'); }
function persistInvoices()     { persistModule('invoices'); }
function persistPriceList()    { persistModule('pricelist'); }
function persistLeads()        { persistModule('leads'); }
function persistCustomers()    { persistModule('customers'); }
function persistOps()          { persistModule('ops'); }
function persistDelta()        { persistModule('delta'); }
function persistAttachments()  { persistModule('attachments'); }

/* ── Pushing the lists to the sheet ──────────────────────────
   The Apps Script needs a SAVE_MODULE / GET_MODULES handler; the code
   for it ships alongside this file. Until it is in place every write
   fails quietly and the device cache carries the shop — nothing is lost
   either way, and the footer says which of the two you are on. */
var moduleTimers = {}, modulePending = 0, modulesOnServer = null;

function syncModule(name, data) {
  if (moduleTimers[name]) clearTimeout(moduleTimers[name]);
  moduleTimers[name] = setTimeout(function() {
    delete moduleTimers[name];
    _pushModule(name);
  }, 1200);
  _say('warn', 'Saving ' + name + '…');
}

async function _pushModule(name) {
  var m = MODULES[name]; if (!m) return false;
  modulePending++;
  lastSyncTime = Date.now();
  try {
    var r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({action:'SAVE_MODULE', module: name, payload: m[1]()})
    });
    var text = await r.text(), result = {};
    try { result = JSON.parse(text); } catch(_) { result = {status: text.indexOf('success') !== -1 ? 'success' : 'error'}; }
    if (result.status === 'success') {
      modulesOnServer = true;
      _say('', 'All changes saved', 'Saved');
      return true;
    }
    modulesOnServer = false;
    _say('warn', 'Saved on this device only');
    return false;
  } catch(err) {
    modulesOnServer = false;
    _say('bad', 'No connection — saved on this device');
    return false;
  } finally {
    modulePending = Math.max(0, modulePending - 1);
  }
}

/* Pulls every list back from the sheet. Anything the sheet does not hold
   is left exactly as it is on the device. */
async function fetchModulesFromServer() {
  try {
    var r = await fetch(API_URL + '?modules=1', {redirect:'follow'});
    var text = await r.text(), result = {};
    try { result = JSON.parse(text); } catch(_) { return false; }
    if (result.status !== 'success' || !result.modules) { modulesOnServer = false; return false; }
    var got = [];
    Object.keys(MODULES).forEach(function(name) {
      var v = result.modules[name];
      if (v === undefined || v === null) return;
      var empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
      if (empty) return;
      MODULES[name][2](v);
      try { localStorage.setItem(MODULES[name][0], JSON.stringify(v)); } catch(e) {}
      got.push(name);
    });
    modulesOnServer = true;
    if (got.length) { renderAll(); }
    return true;
  } catch(err) {
    modulesOnServer = false;
    return false;
  }
}

/* Sends every list up in one go — use it the first time the Apps Script
   gains its SAVE_MODULE handler, to seed the sheet from this device. */
async function pushEverything() {
  var names = Object.keys(MODULES), ok = 0;
  for (var i = 0; i < names.length; i++) {
    setSync('warn', 'Saving ' + names[i] + ' (' + (i+1) + ' of ' + names.length + ')…');
    if (await _pushModule(names[i])) ok++;
    await new Promise(function(r){ setTimeout(r, 250); });
  }
  setSync(ok === names.length ? '' : 'bad',
          ok === names.length ? 'All changes saved' : ok + ' of ' + names.length + ' lists saved');
  showToast(ok === names.length
    ? 'Everything is on the sheet'
    : 'Only ' + ok + ' of ' + names.length + ' lists reached the sheet');
}

function hasPendingModuleSync() { return modulePending > 0 || Object.keys(moduleTimers).length > 0; }

async function refreshEverything() {
  await fetchOrdersFromServer();
  await fetchModulesFromServer();
  renderAll();
  setSync(modulesOnServer === false ? 'warn' : '',
          modulesOnServer === false ? 'Orders from the sheet · lists on this device' : 'All changes saved');
}

/* Wipe this device's copy and reload the numbers from the spreadsheets. */
function resetSeedData() {
  ['sakal-pricelist','sakal-stock3','sakal-leads','sakal-ops'].forEach(function(k){ localStorage.removeItem(k); });
  loadLocalModules(); renderAll();
  ['pricelist','stock','leads','ops'].forEach(persistModule);
  showToast('Price list, stock, leads and operation reset to the spreadsheets');
}

/* ── One running number for the whole shop ───────────────── */
/* Numbers read 26 0 256 — year, series, then the running count.
   Order 260256 is invoiced as INV260256, so paperwork and garment match. */
function yearPrefix() { return String(new Date().getFullYear()).slice(2) + '0'; }
function seqOf(num) {
  var d = String(num == null ? '' : num).replace(/\D/g, '');
  var p = yearPrefix();
  if (d.indexOf(p) !== 0 || d.length <= p.length) return 0;
  return parseInt(d.slice(p.length), 10) || 0;
}
/* The floor sets the pace. The starting point is remembered on this device
   so the count is still right when the sheet has not loaded yet; imported
   history never pushes it on. Change it with setSeqStart(254). */
var SEQ_KEY = 'sakal-seq-start';
function seqStart() {
  var v = parseInt(localStorage.getItem(SEQ_KEY), 10);
  return isNaN(v) ? 254 : v;
}
function setSeqStart(n) {
  localStorage.setItem(SEQ_KEY, String(parseInt(n, 10) || 0));
  showToast('Next number is now ' + nextRunningNo());
  renderPageActions(currentPage);
}
function highestSeq() {
  var max = seqStart();
  orders.concat(archivedOrders).forEach(function(o){ max = Math.max(max, seqOf(o.orderNum)); });
  invoices.forEach(function(v){ if (!v.imported) max = Math.max(max, seqOf(v.no)); });
  return max;
}
function nextRunningNo() { return yearPrefix() + (highestSeq() + 1); }

/* ── Navigation ── */
function go(page) {
  currentPage = page;
  Object.keys(PAGES).forEach(function(p) {
    var pane = $('pane-' + p), nav = $('nav-' + p);
    if (pane) pane.style.display = (p === page) ? '' : 'none';
    if (nav)  nav.classList.toggle('on', p === page);
  });
  $('page-eyebrow').textContent = PAGES[page].eyebrow;
  $('page-title').textContent   = PAGES[page].title;
  renderPageActions(page);
  renderTabbar();
  if (page === 'orders')  renderOrders();
  if (page === 'archive') renderArchive();
  if (page === 'price')     renderPriceList();
  if (page === 'stock')     renderStock();
  if (page === 'ops')       renderOps();
  if (page === 'customers') renderCustomers();
  if (page === 'leads')     renderLeads();
  if (page === 'invoice')   renderInvoices();
  if (page === 'chat')      renderChat();
  if (page === 'delta')     renderDelta();
  window.scrollTo(0, 0);
}

/* ── The tab bar, and the sheet behind More ──────────────────
   Five under the thumb; the rest one tap away. The rail is the
   same thing wearing a different coat on a Mac and an iPad. */
var TABBAR = ['invoice','orders','chat','customers'];

function navIcon(page) {
  var el = $('nav-' + page);
  var ico = el ? el.querySelector('.nav-ico') : null;
  return ico ? ico.innerHTML : '';
}
function navCount(page) {
  var el = $('ct-' + page);
  return el ? el.textContent : '';
}

function renderTabbar() {
  var bar = $('tabbar'); if (!bar) return;
  var html = TABBAR.map(function(p) {
    var n = navCount(p);
    return '<button class="tab-btn'+(currentPage === p ? ' on' : '')+'" onclick="go(\''+p+'\')">'
      + navIcon(p)
      + (n && n !== '0' ? '<span class="tab-dot">'+esc(n)+'</span>' : '')
      + '<span>'+esc(PAGES[p].title)+'</span></button>';
  }).join('');
  var onMore = TABBAR.indexOf(currentPage) === -1;
  html += '<button class="tab-btn'+(onMore ? ' on' : '')+'" onclick="openMore()">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
    + '<span>More</span></button>';
  bar.innerHTML = html;
}

function openMore() {
  $('more-list').innerHTML = Object.keys(PAGES).filter(function(p) {
    return TABBAR.indexOf(p) === -1;
  }).map(function(p) {
    var n = navCount(p);
    return '<button class="more-row" onclick="closeMore();go(\''+p+'\')">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
      + navIcon(p).replace(/^<svg[^>]*>|<\/svg>$/g, '') + '</svg>'
      + '<span style="flex:1">'+esc(PAGES[p].title)+'</span>'
      + (n && n !== '0' ? '<span class="nav-count">'+esc(n)+'</span>' : '')
      + '</button>';
  }).join('');
  $('sync-text-2').textContent = $('sync-text').textContent;
  $('sync-dot-2').className = $('sync-dot').className;
  $('more-modal').classList.add('open');
}
function closeMore() { $('more-modal').classList.remove('open'); }

/* Phones read a table sideways badly, so each row becomes a card.
   The card needs to know what each value is called — this reads the
   heading row once and stamps the labels on. */
function labelTableCells(root) {
  (root || document).querySelectorAll('table.grid:not([data-labelled])').forEach(function(tbl) {
    var heads = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function(th){ return th.textContent.trim(); });
    if (!heads.length) return;
    tbl.setAttribute('data-labelled', '1');
    Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function(tr) {
      Array.prototype.forEach.call(tr.children, function(td, i) {
        if (heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });
}

function renderPageActions(page) {
  var el = $('page-actions'), h = '';
  if (page === 'orders')    h = '<button class="btn" onclick="fetchOrdersFromServer()">Refresh from sheet</button>';
  if (page === 'chat')      h = '<button class="btn" onclick="openAiSettings()">Settings</button>';
  if (page === 'delta')     h = '<button class="btn" onclick="openDeltaImport()">Import</button>'
                              + '<button class="btn" onclick="exportDelta()">Export CSV</button>'
                              + '<button class="btn gold" onclick="openDeltaModal()">+ New Delta order</button>';
  if (page === 'price')     h = '<button class="btn" onclick="exportPriceList()">Export CSV</button>'
                              + '<button class="btn gold" onclick="openPriceModal()">+ Add fabric</button>';
  if (page === 'stock')     h = '<button class="btn gold" onclick="openStockModal()">+ Add stock item</button>';
  if (page === 'ops')       h = '<button class="btn gold" onclick="openOpsModal()">+ Add card</button>';
  if (page === 'customers') h = '<button class="btn" onclick="exportCustomers()">Export CSV</button>'
                              + '<button class="btn gold" onclick="openCustModal()">+ New customer</button>';
  if (page === 'leads')     h = '<button class="btn" onclick="exportLeads()">Export CSV</button>'
                              + '<button class="btn gold" onclick="openLeadModal()">+ New lead</button>';
  if (page === 'invoice') {
    var gap = invoicesWithoutOrders('').length;
    h = (gap ? '<button class="btn" onclick="openImportModal()">Bring ' + gap + ' onto the floor</button>' : '')
      + '<button class="btn gold" onclick="openInvoiceModal()">+ New invoice</button>';
  }
  el.innerHTML = h;
}

function renderAll() {
  renderOrders(); renderArchive();
  renderPriceList(); renderStock(); renderOps(); renderCustomers(); renderDelta();
  renderLeads(); renderInvoices(); updateCounts();
}

function updateCounts() {
  var today = new Date(todayYMD());
  var active = orders.filter(function(o) {
    var items = o.items || [];
    var allDone = items.length > 0 && items.every(function(it){ return it.status === 'Take Home'; });
    if (allDone) { var ref = o.dueDate || o.fittingDate; if (ref && new Date(ref) < today) return false; }
    return true;
  }).length;
  $('ct-orders').textContent  = active;
  $('ct-archive').textContent = archivedOrders.length;
  $('ct-price').textContent   = pricelist.length;
  $('ct-stock').textContent     = stock.length;
  $('ct-delta').textContent     = deltaOrders.filter(function(o){ return !o.archived; }).length;
  $('ct-ops').textContent       = opitems.length;
  $('ct-customers').textContent = customers.length;
  $('ct-leads').textContent   = leads.filter(function(l){ return l.purchased !== 'Yes'; }).length;
  $('ct-invoice').textContent = invoices.filter(function(v){ return invoiceStatus(v) !== 'Paid'; }).length;
  renderTabbar();
}

/* Shared table/stat helpers */
function stat(key, val, sub, tone) {
  return '<div class="stat"><div class="stat-key">'+esc(key)+'</div>'
    + '<div class="stat-val'+(tone?' '+tone:'')+'">'+esc(String(val))+'</div>'
    + '<div class="stat-sub">'+esc(sub||'')+'</div></div>';
}
function downloadCsv(filename, rows) {
  var csv = rows.map(function(r) {
    return r.map(function(c){ return '"' + String(c == null ? '' : c).replace(/"/g,'""') + '"'; }).join(',');
  }).join('\n');
  var blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  showToast('Downloaded ' + filename);
}