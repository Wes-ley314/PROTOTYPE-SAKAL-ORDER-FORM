/* ══════════════════════════════════════════════════
   INVOICING
   Built from an order but kept separate, so editing a
   garment never quietly rewrites a bill.
   ══════════════════════════════════════════════════ */

var invFilter = 'all', invEditId = '', invLines = [], invMakeOrder = true, invStaff = '';

function invoiceSubtotal(v) { return (v.lines||[]).reduce(function(a,l){ return a + (Number(l.qty)||0) * (Number(l.unit)||0); }, 0); }
function invoiceTotal(v)    { return Math.max(0, invoiceSubtotal(v) - (Number(v.discount)||0)); }
function invoiceBalance(v)  { return invoiceTotal(v) - (Number(v.paid)||0); }
function invoiceStatus(v) {
  var tot = invoiceTotal(v), p = Number(v.paid) || 0;
  if (p >= tot - 0.005 && (tot > 0 || v.sent)) return 'Paid';
  return v.sent ? 'Sent' : 'Draft';
}
function statusTag(s) {
  var tone = {Paid:'green', Overdue:'red', 'Part paid':'gold', Sent:'blue', Draft:''}[s] || '';
  return '<span class="tag '+tone+'">'+esc(s)+'</span>';
}
function nextInvoiceNo() { return 'INV' + nextRunningNo(); }
function setInvoiceFilter(f) {
  invFilter = f;
  document.querySelectorAll('[data-invfilter]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-invfilter') === f); });
  renderInvoices();
}

function renderInvoices() {
  var el = $('invoice-content'); if (!el) return;
  var term = ($('invoice-search') ? $('invoice-search').value : '').trim().toLowerCase();

  var thisMonth = todayYMD().substring(0,7), thisYear = todayYMD().substring(0,4);
  var monthList = invoices.filter(function(v){ return String(v.issued||'').substring(0,7) === thisMonth; });
  var yearList  = invoices.filter(function(v){ return String(v.issued||'').substring(0,4) === thisYear; });
  var monthVal  = monthList.reduce(function(a,v){ return a + invoiceTotal(v); }, 0);
  var yearVal   = yearList.reduce(function(a,v){ return a + invoiceTotal(v); }, 0);
  var drafts    = invoices.filter(function(v){ return invoiceStatus(v) === 'Draft'; }).length;
  $('invoice-stats').innerHTML =
      stat('Invoices on file', invoices.length, 'Every bill raised')
    + stat('This month', 'S$ ' + money(monthVal), monthList.length + ' invoice' + (monthList.length===1?'':'s') + ' issued')
    + stat('This year', 'S$ ' + money(yearVal), yearList.length + ' invoice' + (yearList.length===1?'':'s') + ' issued')
    + stat('Drafts', drafts, drafts ? 'Not marked sent yet' : 'Nothing sitting in draft');

  var rows = invoices.filter(function(v) {
    var st = invoiceStatus(v);
    if (invFilter === 'nofloor') {
      if (v.orderNum && findOrder(v.orderNum)) return false;
    } else if (invFilter !== 'all' && st !== invFilter) return false;
    if (!term) return true;
    return [v.no, v.orderNum, v.client, v.email, v.phone, v.staff].some(function(x){ return hit(x, term); });
  }).sort(function(a,b){ return String(b.issued||'').localeCompare(String(a.issued||'')) || String(b.no||'').localeCompare(String(a.no||'')); });

  if (rows.length === 0) {
    el.innerHTML = invoices.length === 0
      ? emptyState('No invoices yet', 'Raise one from scratch, or use the Invoice button on any order to pull its garments in as line items.', '<button class="btn gold" onclick="openInvoiceModal()">+ New invoice</button>')
      : emptyState('Nothing matches', 'Try an invoice number, an order number, or the client\'s name.');
    updateCounts(); return;
  }

  var body = rows.map(function(v) {
    var st = invoiceStatus(v);
    var contact = [v.phone, v.email].filter(Boolean).join(' · ');
    var onFloor = v.orderNum && findOrder(v.orderNum);
    return '<tr>'
      + '<td><div class="cell-strong num">'+esc(v.no)+'</div><div class="cell-sub">'
      +   (onFloor ? 'Order ' + esc(v.orderNum) : 'Not on the floor')+'</div></td>'
      + '<td><div class="cell-strong">'+esc(v.client||'—')+'</div>'
      +   (contact ? '<div class="cell-sub">'+esc(contact)+'</div>' : '')
      +   (v.staff ? '<div class="cell-sub">Handled by '+esc(v.staff)+'</div>' : '')+'</td>'
      + '<td>'+esc(formatDisplayDate(v.issued))+'</td>'
      + '<td>'+esc(formatDisplayDate(v.due))+'</td>'
      + '<td class="num">S$ '+money(invoiceTotal(v))+'</td>'
      + '<td>'+statusTag(st)+'</td>'
      + '<td class="acts">'
      +   (v.sent ? '' : '<button class="btn sm" onclick="markSent(\''+esc(v.id)+'\')">Mark sent</button> ')
      +   (onFloor ? '' : '<button class="btn sm" onclick="quickOrderFromInvoice(\''+esc(v.id)+'\')">Create order</button> ')
      +   '<button class="btn sm" onclick="openInvoiceModal(\''+esc(v.id)+'\')">Edit</button>'
      + '</td></tr>';
  }).join('');

  el.innerHTML = '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:860px">'
    + '<thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Garment due</th>'
    + '<th class="num">Total</th><th>Status</th><th></th></tr></thead>'
    + '<tbody>' + body + '</tbody></table></div></div>';
  updateCounts();
  if (currentPage === 'invoice') renderPageActions('invoice');
}

