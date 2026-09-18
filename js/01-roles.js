/* ══════════════════════════════════════════════════
   ROLES — who sees what
   Admin accounts (owner / staff) see the whole app.
   A 'delta' account sees the Delta page and nothing
   else, and cannot change anything on it.

   This file only shapes the app. The real lock is in
   the Apps Script (SAKAL-ROLES.gs): a Delta account's
   requests only ever get Delta data back, so hiding a
   tab here is tidiness, not the protection itself.

   The role comes from the Role column of the Users tab
   in the sheet, handed over at sign-in.
   ══════════════════════════════════════════════════ */

var ROLE_RULES = {
  delta: {
    label:    'Delta',
    pages:    ['delta'],            // the only pages it can open
    readOnly: true,                 // view only
    keep:     ['delta', 'attachments']   // the only lists it may hold
  }
};

/* Everything this device may have cached for an admin. A restricted account
   signing in on a shared phone must not find any of it. */
var PRIVATE_KEYS = [
  'sakal-orders', 'sakal-invoices2', 'sakal-invoices', 'sakal-pricelist',
  'sakal-stock3', 'sakal-stock2', 'sakal-stock', 'sakal-leads', 'sakal-customers',
  'sakal-ops', 'sakal-vehicles', 'sakal-ops-shadow', 'sakal-ops-pending', 'sakal-ops-meta',
  'sakal-measurements', 'sakal-ai', 'sakal-last-staff', 'sakal-delta-charge'
];

function currentRole() {
  var r = (window.SakalAuth && SakalAuth.role && SakalAuth.role()) || '';
  return String(r).trim().toLowerCase();
}
function roleRule()        { return ROLE_RULES[currentRole()] || null; }
function isRestricted()    { return !!roleRule(); }
function isReadOnly()      { var r = roleRule(); return !!(r && r.readOnly); }
function canSeePage(page)  { var r = roleRule(); return !r || r.pages.indexOf(page) > -1; }
function homePage()        { var r = roleRule(); return r ? r.pages[0] : 'invoice'; }
function mayHoldModule(n)  { var r = roleRule(); return !r || r.keep.indexOf(n) > -1; }

/* Delta PDFs only — the order-form links are not theirs to see. */
function restrictAttachments(map) {
  if (!isRestricted()) return map || {};
  var out = {};
  Object.keys(map || {}).forEach(function (k) {
    if (String(k).indexOf('DELTA-') === 0) out[k] = map[k];
  });
  return out;
}

/* Runs before anything is drawn: marks the page for the CSS and wipes
   whatever an admin left in this browser. */
(function applyRole() {
  var rule = roleRule();
  if (!rule) return;
  document.documentElement.classList.add('role-restricted', 'role-' + currentRole());
  if (rule.readOnly) document.documentElement.classList.add('role-readonly');
  try {
    PRIVATE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    var att = JSON.parse(localStorage.getItem('sakal-attachments') || '{}');
    localStorage.setItem('sakal-attachments', JSON.stringify(restrictAttachments(att)));
    // Delta charges are not sent to a Delta account; drop any cached ones.
    var d = JSON.parse(localStorage.getItem('sakal-delta-v2') || 'null');
    if (Array.isArray(d)) {
      localStorage.setItem('sakal-delta-v2', JSON.stringify(d.map(function (o) {
        var c = Object.assign({}, o); delete c.total; return c;
      })));
    }
  } catch (e) {}
})();

/* After the lists load: empty everything this role may not hold. */
function restrictLoadedData() {
  if (!isRestricted()) return;
  orders = []; archivedOrders = [];
  stock = []; invoices = []; pricelist = []; leads = []; customers = [];
  opitems = []; vehicles = [];
  orderPdfs = restrictAttachments(orderPdfs);
  if (isReadOnly()) deltaOrders = (deltaOrders || []).map(function (o) {
    var c = Object.assign({}, o); delete c.total; return c;
  });
}

/* Anything a view-only account tries to change stops here, quietly. */
function denyIfReadOnly() {
  if (!isReadOnly()) return false;
  showToast('View only — ask an admin to change this.');
  return true;
}
