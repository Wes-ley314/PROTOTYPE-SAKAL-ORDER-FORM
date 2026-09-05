/* ══════════════════════════════════════════════════
   PRICE LIST
   The fabric library: brand, bunch, cloth type, price
   tier, and what each garment sells for out of it.

   A CrudScreen (see js/lib/00-crud-screen.js), though only
   the modal half fits the mould — the list is five different
   tables behind a tab strip, so render() is written out.
   ══════════════════════════════════════════════════ */

var PRICE_CATS = ['Suiting', 'Shirting', 'Lining', 'Construction', 'Tiers'];
var GARMENT_KEYS = [
  { k: 'p2', l: '2 piece' }, { k: 'p3', l: '3 piece' }, { k: 'pJ', l: 'Jacket' },
  { k: 'pV', l: 'Vest' },    { k: 'pT', l: 'Trousers' }
];

function tierBadge(t, name) {
  if (!t) return '<span class="tier"><i class="t-"></i>No tier</span>';
  return '<span class="tier"><i class="t-' + esc(t) + '"></i>' + esc(name || t) + '</span>';
}
function tierByColour(t) { return PRICE_TIERS.find(function (x) { return x.tier === t; }) || null; }

/* Tap a price and it goes straight onto an invoice. */
function priceCell(f, key, label, showLabel) {
  var v = Number(f[key]) || 0;
  var cap = showLabel ? '<em>' + esc(label) + '</em>' : '';
  if (!v) return '<span class="pcell off">' + cap + '—</span>';
  return '<button class="pcell" title="Put ' + esc(label) + ' on an invoice" onclick="quoteFrom(\'' + esc(f.id) + '\',\'' + key + '\')">'
    + cap + money0(v) + '</button>';
}

class PriceListScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Fabric',
      collection: 'pricelist',
      persist: 'persistPriceList',
      contentId: 'price-content',
      searchId: 'price-search',
      modalId: 'price-modal',
      focusId: 'pl-brand',
      filters: { tab: 'Suiting' },
      fields: {
        'pl-cat': 'cat', 'pl-brand': 'brand', 'pl-name': 'name', 'pl-type': 'type'
      }
    });
    this.stockedDraft = true;
  }

  setTab(t) { this.filters.tab = t; this.render(); }

  /* ── the tab strip and the two dropdowns above the table ── */
  renderTabs() {
    var tab = this.filters.tab;
    $('price-tabs').innerHTML = PRICE_CATS.map(function (c) {
      var n = c === 'Tiers' ? PRICE_TIERS.length : pricelist.filter(function (f) { return f.cat === c; }).length;
      return '<button class="gtab' + (c === tab ? ' on' : '') + '" onclick="setPriceTab(\'' + c + '\')">'
        + (c === 'Tiers' ? 'Price tiers' : c)
        + ' <span class="nav-count" style="background:var(--card-2);color:var(--faint);margin-left:6px">' + n + '</span></button>';
    }).join('');
  }

  refreshFilters() {
    var tab = this.filters.tab;

    var brands = Array.from(new Set(pricelist.filter(function (f) { return f.cat === tab; })
      .map(function (f) { return f.brand; }))).sort();
    var bsel = $('price-brand'), keepB = bsel.value;
    bsel.innerHTML = '<option value="">All brands</option>'
      + brands.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('');
    if (brands.indexOf(keepB) !== -1) bsel.value = keepB;

    var tsel = $('price-tier'), keepT = tsel.value;
    tsel.innerHTML = '<option value="">All tiers</option>'
      + PRICE_TIERS.map(function (t) { return '<option value="' + esc(t.tier) + '">' + esc(t.name) + '</option>'; }).join('');
    if (PRICE_TIERS.some(function (t) { return t.tier === keepT; })) tsel.value = keepT;

    tsel.style.display = (tab === 'Suiting') ? '' : 'none';
    bsel.style.display = (tab === 'Tiers' || tab === 'Construction') ? 'none' : '';
    $('price-search').parentElement.style.display = (tab === 'Tiers') ? 'none' : '';

    /* datalists for the entry form */
    var allBrands = Array.from(new Set(pricelist.map(function (f) { return f.brand; }))).sort();
    $('brand-options').innerHTML = allBrands.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');
    var types = Array.from(new Set(pricelist.map(function (f) { return f.type; }).filter(Boolean))).sort();
    $('type-options').innerHTML = types.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');
  }

  keep(f, term) {
    var tab = this.filters.tab;
    var brand = $('price-brand').value, tier = $('price-tier').value;
    if (f.cat !== tab) return false;
    if (brand && f.brand !== brand) return false;
    if (tab === 'Suiting' && tier && f.tier !== tier) return false;
    if (!term) return true;
    return hit(f.brand, term) || hit(f.name, term) || hit(f.type, term) || hit(f.tierName, term);
  }

  compare(a, b) {
    return String(a.brand).localeCompare(String(b.brand)) || String(a.name).localeCompare(String(b.name));
  }

  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;
    this.renderTabs();
    this.refreshFilters();

    var suits = pricelist.filter(function (f) { return f.cat === 'Suiting'; });
    var lowest = suits.reduce(function (a, f) { return (f.p2 && (!a || f.p2 < a)) ? f.p2 : a; }, 0);
    var inShop = pricelist.filter(function (f) { return f.stocked; }).length;
    var brandN = new Set(pricelist.map(function (f) { return f.brand; })).size;

    $('price-stats').innerHTML =
        stat('Bunches on file', pricelist.length, 'Suiting, shirting and lining')
      + stat('Brands', brandN, 'Mills and merchants you buy from')
      + stat('Bunches in the shop', inShop, inShop ? 'Physically on the shelf' : 'Nothing marked as held')
      + stat('Suits start at', lowest ? 'S$ ' + money0(lowest) : '—', 'Cheapest two piece on the list');

    var tab = this.filters.tab;
    if (tab === 'Tiers') { el.innerHTML = this.tierTable(); return; }

    var rows = this.visible();

    if (rows.length === 0) {
      el.innerHTML = pricelist.filter(function (f) { return f.cat === tab; }).length === 0
        ? emptyState('No ' + tab.toLowerCase() + ' on the list yet', 'Add a bunch and its prices show up on every invoice you raise.', '<button class="btn gold" onclick="openPriceModal()">+ Add fabric</button>')
        : emptyState('Nothing matches', 'Try a brand, a bunch name, or a cloth type.');
      return;
    }

    if (tab === 'Suiting')      el.innerHTML = this.suitingTable(rows);
    if (tab === 'Shirting')     el.innerHTML = this.shirtingTable(rows);
    if (tab === 'Lining')       el.innerHTML = this.liningTable(rows);
    if (tab === 'Construction') el.innerHTML = this.constructionTable(rows);
  }

  suitingTable(rows) {
    var body = rows.map(function (f) {
      return '<tr>'
        + '<td><div class="cell-strong">' + esc(f.brand) + '</div></td>'
        + '<td>' + esc(f.name || '—') + '</td>'
        + GARMENT_KEYS.map(function (g) { return '<td class="num">' + priceCell(f, g.k, g.l) + '</td>'; }).join('')
        + '<td class="acts"><button class="btn sm" onclick="openPriceModal(\'' + esc(f.id) + '\')">Edit</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:860px">'
      + '<thead><tr><th>Brand</th><th>Bunch</th>'
      + '<th class="num">2PC</th><th class="num">3PC</th><th class="num">Jacket</th>'
      + '<th class="num">Vest</th><th class="num">Trousers</th><th></th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></div></div>';
  }

  shirtingTable(rows) {
    var body = rows.map(function (f) {
      return '<tr>'
        + '<td><div class="cell-strong">' + esc(f.name || f.brand) + '</div><div class="cell-sub">' + esc(f.brand) + '</div></td>'
        + '<td><div class="price-cells">' + priceCell(f, 'pShirt', 'Shirt', true) + '</div></td>'
        + '<td>' + (f.stocked ? '<span class="tag green">In shop</span>' : '<span class="tag">Order in</span>') + '</td>'
        + '<td class="acts"><button class="btn sm" onclick="openPriceModal(\'' + esc(f.id) + '\')">Edit</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:620px">'
      + '<thead><tr><th>Book</th><th>Price</th><th>Bunch</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  liningTable(rows) {
    var body = rows.map(function (f) {
      return '<tr>'
        + '<td><div class="cell-strong">' + esc(f.name || '—') + '</div><div class="cell-sub">' + esc(f.brand) + '</div></td>'
        + '<td><div class="price-cells">' + priceCell(f, 'pJ', 'Jacket', true) + priceCell(f, 'pJV', 'Jacket + vest', true) + '</div></td>'
        + '<td class="acts"><button class="btn sm" onclick="openPriceModal(\'' + esc(f.id) + '\')">Edit</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:620px">'
      + '<thead><tr><th>Lining collection</th><th>Price</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  constructionTable(rows) {
    var body = rows.map(function (f) {
      return '<tr>'
        + '<td><div class="cell-strong">' + esc(f.name || '—') + '</div>'
        + (f.type ? '<div class="cell-sub">' + esc(f.type) + '</div>' : '') + '</td>'
        + '<td class="num">' + priceCell(f, 'pCon', f.name || 'Charge') + '</td>'
        + '<td class="acts"><button class="btn sm" onclick="openPriceModal(\'' + esc(f.id) + '\')">Edit</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:460px">'
      + '<thead><tr><th>Construction</th><th class="num">Price</th><th></th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></div>'
      + '<div class="oc-note">These are the house charges that sit on top of the cloth. Tap a price to add it to the invoice you are writing.</div></div>';
  }

  tierTable() {
    var body = PRICE_TIERS.map(function (t) {
      var n = pricelist.filter(function (f) { return f.tier === t.tier; }).length;
      return '<tr>'
        + '<td>' + tierBadge(t.tier, t.name) + '</td>'
        + '<td class="num">S$ ' + money0(t.p2) + '</td><td class="num">S$ ' + money0(t.p3) + '</td>'
        + '<td class="num">S$ ' + money0(t.pJ) + '</td><td class="num">S$ ' + money0(t.pV) + '</td>'
        + '<td class="num">S$ ' + money0(t.pT) + '</td>'
        + '<td class="num">' + n + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:660px">'
      + '<thead><tr><th>Tier</th><th class="num">2 piece</th><th class="num">3 piece</th><th class="num">Jacket</th>'
      + '<th class="num">Vest</th><th class="num">Trousers</th><th class="num">Bunches</th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></div>'
      + '<div class="oc-note">Tiers are the house price bands. Change a bunch\'s tier on its own row and its five garment prices follow.</div></div>';
  }

  /* ── the entry form ── */
  toggleStocked() {
    this.stockedDraft = !this.stockedDraft;
    $('pl-stocked').classList.toggle('on', this.stockedDraft);
  }

  /* only the price boxes for the chosen list are shown */
  onCatChange() {
    var c = $('pl-cat').value;
    $('pl-suit-block').style.display   = c === 'Suiting' ? '' : 'none';
    $('pl-shirt-block').style.display  = c === 'Shirting' ? '' : 'none';
    $('pl-lining-block').style.display = c === 'Lining' ? '' : 'none';
    $('pl-con-block').style.display    = c === 'Construction' ? '' : 'none';
  }

  /* picking a tier fills the five garment prices from the house band */
  applyTier() {
    var t = tierByColour($('pl-tier').value);
    if (!t) return;
    $('pl-p2').value = t.p2; $('pl-p3').value = t.p3; $('pl-pj').value = t.pJ;
    $('pl-pv').value = t.pV; $('pl-pt').value = t.pT;
  }

  title(f) { return f ? 'Edit fabric' : 'Add to price list'; }

  fill(f) {
    $('pl-tier').innerHTML = '<option value="">No tier</option>'
      + PRICE_TIERS.map(function (t) { return '<option value="' + esc(t.tier) + '">' + esc(t.name) + ' — S$' + money0(t.p2) + ' / 2pc</option>'; }).join('');
    $('pl-cat').value   = f ? f.cat : (this.filters.tab === 'Tiers' ? 'Suiting' : this.filters.tab);
    $('pl-brand').value = f ? f.brand : '';
    $('pl-name').value  = f ? f.name : '';
    $('pl-type').value  = f ? (f.type || '') : '';
    $('pl-tier').value  = f ? (f.tier || '') : '';
    $('pl-perm').value  = f && f.perM ? f.perM : '';
    $('pl-p2').value = f ? (f.p2 || '') : ''; $('pl-p3').value = f ? (f.p3 || '') : '';
    $('pl-pj').value = f ? (f.pJ || '') : ''; $('pl-pv').value = f ? (f.pV || '') : '';
    $('pl-pt').value = f ? (f.pT || '') : '';
    $('pl-pshirt').value = f ? (f.pShirt || '') : '';
    $('pl-plj').value = f ? (f.pJ || '') : ''; $('pl-pljv').value = f ? (f.pJV || '') : '';
    $('pl-pcon').value = f ? (f.pCon || '') : '';
    this.stockedDraft = f ? !!f.stocked : true;
    $('pl-stocked').classList.toggle('on', this.stockedDraft);
    $('pl-delete').style.display = f ? '' : 'none';
    $('pl-brand-err').classList.remove('show');
    $('pl-brand').classList.remove('err');
    this.onCatChange();
  }

  validate() {
    if (!$('pl-brand').value.trim()) return this.reject('pl-brand');
    return true;
  }

  collect() {
    var cat = $('pl-cat').value;
    var t = tierByColour($('pl-tier').value);
    var p = {
      cat: cat,
      brand: $('pl-brand').value.trim(),
      name: $('pl-name').value.trim(),
      type: $('pl-type').value.trim(),
      tier: cat === 'Suiting' ? $('pl-tier').value : '',
      tierName: cat === 'Suiting' && t ? t.name : '',
      stocked: this.stockedDraft
    };
    if (cat === 'Suiting') {
      p.p2 = Number($('pl-p2').value) || 0; p.p3 = Number($('pl-p3').value) || 0;
      p.pJ = Number($('pl-pj').value) || 0; p.pV = Number($('pl-pv').value) || 0;
      p.pT = Number($('pl-pt').value) || 0; p.perM = Number($('pl-perm').value) || 0;
    } else if (cat === 'Shirting') {
      p.pShirt = Number($('pl-pshirt').value) || 0;
    } else if (cat === 'Construction') {
      p.pCon = Number($('pl-pcon').value) || 0;
    } else {
      p.pJ = Number($('pl-plj').value) || 0; p.pJV = Number($('pl-pljv').value) || 0;
    }
    return p;
  }

  save() { super.save(); updateCounts(); }
  remove() { super.remove(); updateCounts(); }

  export() {
    var rows = [['List', 'Brand', 'Collection', 'Cloth type', 'Tier', 'Tier name', '2PC', '3PC', 'Jacket', 'Vest', 'Trousers', 'Shirt', 'Jacket+Vest lining', 'Construction', 'Cost per metre', 'In shop']];
    pricelist.forEach(function (f) {
      rows.push([f.cat, f.brand, f.name, f.type || '', f.tier || '', f.tierName || '',
                 f.p2 || '', f.p3 || '', f.pJ || '', f.pV || '', f.pT || '', f.pShirt || '', f.pJV || '',
                 f.pCon || '', f.perM || '', f.stocked ? 'Yes' : 'No']);
    });
    downloadCsv('sakal-price-list.csv', rows);
  }
}

var priceScreen = new PriceListScreen();

priceScreen.expose({
  renderPriceList:    'render',
  renderPriceTabs:    'renderTabs',
  refreshPriceFilters:'refreshFilters',
  setPriceTab:        'setTab',
  togglePlStocked:    'toggleStocked',
  onPlCatChange:      'onCatChange',
  applyTierPrices:    'applyTier',
  openPriceModal:     'open',
  closePriceModal:    'close',
  savePriceForm:      'save',
  deletePriceRow:     'remove',
  exportPriceList:    'export'
});