function markSent(id) {
  var v = invoices.find(function(x){ return x.id === id; }); if (!v) return;
  v.sent = true; v.updated = todayYMD();
  persistInvoices(); renderInvoices(); showToast('Invoice ' + v.no + ' marked as sent');
}

/* ── Client book: everyone we already have a name for ── */
function clientBook() {
  var map = {};
  orders.concat(archivedOrders).forEach(function(o) {
    if (!o.customerName) return;
    var k = o.customerName.toLowerCase();
    map[k] = map[k] || {name:o.customerName, phone:'', email:''};
    map[k].phone = map[k].phone || o.customerContact || '';
    map[k].email = map[k].email || o.customerEmail || '';
  });
  leads.forEach(function(l) {
    if (!l.name) return;
    var k = l.name.toLowerCase();
    map[k] = map[k] || {name:l.name, phone:'', email:''};
    map[k].phone = map[k].phone || l.phone || '';
    map[k].email = map[k].email || l.email || '';
  });
  return map;
}
function refreshClientOptions() {
  var book = clientBook();
  $('client-options').innerHTML = Object.keys(book).map(function(k){ return '<option value="'+esc(book[k].name)+'">'; }).join('');
}
function onInvClientInput() {
  var v = $('inv-client').value.trim().toLowerCase();
  if (!v) return;
  var c = clientBook()[v];
  if (!c) return;
  if (!$('inv-phone').value && c.phone) $('inv-phone').value = c.phone;
  if (!$('inv-email').value && c.email) $('inv-email').value = c.email;
}

/* ── Editor ── */
function openInvoiceModal(id) {
  invEditId = id || '';
  refreshClientOptions();
  var v = id ? invoices.find(function(x){ return x.id === id; }) : null;
  $('inv-modal-title').textContent = v ? 'Invoice ' + v.no : 'New invoice ' + nextInvoiceNo();
  $('inv-modal-sub').textContent   = v ? statusPlain(v) : 'Line items, then the amount received. Nothing is sent from here.';
  $('inv-no').value       = v ? (v.no||'')       : nextInvoiceNo();
  $('inv-order').value    = v ? (v.orderNum||'') : nextRunningNo();
  $('inv-client').value   = v ? (v.client||'')   : '';
  $('inv-email').value    = v ? (v.email||'')    : '';
  $('inv-phone').value    = v ? (v.phone||'')    : '';
  $('inv-issued').value   = v ? (v.issued||'')   : todayYMD();
  $('inv-due').value      = v ? (v.due||'')      : '';
  $('inv-fitting').value  = v ? (v.fitting||'')  : '';
  $('inv-discount').value = v ? (v.discount||0)  : 0;
  $('inv-note').value     = v ? (v.note||'')     : '';
  invLines = v ? JSON.parse(JSON.stringify(v.lines||[])) : [{desc:'',qty:1,unit:''}];
  invMakeOrder = v ? (v.makeOrder !== false) : true;
  $('inv-makeorder').classList.toggle('on', invMakeOrder);
  var lastStaff = ''; try { lastStaff = localStorage.getItem('sakal-last-staff') || ''; } catch(e) {}
  setInvStaff(v ? (v.staff || '') : lastStaff);
  $('inv-delete').style.display = v ? '' : 'none';
  renderInvLines(); recalcInvoice(); updateInvOrderHint();
  $('invoice-modal').classList.add('open');
}

