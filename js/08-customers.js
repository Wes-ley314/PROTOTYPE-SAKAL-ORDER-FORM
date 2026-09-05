/* ══════════════════════════════════════════════════
   CUSTOMERS
   The book: name, phone, email. Everything else about
   them hangs off their orders and invoices.

   A CrudScreen (see js/lib/00-crud-screen.js).
   ══════════════════════════════════════════════════ */

function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function findCustomer(name) {
  var k = normName(name);
  return k ? customers.find(function (c) { return normName(c.name) === k; }) : null;
}

/* Every invoice quietly files the customer, so the book fills itself. */
function rememberCustomer(v) {
  if (!v || !String(v.client || '').trim()) return null;
  var c = findCustomer(v.client);
  if (c) {
    if (v.phone) c.phone = v.phone;
    if (v.email) c.email = v.email;
    c.updated = todayYMD();
  } else {
    c = { id: uid(), name: v.client.trim(), phone: v.phone || '', email: v.email || '', note: '', updated: todayYMD() };
    customers.unshift(c);
  }
  persistCustomers();
  return c;
}

/* Their purchases, newest first — what they bought and what it came to. */
function purchaseHistory(c) {
  var k = normName(c.name);
  return invoices.filter(function (v) { return normName(v.client) === k; })
    .map(function (v) {
      var what = (v.lines || []).map(function (l) { return String(l.desc || '').trim(); })
        .filter(Boolean).join(', ');
      return { no: v.no, date: v.issued || '', total: invoiceTotal(v), what: what, orderNum: v.orderNum || '' };
    })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

function historyCell(c) {
  var h = purchaseHistory(c);
  if (!h.length) return '<span style="color:var(--faint)">Nothing yet</span>';
  var shown = h.slice(0, 4);
  var spend = h.reduce(function (a, x) { return a + x.total; }, 0);
  return shown.map(function (x) {
      return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">'
        + '<span class="num" style="color:var(--muted);min-width:82px">' + esc(x.date ? formatDisplayDate(x.date) : '—') + '</span>'
        + '<span class="num" style="min-width:74px">S$ ' + money(x.total) + '</span>'
        + (x.what ? '<span class="cell-sub" style="margin:0;flex:1 1 140px">' + esc(x.what) + '</span>' : '')
        + '</div>';
    }).join('')
    + (h.length > shown.length
        ? '<div class="cell-sub">' + (h.length - shown.length) + ' earlier · S$ ' + money(spend) + ' in all</div>'
        : (h.length > 1 ? '<div class="cell-sub">S$ ' + money(spend) + ' in all</div>' : ''));
}

class CustomersScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Customer',
      collection: 'customers',
      persist: 'persistCustomers',
      contentId: 'cust-content',
      searchId: 'cust-search',
      modalId: 'cust-modal',
      focusId: 'cs-name',
      filters: { view: 'all' },
      toasts: { removed: 'Customer removed from the book' },
      fields: {
        'cs-name': 'name', 'cs-phone': 'phone',
        'cs-email': 'email', 'cs-note': 'note'
      }
    });
  }

  setView(f) { this.setFilter('view', f, 'data-custfilter'); }

  keep(c, term) {
    if (this.filters.view === 'repeat' && purchaseHistory(c).length < 2) return false;
    if (this.filters.view === 'nocontact' && c.phone && c.email) return false;
    if (!term) return true;
    return [c.name, c.phone, c.email, c.note].some(function (v) { return hit(v, term); });
  }

  compare(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }

  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;

    var hs = customers.map(purchaseHistory);
    var repeat = hs.filter(function (h) { return h.length > 1; }).length;
    var spend = hs.reduce(function (a, h) { return a + h.reduce(function (x, y) { return x + y.total; }, 0); }, 0);

    $('cust-stats').innerHTML =
        stat('Customers', customers.length, 'Everyone you have billed')
      + stat('Repeat', repeat, repeat ? 'Bought more than once' : 'No repeats yet')
      + stat('Billed to date', 'S$ ' + money(spend), 'Across every invoice');

    var rows = this.visible();

    if (rows.length === 0) {
      el.innerHTML = customers.length === 0
        ? emptyState('No customers yet', 'Every invoice you raise files its customer here automatically. You can also add one by hand.', '<button class="btn gold" onclick="openCustModal()">+ New customer</button>')
        : emptyState('Nothing matches', 'Try a name, a phone number, or part of an email.');
      updateCounts();
      return;
    }

    el.innerHTML = this.html(rows);
    updateCounts();
  }

  html(rows) {
    var self = this;
    var body = rows.map(function (c) { return self.row(c); }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:900px">'
      + '<thead><tr><th>Name</th><th>Phone number</th><th>Email</th><th>Purchase history</th><th></th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></div></div>';
  }

  row(c) {
    return '<tr class="' + ((!c.phone || !c.email) ? 'row-flag' : '') + '">'
      + '<td style="vertical-align:top"><div class="cell-strong">' + esc(c.name) + '</div>'
      + (c.note ? '<div class="cell-sub">' + esc(c.note) + '</div>' : '') + '</td>'
      + '<td style="vertical-align:top">' + (c.phone ? esc(c.phone) : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td style="vertical-align:top">' + (c.email ? esc(c.email) : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td style="vertical-align:top">' + historyCell(c) + '</td>'
      + '<td class="acts" style="vertical-align:top">'
      + '<button class="btn sm" onclick="invoiceForCustomer(\'' + esc(c.id) + '\')">New invoice</button> '
      + '<button class="btn sm" onclick="openCustModal(\'' + esc(c.id) + '\')">Edit</button>'
      + '</td></tr>';
  }

  /* start an invoice already filled in for this customer */
  invoiceFor(id) {
    var c = this.find(id);
    if (!c) return;
    go('invoice');
    openInvoiceModal();
    $('inv-client').value = c.name;
    $('inv-phone').value = c.phone || '';
    $('inv-email').value = c.email || '';
  }

  /* ── the modal ── */
  title(c) { return c ? c.name : 'New customer'; }

  fill(c) {
    $('cs-name').value  = c ? (c.name || '') : '';
    $('cs-phone').value = c ? (c.phone || '') : '';
    $('cs-email').value = c ? (c.email || '') : '';
    $('cs-note').value  = c ? (c.note || '') : '';
    $('cs-delete').style.display = c ? '' : 'none';
    $('cs-name-err').classList.remove('show');
    $('cs-name').classList.remove('err');
  }

  validate() {
    var name = $('cs-name').value.trim();
    if (!name) return this.reject('cs-name');
    /* two people with the same name would make the book useless */
    var self = this;
    var clash = customers.find(function (c) {
      return normName(c.name) === normName(name) && c.id !== self.editId;
    });
    if (clash) { showToast(name + ' is already in the book.'); return false; }
    return true;
  }

  collect() {
    return {
      name: $('cs-name').value.trim(),
      phone: $('cs-phone').value.trim(),
      email: $('cs-email').value.trim(),
      note: $('cs-note').value.trim(),
      updated: todayYMD()
    };
  }

  save() { super.save(); updateCounts(); }
  remove() { super.remove(); updateCounts(); }

  export() {
    var rows = [['Name', 'Phone number', 'Email', 'Invoice', 'Date', 'Amount', 'Bought', 'Note']];
    customers.forEach(function (c) {
      var h = purchaseHistory(c);
      if (!h.length) { rows.push([c.name, c.phone, c.email, '', '', '', '', c.note]); return; }
      h.forEach(function (x, i) {
        rows.push([i === 0 ? c.name : '', i === 0 ? c.phone : '', i === 0 ? c.email : '',
                   x.no, x.date, x.total.toFixed(2), x.what, i === 0 ? c.note : '']);
      });
    });
    downloadCsv('sakal-customers.csv', rows);
  }
}

var customersScreen = new CustomersScreen();

customersScreen.expose({
  renderCustomers:   'render',
  setCustFilter:     'setView',
  invoiceForCustomer:'invoiceFor',
  openCustModal:     'open',
  closeCustModal:    'close',
  saveCustomer:      'save',
  deleteCustomer:    'remove',
  exportCustomers:   'export'
});
