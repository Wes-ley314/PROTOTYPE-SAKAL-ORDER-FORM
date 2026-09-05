/* ══════════════════════════════════════════════════
   OPERATION
   The SIM cards and the stored-value cards the shop
   runs on — separately, because they are watched for
   different things. A SIM has an expiry; a card has a
   balance and a date it was last topped up.

   A CrudScreen (see js/lib/00-crud-screen.js).
   ══════════════════════════════════════════════════ */

var OPS_TYPES = ['SIM Card', 'Ez-Link Card', 'NETS Card'];
var OPS_HOLDERS = ['Lia', 'Lina', 'Benjamin', 'Wesley', 'Kharsima', 'Office'];

function isSim(o) { return o.type === 'SIM Card'; }

function opExpiringSoon(o) {
  if (!o.expiry) return false;
  var d = new Date(parseToYMD(o.expiry)), n = new Date(todayYMD());
  var days = (d - n) / 86400000;
  return days >= 0 && days <= 45;
}

/* A card nobody has topped up in two months is worth a look. */
function topupStale(o) {
  if (isSim(o) || !o.topup) return false;
  var d = new Date(parseToYMD(o.topup)), n = new Date(todayYMD());
  return (n - d) / 86400000 > 60;
}

function opNeedsEye(o) {
  return isSim(o) ? (isOverdue(o.expiry) || opExpiringSoon(o)) : topupStale(o);
}

