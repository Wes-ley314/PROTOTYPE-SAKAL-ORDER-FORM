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
var MOTO_FILTER = 'Motorcycle';

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

  /* the collection is also written to by OpsSync, so edits land on the sheet */

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

    renderMotos();

    /* the Motorcycle filter hides the cards altogether */
    if (this.filters.type === MOTO_FILTER) { el.innerHTML = ''; updateCounts(); return; }

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


/* ══════════════════════════════════════════════════
   MOTORCYCLE TAX
   Whose bike, which month the yearly pajak falls in,
   and the year the plate has to be renewed.
     Punya Lia  · Pajak 07 · Plat 2030
   Drawn under the cards on the same Operation page.
   Also a CrudScreen; the rows live in `vehicles`.
   ══════════════════════════════════════════════════ */

var MONTH_NAMES = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pad2(n) { return String(n).padStart(2, '0'); }

/* months from this month to (year, month); negative = already past */
function monthsFromNow(y, m) {
  var t = new Date(todayYMD());
  return (y - t.getFullYear()) * 12 + (m - (t.getMonth() + 1));
}

/* Where the yearly pajak stands.
   Without a "paid for" year the app only knows the calendar, so it points at
   the next time the month comes round. With one, it can say it is overdue. */
function motoTax(o) {
  var m = Number(o.taxMonth) || 0;
  if (!m) return { state: 'none', label: '—' };
  var t = new Date(todayYMD()), y = t.getFullYear(), M = t.getMonth() + 1;
  var paid = Number(o.taxPaidYear) || 0;
  var lastDue = m <= M ? y : y - 1;            // most recent time the month came round
  if (paid && paid < lastDue) {
    return m === M
      ? { state: 'soon', label: 'Due this month', due: [y, m] }
      : { state: 'late', label: 'Overdue since ' + MONTH_SHORT[m - 1] + ' ' + lastDue, due: [lastDue, m] };
  }
  var ny = paid ? Math.max(lastDue + 1, paid + 1) : (m >= M ? y : y + 1);
  var gap = monthsFromNow(ny, m);
  return {
    state: gap <= 1 ? 'soon' : 'ok',
    label: gap === 0 ? 'Due this month' : 'Next ' + MONTH_SHORT[m - 1] + ' ' + ny,
    due: [ny, m]
  };
}

/* Where the plate renewal stands. The plate is renewed in the pajak month of
   its year; with no month on file, January is the cautious guess. */
function motoPlate(o) {
  var py = Number(o.plateYear) || 0;
  if (!py) return { state: 'none', label: '—' };
  var m = Number(o.taxMonth) || 1;
  var gap = monthsFromNow(py, m);
  if (gap < 0) return { state: 'late', label: 'Expired ' + MONTH_SHORT[m - 1] + ' ' + py };
  if (gap === 0) return { state: 'soon', label: 'Renew this month' };
  if (gap <= 3) return { state: 'soon', label: 'Renew ' + MONTH_SHORT[m - 1] + ' ' + py };
  var yrs = Math.floor(gap / 12), mos = gap % 12;
  return { state: 'ok', label: 'in ' + (yrs ? yrs + ' yr' + (yrs > 1 ? 's' : '') : '') + (yrs && mos ? ' ' : '') + (mos ? mos + ' mo' : '') };
}

function motoNeedsEye(o) {
  var a = motoTax(o).state, b = motoPlate(o).state;
  return a === 'late' || a === 'soon' || b === 'late' || b === 'soon';
}

function motoTone(state) {
  return state === 'late' ? 'color:var(--danger);font-weight:600'
       : state === 'soon' ? 'color:#B26A00;font-weight:600'
       : 'color:var(--faint)';
}

class MotoScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Motorcycle',
      collection: 'vehicles',
      persist: 'persistVehicles',
      contentId: 'ops-moto',
      searchId: 'ops-search',
      modalId: 'moto-modal',
      focusId: 'moto-owner',
      fields: {
        'moto-owner': 'owner', 'moto-plate': 'plate', 'moto-taxmonth': 'taxMonth',
        'moto-plateyear': 'plateYear', 'moto-paid': 'taxPaidYear', 'moto-note': 'note'
      },
      toasts: { added: 'Motorcycle added', updated: 'Motorcycle updated', removed: 'Motorcycle removed' }
    });
  }

  keep(o, term) {
    var f = opsScreen.filters.type;
    if (f !== 'all' && f !== MOTO_FILTER) return false;
    if (!term) return true;
    return [o.owner, o.plate, o.note, 'pajak', 'plat', 'motor'].some(function (v) { return hit(v, term); })
      || hit(pad2(o.taxMonth), term) || hit(o.plateYear, term)
      || hit(MONTH_NAMES[(Number(o.taxMonth) || 1) - 1], term);
  }

  compare(a, b) {
    return String(a.owner || '').localeCompare(String(b.owner || ''))
      || String(a.plate || '').localeCompare(String(b.plate || ''));
  }

  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;
    var f = opsScreen.filters.type;
    if (f !== 'all' && f !== MOTO_FILTER) { el.innerHTML = ''; return; }

    var rows = this.visible();
    if (!rows.length) {
      el.innerHTML = f === MOTO_FILTER || !this.term
        ? this.head(0, 0) + (vehicles.length === 0
            ? emptyState('No motorcycles yet', 'Log whose bike it is, the pajak month and the plate year, and this page will flag them before they are due.', '<button class="btn gold" onclick="openMotoModal()">+ Add motorcycle</button>')
            : emptyState('Nothing matches', 'Try an owner, a plate, or a month.'))
        : '';
      return;
    }
    el.innerHTML = this.head(rows.length, rows.filter(motoNeedsEye).length) + this.html(rows);
  }

  head(n, eye) {
    return '<div class="section-head" style="margin-top:20px"><span class="section-title">Motorcycle tax &nbsp;·&nbsp; ' + n
      + (eye ? ' &nbsp;·&nbsp; <span style="color:var(--danger)">' + eye + ' need' + (eye === 1 ? 's' : '') + ' a look</span>' : '')
      + '</span><button class="btn sm" onclick="openMotoModal()">+ Add motorcycle</button></div>';
  }

  html(rows) {
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:640px">'
      + '<thead><tr><th>Owner</th><th>Plate no.</th><th>Pajak (yearly)</th><th>Plat renewal</th><th></th></tr></thead><tbody>'
      + rows.map(function (o) {
          var tax = motoTax(o), plate = motoPlate(o);
          var m = Number(o.taxMonth) || 0;
          return '<tr class="' + (motoNeedsEye(o) ? 'row-flag' : '') + '">'
            + '<td><div class="cell-strong">Punya ' + esc(o.owner || '—') + '</div>'
            + (o.note ? '<div class="cell-sub">' + esc(o.note) + '</div>' : '') + '</td>'
            + '<td class="num">' + (o.plate ? esc(o.plate) : '<span style="color:var(--faint)">—</span>') + '</td>'
            + '<td><div class="cell-strong num">' + (m ? 'Pajak ' + pad2(m) : '—') + '</div>'
            + '<div class="cell-sub" style="' + motoTone(tax.state) + '">' + esc(m ? MONTH_NAMES[m - 1] + ' · ' + tax.label : '')
            + (o.taxPaidYear ? ' · paid ' + esc(o.taxPaidYear) : '') + '</div></td>'
            + '<td><div class="cell-strong num">' + (o.plateYear ? 'Plat ' + esc(o.plateYear) : '—') + '</div>'
            + '<div class="cell-sub" style="' + motoTone(plate.state) + '">' + esc(o.plateYear ? plate.label : '') + '</div></td>'
            + '<td class="acts"><button class="btn sm" onclick="openMotoModal(\'' + esc(o.id) + '\')">Edit</button></td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div></div>';
  }

  title(o) { return o ? 'Motorcycle — ' + (o.owner || '') : 'Add a motorcycle'; }

  fill(o) {
    $('moto-owner').value = o ? (o.owner || '') : '';
    $('moto-plate').value = o ? (o.plate || '') : '';
    $('moto-taxmonth').innerHTML = '<option value="">Month…</option>' + MONTH_NAMES.map(function (n, i) {
      return '<option value="' + (i + 1) + '">' + pad2(i + 1) + ' — ' + n + '</option>';
    }).join('');
    $('moto-taxmonth').value = o && o.taxMonth ? String(Number(o.taxMonth)) : '';
    $('moto-plateyear').value = o && o.plateYear ? o.plateYear : '';
    $('moto-paid').value = o && o.taxPaidYear ? o.taxPaidYear : '';
    $('moto-note').value = o ? (o.note || '') : '';
    $('moto-delete').style.display = o ? '' : 'none';
    this.clearErrors();
  }

  validate() {
    if (!$('moto-owner').value.trim()) return this.reject('moto-owner');
    if (!$('moto-taxmonth').value) return this.reject('moto-taxmonth');
    var y = Number($('moto-plateyear').value);
    if (!(y >= 2000 && y <= 2100)) return this.reject('moto-plateyear');
    return true;
  }

  collect() {
    var paid = Number($('moto-paid').value);
    return {
      owner: $('moto-owner').value.trim(),
      plate: $('moto-plate').value.trim().toUpperCase(),
      taxMonth: Number($('moto-taxmonth').value) || '',
      plateYear: Number($('moto-plateyear').value) || '',
      taxPaidYear: paid >= 2000 && paid <= 2100 ? paid : '',
      note: $('moto-note').value.trim(),
      updated: todayYMD()
    };
  }

  save() { super.save(); updateCounts(); }
  remove() { super.remove(); updateCounts(); }
}

var motoScreen = new MotoScreen();

motoScreen.expose({
  renderMotos:     'render',
  openMotoModal:   'open',
  closeMotoModal:  'close',
  saveMoto:        'save',
  deleteMoto:      'remove'
});