function toggleMakeOrder() {
  invMakeOrder = !invMakeOrder;
  $('inv-makeorder').classList.toggle('on', invMakeOrder);
  updateInvOrderHint();
}
/* The order number follows the invoice number — one job, one number. */
function onInvNoInput() {
  var digits = $('inv-no').value.replace(/\D/g, '');
  $('inv-order').value = digits;
  updateInvOrderHint();
}

/* Says exactly what saving will do to the floor. */
function updateInvOrderHint() {
  var num = $('inv-order').value.trim();
  var o = num ? findOrder(num) : null;
  var items = itemsFromLines(invLines);
  var hint = $('inv-order-hint');
  if (!invMakeOrder) {
    hint.textContent = o ? 'Order ' + num + ' stays as it is — this invoice will not touch it.'
                         : 'Nothing goes to the workshop. Use this for alterations and one-off charges.';
    return;
  }
  if (items.length === 0) {
    hint.textContent = 'No garments on these lines yet. Add one from the price list and the order builds itself.';
    return;
  }
  var list = items.map(function(i){ return i.product; }).join(' · ');
  hint.textContent = (o ? 'Saving updates order ' + num + ': ' : 'Saving opens order ' + (num || nextRunningNo()) + ': ') + list;
}
function statusPlain(v) {
  return invoiceStatus(v) + ' · S$ ' + money(invoiceTotal(v)) + ' · issued ' + formatDisplayDate(v.issued);
}
function newInvoiceFor(orderNum) {
  var o = findOrder(orderNum);
  go('invoice');
  openInvoiceModal();
  if (!o) return;
  $('inv-no').value     = 'INV' + o.orderNum;
  $('inv-order').value  = o.orderNum;
  $('inv-modal-title').textContent = 'New invoice INV' + o.orderNum;
  $('inv-client').value = o.customerName || '';
  $('inv-phone').value  = o.customerContact || '';
  $('inv-email').value  = o.customerEmail || '';
  $('inv-order').value  = o.orderNum;
  $('inv-issued').value = todayYMD();
  $('inv-due').value    = o.dueDate || '';
  invLines = (o.items||[]).map(function(it) {
    return { desc: it.product, qty: 1, unit: suggestUnit(it), garments: [it.product],
             parts: [{product: it.product, fabric: it.fabric || '', lining: it.lining || '', design: it.design || null}] };
  });
  if (invLines.length === 0) invLines = [{desc:'',qty:1,unit:''}];
  renderInvLines(); recalcInvoice(); updateInvOrderHint();
}
/* Only prices a line automatically when the cloth field actually names a
   bunch from the price list — a bare cloth number is left blank on purpose. */
function suggestUnit(it) {
  var code = String(it.fabric||'').trim().toLowerCase();
  if (code.length < 5) return '';
  var f = pricelist.find(function(p) {
    var n = String(p.name||'').trim().toLowerCase();
    return n.length >= 5 && code.indexOf(n) !== -1;
  });
  if (!f) return '';
  var map = {'Jacket':'pJ','Vest':'pV','Trousers':'pT','Overcoat':'pJ','Safari Jacket':'pJ','Shirt':'pShirt'};
  return f[map[it.product]] || '';
}

/* ══ WHAT A LINE BECOMES ═══════════════════════════
   The bill says what was sold; the order says what has
   to be made. A two piece is a jacket and trousers, a
   three piece adds the vest, and each garment is cut
   from its own cloth — so each gets its own boxes.
   ══════════════════════════════════════════════════ */
var LINE_LABELS   = {p2:'2 piece suit', p3:'3 piece suit', pJ:'Jacket', pV:'Vest', pT:'Trousers', pShirt:'Shirt', pJV:'Jacket + vest lining', pCon:'Construction'};
var LINE_GARMENTS = {
  p2: ['Jacket','Trousers'],
  p3: ['Jacket','Vest','Trousers'],
  pJ: ['Jacket'], pV: ['Vest'], pT: ['Trousers'], pShirt: ['Shirt'], pJV: [], pCon: []
};