function holderOptions(sel) {
  var list = OPS_HOLDERS.slice();
  if (sel && list.indexOf(sel) === -1) list.push(sel);
  return list.map(function (h) { return '<option' + (h === sel ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('');
}

class OpsScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Card',
      collection: 'opitems',
      persist: 'persistOps',
      contentId: 'ops-content',
      searchId: 'ops-search',
      modalId: 'ops-modal',
      focusId: 'op-number',
      filters: { type: 'all' },
      fields: {
        'op-type': 'type', 'op-number': 'number', 'op-provider': 'provider',
        'op-holder': 'holder', 'op-expiry': 'expiry', 'op-amount': 'amount',
        'op-topup': 'topup', 'op-note': 'note'
      }
    });
  }

  setType(f) { this.setFilter('type', f, 'data-opsfilter'); }

  keep(o, term) {
    if (this.filters.type !== 'all' && o.type !== this.filters.type) return false;
    if (!term) return true;
    return [o.number, o.provider, o.holder, o.note].some(function (v) { return hit(v, term); });
  }

  /* the two tables sort differently, so the list stays unsorted here */
  compare() { return 0; }

  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;

    var counts = {};
    OPS_TYPES.forEach(function (t) { counts[t] = opitems.filter(function (o) { return o.type === t; }).length; });
    var eye = opitems.filter(opNeedsEye).length;

    $('ops-stats').innerHTML =
        stat('SIM cards', counts['SIM Card'], 'Shop and workshop lines')
      + stat('Ez-Link cards', counts['Ez-Link Card'], 'Transit and deliveries')
      + stat('NETS cards', counts['NETS Card'], 'Counter payments')
      + stat('Needs a look', eye, eye ? 'Expiring, expired or long unfilled' : 'Everything current', eye ? 'alarm' : 'ok');

    var rows = this.visible();

    if (rows.length === 0) {
      el.innerHTML = opitems.length === 0
        ? emptyState('Nothing logged yet', 'Keep the shop SIM, the Ez-Link cards for the Batam runs and the NETS cards here, so you know who has what.', '<button class="btn gold" onclick="openOpsModal()">+ Add card</button>')
        : emptyState('Nothing matches', 'Try a number, a provider, or who holds it.');
      updateCounts();
      return;
    }

    el.innerHTML = this.html(rows);
    updateCounts();
  }

  html(rows) {
    var sims = rows.filter(isSim)
      .sort(function (a, b) { return String(a.holder || '').localeCompare(String(b.holder || '')); });
    var cards = rows.filter(function (o) { return !isSim(o); })
      .sort(function (a, b) {
        return String(a.type).localeCompare(String(b.type))
          || String(a.holder || '').localeCompare(String(b.holder || ''));
      });

    var html = '';
    if (sims.length) html += this.simTable(sims);
    if (cards.length) html += this.cardTable(cards);
    return html;
  }

  simTable(sims) {
    var self = this;
    return '<div class="section-head"><span class="section-title">SIM cards &nbsp;·&nbsp; ' + sims.length + '</span></div>'
      + '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:640px">'
      + '<thead><tr><th>Number</th><th>Provider</th><th>Expiry date</th><th>Held by</th><th></th></tr></thead><tbody>'
      + sims.map(function (o) { return self.simRow(o); }).join('')
      + '</tbody></table></div></div>';
  }

  simRow(o) {
    var flag = opNeedsEye(o);
    return '<tr class="' + (flag ? 'row-flag' : '') + '">'
      + '<td><div class="cell-strong num">' + esc(o.number || '—') + '</div>'
      + (o.note ? '<div class="cell-sub">' + esc(o.note) + '</div>' : '') + '</td>'
      + '<td>' + esc(o.provider || '—') + '</td>'
      + '<td>' + (o.expiry
          ? '<span style="' + (flag ? 'color:var(--danger);font-weight:600' : '') + '">' + esc(formatDisplayDate(o.expiry)) + '</span>'
          : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td>' + esc(o.holder || '—') + '</td>'
      + '<td class="acts"><button class="btn sm" onclick="openOpsModal(\'' + esc(o.id) + '\')">Edit</button></td>'
      + '</tr>';
  }

  cardTable(cards) {
    var self = this;
    return '<div class="section-head" style="margin-top:20px"><span class="section-title">Stored value cards &nbsp;·&nbsp; ' + cards.length + '</span></div>'
      + '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:720px">'
      + '<thead><tr><th>Type</th><th>Number</th><th class="num">Last amount</th><th>Last top-up</th><th>Held by</th><th></th></tr></thead><tbody>'
      + cards.map(function (o) { return self.cardRow(o); }).join('')
      + '</tbody></table></div></div>';
  }

  cardRow(o) {
    var flag = opNeedsEye(o);
    return '<tr class="' + (flag ? 'row-flag' : '') + '">'
      + '<td><span class="tag">' + esc(o.type) + '</span></td>'
      + '<td><div class="cell-strong num">' + esc(o.number || '—') + '</div>'
      + (o.note ? '<div class="cell-sub">' + esc(o.note) + '</div>' : '') + '</td>'
      + '<td class="num">' + (o.amount === '' || o.amount == null ? '<span style="color:var(--faint)">—</span>' : 'S$ ' + money(o.amount)) + '</td>'
      + '<td>' + (o.topup
          ? '<span style="' + (flag ? 'color:var(--danger);font-weight:600' : '') + '">' + esc(formatDisplayDate(o.topup)) + '</span>'
          : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td>' + esc(o.holder || '—') + '</td>'
      + '<td class="acts"><button class="btn sm" onclick="openOpsModal(\'' + esc(o.id) + '\')">Edit</button></td>'
      + '</tr>';
  }

  /* ── the modal ──
     The form changes shape with the card: a SIM expires, a stored value
     card carries a balance. */
  onTypeChange() {
    var sim = $('op-type').value === 'SIM Card';
    $('op-sim-block').style.display = sim ? '' : 'none';
    $('op-card-block').style.display = sim ? 'none' : '';
  }

  title(o) { return o ? 'Edit ' + (o.type || 'card') : 'Add a card'; }

  fill(o) {
    $('op-type').value = o ? (o.type || 'SIM Card') : (this.filters.type !== 'all' ? this.filters.type : 'SIM Card');
    $('op-number').value = o ? (o.number || '') : '';
    $('op-provider').value = o ? (o.provider || '') : '';
    $('op-holder').innerHTML = holderOptions(o ? o.holder : 'Office');
    $('op-expiry').value = o ? parseToYMD(o.expiry) : '';
    $('op-amount').value = o && o.amount !== '' && o.amount != null ? o.amount : '';
    $('op-topup').value = o ? parseToYMD(o.topup) : '';
    $('op-note').value = o ? (o.note || '') : '';
    $('op-delete').style.display = o ? '' : 'none';
    $('op-number-err').classList.remove('show');
    $('op-number').classList.remove('err');
    this.onTypeChange();
  }

  validate() {
    if (!$('op-number').value.trim()) return this.reject('op-number');
    return true;
  }

  collect() {
    var type = $('op-type').value, sim = type === 'SIM Card';
    return {
      type: type,
      number: $('op-number').value.trim(),
      provider: $('op-provider').value.trim(),
      holder: $('op-holder').value,
      note: $('op-note').value.trim(),
      expiry: sim ? $('op-expiry').value : '',
      amount: sim ? '' : ($('op-amount').value === '' ? '' : Number($('op-amount').value) || 0),
      topup: sim ? '' : $('op-topup').value,
      updated: todayYMD()
    };
  }

  save() { super.save(); updateCounts(); }
  remove() { super.remove(); updateCounts(); }
}

var opsScreen = new OpsScreen();

opsScreen.expose({
  renderOps:      'render',
  setOpsFilter:   'setType',
  onOpTypeChange: 'onTypeChange',
  openOpsModal:   'open',
  closeOpsModal:  'close',
  saveOpItem:     'save',
  deleteOpItem:   'remove'
});
