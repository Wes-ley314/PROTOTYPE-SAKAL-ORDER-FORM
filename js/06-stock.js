/* ══════════════════════════════════════════════════
   STOCK
   Linings, trims, buttons, packaging — what's held in
   Batam and what's held in Singapore, and what to reorder.

   Converted to a CrudScreen (see js/lib/00-crud-screen.js).
   The screen's own state — which category is showing, which
   row is being edited — now lives on the instance instead of
   as loose globals.  The function names the markup calls are
   unchanged, so every existing onclick="" still works.
   ══════════════════════════════════════════════════ */

var STOCK_CATS = ['Buttons', 'Lining', 'Packaging', 'Others'];

/* Anything logged before categories existed still lands somewhere sensible.
   Stays global: the assistant reads it too. */
function catOf(s) {
  if (s.cat && STOCK_CATS.indexOf(s.cat) !== -1) return s.cat;
  var n = String(s.item || '').toLowerCase();
  if (n.indexOf('button') !== -1) return 'Buttons';
  if (/lining|puring|satin/.test(n)) return 'Lining';
  if (/dust bag|name card|paper bag|sakal label|suit bag|suit hanger|hanger|label|box/.test(n)) return 'Packaging';
  return 'Others';
}

class StockScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Stock item',
      collection: 'stock',
      persist: 'persistStock',
      contentId: 'stock-content',
      searchId: 'stock-search',
      modalId: 'stock-modal',
      filters: { cat: 'all', loc: 'all', reorderOnly: false },
      fields: {
        'sk-item': 'item',
        'sk-cat': 'cat',
        'sk-loc': 'loc',
        'sk-brand': 'brand',
        'sk-color': 'color',
        'sk-price': 'price',
        'sk-purchased': 'purchased',
        'sk-supplier': 'supplier',
        'sk-remark': 'remark'
      }
    });
    this.reorderDraft = false;
  }

  /* ── filters ── */
  setCat(c) { this.setFilter('cat', c, 'data-stockcat'); }
  setLoc(l) { this.setFilter('loc', l, 'data-stockloc'); }
  toggleReorderFilter() { this.toggleFilter('reorderOnly', 'stock-reorder-filter'); }

  keep(s, term) {
    if (this.filters.cat !== 'all' && catOf(s) !== this.filters.cat) return false;
    if (this.filters.loc !== 'all' && s.loc !== this.filters.loc) return false;
    if (this.filters.reorderOnly && !s.reorder) return false;
    if (!term) return true;
    return [s.item, s.brand, s.color, s.supplier, s.remark, s.price]
      .some(function (v) { return hit(v, term); });
  }

  compare(a, b) {
    return STOCK_CATS.indexOf(catOf(a)) - STOCK_CATS.indexOf(catOf(b))
      || String(a.item || '').localeCompare(String(b.item || ''));
  }

  /* ── the list ── */
  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;

    var counts = {};
    STOCK_CATS.forEach(function (c) {
      counts[c] = stock.filter(function (s) { return catOf(s) === c; }).length;
    });
    var flag = stock.filter(function (s) { return s.reorder; }).length;

    $('stock-stats').innerHTML =
        stat('Buttons', counts.Buttons, 'Horn, MOP and tuxedo')
      + stat('Lining', counts.Lining, 'Bemberg and satin lapel')
      + stat('Packaging', counts.Packaging, 'Bags, hangers, labels, cards')
      + stat('Others', counts.Others, 'Canvas, glue, pins, adjusters')
      + stat('To reorder', flag, flag ? 'Flagged by you' : 'Nothing flagged', flag ? 'alarm' : 'ok');

    document.querySelectorAll('[data-stockcat]').forEach(function (b) {
      var c = b.getAttribute('data-stockcat');
      if (c !== 'all') b.textContent = c + ' · ' + counts[c];
    });

    var rows = this.visible();

    if (rows.length === 0) {
      el.innerHTML = stock.length === 0
        ? emptyState('No stock logged yet', 'Log the buttons, linings and packaging you keep, and flag anything that needs reordering.', '<button class="btn gold" onclick="openStockModal()">+ Add stock item</button>')
        : emptyState('Nothing in this group', 'Try another group, or clear the search.');
      updateCounts();
      return;
    }

    el.innerHTML = this.html(rows);
    updateCounts();
  }

  html(rows) {
    var self = this;
    var order = STOCK_CATS.filter(function (c) {
      return self.filters.cat === 'all' || c === self.filters.cat;
    });
    return order.map(function (cat) {
      var set = rows.filter(function (s) { return catOf(s) === cat; });
      if (!set.length) return '';
      var body = set.map(function (s) { return self.row(s); }).join('');
      return '<div class="section-head" style="margin-top:20px"><span class="section-title">' + esc(cat)
        + ' &nbsp;·&nbsp; ' + set.length + ' item' + (set.length === 1 ? '' : 's') + '</span></div>'
        + '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:820px">'
        + '<thead><tr><th>Item</th><th>Item code / colour</th><th>Purchase price</th>'
        + '<th>Last bought</th><th>Supplier</th><th>Held at</th><th></th></tr></thead>'
        + '<tbody>' + body + '</tbody></table></div></div>';
    }).join('');
  }

  row(s) {
    return '<tr class="' + (s.reorder ? 'row-flag' : '') + '">'
      + '<td><div class="cell-strong">' + esc(s.item || '—') + '</div>'
      + (s.brand || s.remark ? '<div class="cell-sub">' + esc([s.brand, s.remark].filter(Boolean).join(' · ')) + '</div>' : '') + '</td>'
      + '<td>' + esc(s.color || '—') + '</td>'
      + '<td>' + esc(s.price || '—') + '</td>'
      + '<td>' + esc(s.purchased ? formatDisplayDate(s.purchased) : '—') + '</td>'
      + '<td>' + this.supplierCell(s.supplier) + '</td>'
      + '<td><span class="tag' + (s.loc === 'Batam' ? ' blue' : '') + '">' + esc(s.loc || '—') + '</span></td>'
      + '<td class="acts">'
      + '<span class="pill' + (s.reorder ? ' st-bin' : '') + '" style="min-width:74px" onclick="toggleStockReorder(\'' + esc(s.id) + '\')">' + (s.reorder ? 'Reorder' : 'Stocked') + '</span> '
      + '<button class="btn sm" onclick="openStockModal(\'' + esc(s.id) + '\')">Edit</button>'
      + '</td></tr>';
  }

  supplierCell(v) {
    if (!v) return '<span style="color:var(--faint)">—</span>';
    if (/^https?:\/\//i.test(v)) {
      var host = v.replace(/^https?:\/\//i, '').split('/')[0];
      return '<a class="link-out" href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(host) + '</a>';
    }
    return esc(v);
  }

  /* flip a row between Stocked and Reorder straight from the table */
  toggleReorder(id) {
    var s = this.find(id);
    if (!s) return;
    s.reorder = !s.reorder;
    this.persist();
    this.render();
  }

  /* ── the modal ── */
  toggleReorderDraft() {
    this.reorderDraft = !this.reorderDraft;
    $('sk-reorder').classList.toggle('on', this.reorderDraft);
  }

  fill(s) {
    $('sk-item').value      = s ? (s.item || '') : '';
    $('sk-loc').value       = s ? (s.loc || 'Batam') : (this.filters.loc === 'Singapore' ? 'Singapore' : 'Batam');
    $('sk-cat').value       = s ? catOf(s) : (this.filters.cat === 'all' ? 'Others' : this.filters.cat);
    $('sk-brand').value     = s ? (s.brand || '') : '';
    $('sk-color').value     = s ? (s.color || '') : '';
    $('sk-price').value     = s ? (s.price || '') : '';
    $('sk-purchased').value = s ? parseToYMD(s.purchased) : '';
    $('sk-supplier').value  = s ? (s.supplier || '') : '';
    $('sk-remark').value    = s ? (s.remark || '') : '';

    this.reorderDraft = s ? !!s.reorder : false;
    $('sk-reorder').classList.toggle('on', this.reorderDraft);
    $('sk-delete').style.display = s ? '' : 'none';
    this.clearErrors();
  }

  validate() {
    if (!$('sk-item').value.trim()) return this.reject('sk-item');
    return true;
  }

  collect() {
    var payload = super.collect();
    payload.purchased = $('sk-purchased').value;   // keep the raw date, untrimmed
    payload.reorder = this.reorderDraft;
    payload.updated = todayYMD();
    return payload;
  }
}

var stockScreen = new StockScreen();

/* The markup still calls these names, so they stay. */
stockScreen.expose({
  renderStock:              'render',
  setStockCat:              'setCat',
  setStockLoc:              'setLoc',
  toggleStockReorderFilter: 'toggleReorderFilter',
  toggleStockReorder:       'toggleReorder',
  openStockModal:           'open',
  closeStockModal:          'close',
  saveStockForm:            'save',
  deleteStockRow:           'remove',
  toggleSkReorder:          'toggleReorderDraft'
});