/* For lines typed by hand, read the garments back out of the wording. */
function garmentsFromDesc(d) {
  var s = String(d||'').toLowerCase();
  // Alterations, repairs and accessories are charges, not garments to cut.
  if (/lining|alteration|alter\b|repair|remake|hem\b|taper|shorten|let out|take in|press|clean|deposit|tie\b|pocket square|cufflink|shipping|delivery/.test(s)) return [];
  if (/(^|[^\d])3\s*(pc|pcs|piece)|three\s*piece/.test(s)) return ['Jacket','Vest','Trousers'];
  if (/(^|[^\d])2\s*(pc|pcs|piece)|two\s*piece/.test(s)) return ['Jacket','Trousers'];
  var g = [];
  if (/overcoat|coat\b/.test(s)) g.push('Overcoat');
  if (/safari/.test(s)) g.push('Safari Jacket');
  if (/jacket|blazer/.test(s) && !/safari/.test(s)) g.push('Jacket');
  if (/\bvest\b|waistcoat/.test(s)) g.push('Vest');
  if (/trouser|pants|slacks/.test(s)) g.push('Trousers');
  if (/shirt/.test(s)) g.push('Shirt');
  return g;
}
function garmentsForLine(l) {
  return (l.garments && l.garments.length) ? l.garments.slice() : garmentsFromDesc(l.desc);
}

/* Keeps l.parts in step with the garments the line stands for,
   carrying over anything already typed. */
function ensureParts(l) {
  var gs = garmentsForLine(l);
  var old = (l.parts || []).slice();
  l.parts = gs.map(function(g) {
    var k = old.findIndex(function(p){ return p.product === g; });
    var carry = k > -1 ? old.splice(k, 1)[0] : null;
    return {
      product: g,
      fabric: carry ? (carry.fabric || '') : (l.fabric || ''),
      lining: carry ? (carry.lining || '') : (l.lining || ''),
      design: carry ? (carry.design || null) : null
    };
  });
  return l.parts;
}
function itemsFromLines(lines) {
  var items = [];
  (lines||[]).forEach(function(l) {
    var qty = Math.max(1, Math.round(Number(l.qty) || 1));
    var parts = ensureParts(l);
    for (var q = 0; q < qty; q++) {
      parts.forEach(function(p) {
        items.push({
          product: p.product,
          fabric: p.fabric || '',
          lining: needsLining(p.product) ? (p.lining || '') : '',
          design: p.design || null
        });
      });
    }
  });
  return items;
}

/* ── Price list search, right inside the invoice ── */
function clearInvSearch() { $('inv-search').value = ''; renderInvSearch(); $('inv-search').focus(); }

function renderInvSearch() {
  var box = $('inv-search-results');
  var term = ($('inv-search').value || '').trim().toLowerCase();
  $('inv-search-x').classList.toggle('show', !!term);
  if (term.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

  var rows = pricelist.filter(function(f) {
    return hit(f.brand, term) || hit(f.name, term) || hit(f.type, term);
  }).sort(function(a,b) {
    return String(a.brand).localeCompare(String(b.brand)) || String(a.name).localeCompare(String(b.name));
  }).slice(0, 12);

  box.style.display = '';
  if (!rows.length) {
    box.innerHTML = '<div style="padding:20px 14px;text-align:center;color:var(--faint);font-size:12.5px">'
      + 'Nothing on the price list matches that.</div>';
    return;
  }
  box.innerHTML = rows.map(function(f) {
    var keys = f.cat === 'Suiting'      ? GARMENT_KEYS
             : f.cat === 'Shirting'     ? [{k:'pShirt', l:'Shirt'}]
             : f.cat === 'Construction' ? [{k:'pCon', l:'Charge'}]
             : [{k:'pJ', l:'Jacket'}, {k:'pJV', l:'Jacket + vest'}];
    return '<div class="picker-row" style="cursor:default">'
      + '<div class="picker-top"><span class="picker-name">'+esc(f.name || f.brand)+'</span>'
      +   '<span class="tag">'+esc(f.cat)+'</span></div>'
      + '<div class="picker-brand" style="margin:2px 0 8px">'+esc(f.brand)+(f.type?' · '+esc(f.type):'')+'</div>'
      + '<div class="price-cells">' + keys.map(function(g){ return priceCell(f, g.k, g.l, true); }).join('') + '</div>'
      + '</div>';
  }).join('');
}

/* Tapping the chip that is already chosen clears it; opening the form
   with a value (from a saved invoice, or the last person used) sets it
   outright without that toggle. */
function toggleInvStaff(name) { setInvStaff(invStaff === name ? '' : name); }
function setInvStaff(name) {
  invStaff = name || '';
  document.querySelectorAll('#inv-staff-chips .chip').forEach(function(b) {
    b.classList.toggle('on', b.getAttribute('data-staff') === invStaff);
  });
}

/* One tap on a price adds a line — from the price list page or the picker. */
function quoteFrom(fid, key) {
  var f = pricelist.find(function(x){ return x.id === fid; }); if (!f) return;
  var unit = Number(f[key]) || 0;
  if (!unit) return;
  var cloth = [f.brand, f.name].filter(Boolean).join(' ');
  // A construction charge is its own line — no cloth, no garment.
  var desc = (key === 'pCon') ? f.name : cloth + ' — ' + LINE_LABELS[key];
  var open = $('invoice-modal').classList.contains('open');
  if (!open) { go('invoice'); openInvoiceModal(); }
  var sb = $('inv-search'); if (sb) { sb.value = ''; renderInvSearch(); }
  if (invLines.length === 1 && !String(invLines[0].desc||'').trim() && !Number(invLines[0].unit)) invLines = [];
  var line = {desc:desc, qty:1, unit:unit, garments:(LINE_GARMENTS[key]||[]).slice(), bunch:cloth};
  ensureParts(line);
  invLines.push(line);
  renderInvLines(); recalcInvoice(); updateInvOrderHint();
  showToast('Added ' + (key === 'pCon' ? f.name : LINE_LABELS[key]) + ' — S$ ' + money0(unit));
}

function partRows(i, l) {
  var parts = ensureParts(l);
  if (!parts.length) return '';
  return parts.map(function(p, j) {
    return '<div style="border-top:1px solid var(--line-soft);margin-top:9px;padding-top:9px">'
      + '<div class="cloth-name" style="margin-bottom:7px">'+esc(p.product)+'</div>'
      + '<div class="cloth-row"><label>Fabric</label>'
      +   '<input type="text" placeholder="Fabric no. for the '+esc(p.product.toLowerCase())+'" '
      +   'class="'+(p.fabric?'':'want')+'" value="'+esc(p.fabric||'')+'" '
      +   'oninput="editPart('+i+','+j+',\'fabric\',this.value)"></div>'
      + (needsLining(p.product)
          ? '<div class="cloth-row"><label>Lining</label>'
            + '<input type="text" placeholder="Lining no." class="'+(p.lining?'':'want')+'" '
            + 'value="'+esc(p.lining||'')+'" oninput="editPart('+i+','+j+',\'lining\',this.value)"></div>'
          : '')
      + (p.product === 'Jacket'
          ? '<div class="cloth-row" style="margin-top:8px"><label>Design</label>'
            + '<div style="flex:1;display:flex;align-items:center;gap:9px;flex-wrap:wrap">'
            + designButton('invoice', i, j, p.design, 'Jacket')
            + '<span class="inline-note">' + (hasDesign(p.design) ? esc(p.design.code) : 'The suit order form for this jacket') + '</span>'
            + '</div></div>'
          : '')
      + '</div>';
  }).join('');
}

function renderInvLines() {
  $('inv-lines-body').innerHTML = invLines.map(function(l, i) {
    var gs = garmentsForLine(l);
    var amt = (Number(l.qty)||0) * (Number(l.unit)||0);
    return '<div class="cloth-card">'
      + '<div class="cloth-head"><span class="cloth-name" id="inv-gtag-'+i+'">'
      +   (gs.length ? esc(gs.join(' · ')) : 'Charge only — no garment') + '</span>'
      +   '<button class="icon-btn danger" onclick="removeInvLine('+i+')" aria-label="Remove line">'
      +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'
      + '<div class="cloth-row"><label>Item</label><input type="text" placeholder="Two piece suit, half canvas" '
      +   'value="'+esc(l.desc||'')+'" oninput="editInvLine('+i+',\'desc\',this.value)"></div>'
      + '<div class="row3" style="margin-top:7px">'
      +   '<div><label class="field-label">Qty</label><input class="field num" type="number" min="0" step="1" style="height:40px;text-align:right" '
      +     'value="'+esc(l.qty)+'" oninput="editInvLine('+i+',\'qty\',this.value)"></div>'
      +   '<div><label class="field-label">Unit (S$)</label><input class="field num" type="number" min="0" step="0.01" style="height:40px;text-align:right" '
      +     'placeholder="0.00" value="'+esc(l.unit)+'" oninput="editInvLine('+i+',\'unit\',this.value)"></div>'
      +   '<div><label class="field-label">Amount</label><div class="field num" id="inv-amt-'+i+'" '
      +     'style="height:40px;display:flex;align-items:center;justify-content:flex-end;background:var(--card-2);color:var(--muted)">S$ '+money(amt)+'</div></div>'
      + '</div>'
      + '<div id="inv-parts-'+i+'">' + partRows(i, l) + '</div>'
      + '</div>';
  }).join('');
}

function editPart(i, j, k, v) {
  var parts = ensureParts(invLines[i]);
  if (!parts[j]) return;
  parts[j][k] = v;
  updateInvOrderHint();
}

/* The description drives which garments a line stands for, so redraw
   its fabric boxes when the wording changes. */
function refreshLineMeta(i) {
  var l = invLines[i], gs = garmentsForLine(l);
  var tag = $('inv-gtag-'+i); if (!tag) return;
  tag.textContent = gs.length ? gs.join(' · ') : 'Charge only — no garment';
  var before = (l.parts || []).map(function(p){ return p.product; }).join('|');
  ensureParts(l);
  var after = l.parts.map(function(p){ return p.product; }).join('|');
  if (before !== after) $('inv-parts-'+i).innerHTML = partRows(i, l);
}

function editInvLine(i, k, v) {
  invLines[i][k] = v;
  if (k === 'desc') refreshLineMeta(i);
  if (k === 'qty' || k === 'unit') {
    var amt = (Number(invLines[i].qty)||0) * (Number(invLines[i].unit)||0);
    var cell = $('inv-amt-'+i); if (cell) cell.textContent = 'S$ ' + money(amt);
  }
  recalcInvoice(); updateInvOrderHint();
}
function addInvLine()    { invLines.push({desc:'',qty:1,unit:''}); renderInvLines(); recalcInvoice(); updateInvOrderHint(); }
function removeInvLine(i){ invLines.splice(i,1); if (!invLines.length) invLines = [{desc:'',qty:1,unit:''}]; renderInvLines(); recalcInvoice(); updateInvOrderHint(); }

function recalcInvoice() {
  var draft = { lines: invLines, discount: Number($('inv-discount').value)||0 };
  var sub = invoiceSubtotal(draft), disc = draft.discount, tot = invoiceTotal(draft);
  $('inv-totals').innerHTML =
      '<div class="total-row"><span>Subtotal</span><span>S$ '+money(sub)+'</span></div>'
    + (disc ? '<div class="total-row"><span>Discount</span><span>− S$ '+money(disc)+'</span></div>' : '')
    + '<div class="total-row grand"><span>Total</span><span>S$ '+money(tot)+'</span></div>';
}

function saveInvoice() {
  var client = $('inv-client').value.trim();
  var lines = invLines.filter(function(l){ return String(l.desc||'').trim() || Number(l.unit); });
  if (!client && !lines.length) { showToast('Add a client or at least one line item.'); return; }

  // Same rule as the Orders tab: nothing reaches the bench without its
  // fabric, and a lined garment needs its lining too.
  if (invMakeOrder) {
    var gap = '';
    lines.forEach(function(l) {
      ensureParts(l).forEach(function(p) {
        if (!gap && !String(p.fabric||'').trim()) gap = p.product + ' fabric';
        if (!gap && needsLining(p.product) && !String(p.lining||'').trim()) gap = p.product + ' lining';
      });
    });
    if (gap) {
      showToast('Fill in the ' + gap.toLowerCase() + ' before saving, or switch the workshop off.');
      renderInvLines(); return;
    }
  }

  var no = $('inv-no').value.trim() || nextInvoiceNo();
  if (invoices.some(function(x){ return x.no === no && x.id !== invEditId; })) {
    showToast('Invoice ' + no + ' already exists. Use another number.'); $('inv-no').focus(); return;
  }
  var orderNum = $('inv-order').value.trim() || no.replace(/\D/g, '');

  var payload = {
    no: no, client: client, email: $('inv-email').value.trim(), phone: $('inv-phone').value.trim(),
    staff: invStaff, orderNum: orderNum,
    issued: $('inv-issued').value, due: $('inv-due').value, fitting: $('inv-fitting').value,
    lines: lines.length ? lines : invLines,
    discount: Number($('inv-discount').value)||0,
    note: $('inv-note').value.trim(), makeOrder: invMakeOrder, updated: todayYMD()
  };

  try { localStorage.setItem('sakal-last-staff', invStaff); } catch(e) {}
  var saved;
  if (invEditId) {
    var i = invoices.findIndex(function(x){ return x.id === invEditId; });
    if (i > -1) { invoices[i] = Object.assign(invoices[i], payload); saved = invoices[i]; }
  } else {
    payload.id = uid(); payload.sent = false; payload.imported = false; payload.paid = 0;
    invoices.unshift(payload); saved = payload;
  }

  rememberCustomer(saved);
  var result = feedOrderFromInvoice(saved);
  persistInvoices(); closeInvoiceModal(); renderInvoices(); renderOrders(); updateCounts();

  if (result && result.created) showToast('Invoice ' + saved.no + ' saved — order ' + result.order.orderNum + ' opened');
  else if (result)             showToast('Invoice ' + saved.no + ' saved — order ' + result.order.orderNum + ' updated');
  else                         showToast(invEditId ? 'Invoice ' + saved.no + ' updated' : 'Invoice ' + saved.no + ' created');
}

/* ══════════════════════════════════════════════════
   INVOICE → ORDER
   The bill says what was sold; the order says what has to
   be made. A two piece becomes a jacket and trousers, a
   three piece adds the vest, and each garment gets its own
   row so it can move through the shop on its own.
   ══════════════════════════════════════════════════ */
function feedOrderFromInvoice(v) {
  if (!v || v.makeOrder === false) return null;
  var items = itemsFromLines(v.lines);
  if (!items.length) return null;
  var num = String(v.orderNum || '').trim() || String(v.no || '').replace(/\D/g, '');
  if (!num) return null;

  var ex = orders.find(function(o){ return o.orderNum === num; })
        || archivedOrders.find(function(o){ return o.orderNum === num; });

  if (ex) {
    // Rebuild the garment list but never lose where a garment has got to.
    var pool = (ex.items || []).slice();
    ex.items = items.map(function(it) {
      var k = pool.findIndex(function(p){ return p.product === it.product; });
      var carry = k > -1 ? pool.splice(k, 1)[0] : null;
      return {
        product: it.product,
        fabric:  it.fabric  || (carry ? carry.fabric  : ''),
        lining:  it.lining  || (carry ? carry.lining  : ''),
        design:  it.design  || (carry ? carry.design  : null),
        status:  carry ? carry.status : '',
        paid:    carry ? carry.paid   : false,
        invoice: true,
        stuck:   carry ? carry.stuck  : false
      };
    });
    if (v.client) ex.customerName    = v.client;
    if (v.phone)  ex.customerContact = v.phone;
    if (v.email)  ex.customerEmail   = v.email;
    if (v.due)     ex.dueDate     = v.due;
    if (v.fitting) ex.fittingDate = v.fitting;
    syncToServer(ex);
    return {order: ex, created: false};
  }

  var o = {
    orderNum: num,
    customerName: v.client || '', customerContact: v.phone || '', customerEmail: v.email || '',
    dueDate: v.due || '', fittingDate: v.fitting || '',
    items: items.map(function(it) {
      return {product:it.product, fabric:it.fabric, lining:it.lining, design:it.design||null,
              status:'', paid:false, invoice:true, stuck:false};
    }),
    date: todayYMD(), fitted: 0,
    remarks: v.note || ('Raised from invoice ' + v.no), staff: v.staff || '', archived: false
  };
  orders.unshift(o);
  syncToServer(o);
  return {order: o, created: true};
}

function deleteInvoice() {
  if (!invEditId) return;
  invoices = invoices.filter(function(x){ return x.id !== invEditId; });
  persistInvoices(); closeInvoiceModal(); renderInvoices(); showToast('Invoice deleted');
}
function closeInvoiceModal() { $('invoice-modal').classList.remove('open'); invEditId = ''; }

/* ══════════════════════════════════════════════════
   INVOICES WITHOUT ORDERS
   An invoice number is an order number. Anything billed
   but never opened on the floor shows up here so it can
   be put right — one at a time, or the whole backlog.
   ══════════════════════════════════════════════════ */

var importPush = true;

function invoiceOrderNo(v) {
  return String(v.orderNum || '').trim() || String(v.no || '').replace(/\D/g, '');
}
function invoicesWithoutOrders(fromDate) {
  return invoices.filter(function(v) {
    var num = invoiceOrderNo(v);
    if (!num) return false;
    if (findOrder(num)) return false;
    if (fromDate && String(v.issued || '') < fromDate) return false;
    return true;
  });
}

/* Builds the order an invoice implies. Journal imports carry no garment
   breakdown, so the order opens empty and the value goes in the note. */
function orderFromInvoiceRecord(v) {
  var items = itemsFromLines(v.lines);
  var note = 'Invoice ' + v.no + ' · S$ ' + money(invoiceTotal(v));
  if (!items.length) note += ' · garments not itemised on the invoice';
  return {
    orderNum: invoiceOrderNo(v),
    customerName: v.client || '', customerContact: v.phone || '', customerEmail: v.email || '',
    dueDate: v.due || '', fittingDate: v.fitting || '',
    items: items.map(function(it) {
      return {product:it.product, fabric:it.fabric, lining:it.lining, design:it.design||null,
              status:'', paid:false, invoice:true, stuck:false};
    }),
    date: v.issued || todayYMD(), fitted: 0, remarks: note, staff: v.staff || '', archived: false
  };
}

/* One invoice, one order — the button on the row. */
function quickOrderFromInvoice(id) {
  var v = invoices.find(function(x){ return x.id === id; }); if (!v) return;
  var num = invoiceOrderNo(v);
  if (!num) { showToast('This invoice has no number to build an order from.'); return; }
  if (findOrder(num)) { showToast('Order ' + num + ' is already on the floor.'); return; }
  var o = orderFromInvoiceRecord(v);
  orders.unshift(o);
  v.orderNum = num; v.makeOrder = true;
  persistInvoices(); syncToServer(o);
  renderOrders(); renderInvoices(); renderPageActions('invoice'); updateCounts();
  showToast('Order ' + num + ' opened for ' + (v.client || 'this invoice'));
}

/* ── The backlog ── */
function openImportModal() {
  var all = invoicesWithoutOrders('');
  if (!all.length) { showToast('Every invoice already has an order.'); return; }
  var dates = all.map(function(v){ return v.issued || ''; }).filter(Boolean).sort();
  $('imp-from').value = dates[0] || '';
  $('imp-archive').value = '30';
  importPush = true; $('imp-push').classList.add('on');
  refreshImportPreview();
  $('import-modal').classList.add('open');
}
function closeImportModal() { $('import-modal').classList.remove('open'); }
function toggleImportPush() {
  importPush = !importPush;
  $('imp-push').classList.toggle('on', importPush);
  $('imp-push-note').textContent = importPush
    ? 'Recommended. The sheet is where orders live — anything not written there disappears the next time the app refreshes.'
    : 'These orders will sit on this device only, and will be gone the next time the app reloads from the sheet.';
  refreshImportPreview();
}
function importCutoff() {
  var days = parseInt($('imp-archive').value, 10) || 0;
  if (!days) return '';
  var d = new Date(); d.setDate(d.getDate() - days);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function refreshImportPreview() {
  var list = invoicesWithoutOrders($('imp-from').value);
  var cut = importCutoff();
  var old = cut ? list.filter(function(v){ return String(v.issued||'') < cut; }).length : 0;
  var floor = list.length - old;
  var withGarments = list.filter(function(v){ return itemsFromLines(v.lines).length; }).length;
  $('imp-go').textContent = list.length ? 'Create ' + list.length + ' order' + (list.length===1?'':'s') : 'Nothing to create';
  $('imp-go').disabled = !list.length;
  $('imp-preview').innerHTML = list.length
    ? '<strong>' + list.length + ' order' + (list.length===1?'':'s') + '</strong> will be created — '
      + floor + ' on the floor, ' + old + ' straight to the Archive. '
      + withGarments + ' of them carry a garment breakdown; the rest open empty with the invoice value in the note.'
      + (importPush ? ' They will be written to the Google Sheet one by one, which takes a moment.' : '')
    : 'Nothing matches those dates.';
}

async function runInvoiceImport() {
  var list = invoicesWithoutOrders($('imp-from').value);
  if (!list.length) return;
  var cut = importCutoff();
  closeImportModal();

  list.sort(function(a,b){ return String(a.issued||'').localeCompare(String(b.issued||'')); });

  quietSync = true;
  var made = 0, failed = 0;
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (findOrder(invoiceOrderNo(v))) continue;
    var o = orderFromInvoiceRecord(v);
    if (cut && String(v.issued||'') < cut) { o.archived = true; archivedOrders.push(o); }
    else { orders.unshift(o); }
    v.orderNum = o.orderNum;
    made++;
    if (importPush) {
      lastSyncTime = Date.now();
      setSync('warn', 'Writing order ' + made + ' of ' + list.length + '…');
      var ok = await _doSync(Object.assign({}, o, {baseVersion:''}), false);
      if (!ok) failed++;
      await new Promise(function(r){ setTimeout(r, 220); });
    }
  }
  quietSync = false;

  persistInvoices(); saveToLocalStorage();
  renderAll(); renderPageActions(currentPage);
  setSync(failed ? 'bad' : '', failed ? failed + ' could not be written' : 'All changes saved');
  showToast(made + ' order' + (made===1?'':'s') + ' created'
    + (failed ? ' — ' + failed + ' did not reach the sheet' : ''));
}
