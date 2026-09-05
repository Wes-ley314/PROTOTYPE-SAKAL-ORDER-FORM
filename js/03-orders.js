/* ══ GARMENT RULES ═════════════════════════════════ */
function getStatusStates(p) {
  if (NO_DELTA_PRODUCTS.indexOf(p) !== -1) return STATUS_STATES_NO_DELTA;
  if (NO_BATAM_PRODUCTS.indexOf(p) !== -1) return STATUS_STATES_NO_BATAM;
  return ['','Fabric Ordered','Bin','Batam','Delta','In-store','Take Home'];
}
function needsLining(p) { return NEEDS_LINING.indexOf(p) !== -1; }

/* ══ FITTING THREAD ════════════════════════════════ */
function threadHtml(o, idx, isArchive) {
  var fitted = o.fitted || 0, dates = o.fittedDates || {};
  var tone = ['','s1','s2','s3'];
  var editFn = isArchive ? 'editArcTlDate' : 'editTlDate';
  var advFn  = isArchive ? 'toggleArchiveFitted' : 'toggleOrderFitted';
  var cutFn  = isArchive ? 'deleteArcTlDot' : 'deleteTlDot';
  var html = '<div class="thread">';
  for (var k = 0; k < 3; k++) {
    var level = k+1, lit = k < fitted, next = level === fitted + 1;
    var d = dates[level] ? shortDate(dates[level]) : '';
    var click = lit  ? 'onclick="event.stopPropagation();'+editFn+'('+idx+','+level+')"'
              : next ? 'onclick="event.stopPropagation();'+advFn+'('+idx+')"' : '';
    html += '<div class="thread-stage'+(lit?' done':'')+(lit||next?' tap':'')+'" '+click+' title="'+esc(TL_LABELS[level])+'">'
         +    '<div class="notch '+(lit?tone[level]:'')+'"></div>'
         +    '<span class="thread-date">'+esc(d)+'</span>'
         +    '<span class="thread-name">'+esc(TL_SHORT[level])+'</span>'
         +    (lit && level === fitted
                   ? '<button class="thread-cut" title="Undo this fitting" onclick="event.stopPropagation();'+cutFn+'('+idx+','+level+')">✕</button>'
                   : '<span class="thread-spacer"></span>')
         + '</div>';
  }
  return html + '</div>';
}

function statusClass(s) {
  return {'Fabric Ordered':'st-fabric','Bin':'st-bin','Batam':'st-batam','Delta':'st-delta','In-store':'st-store','Take Home':'st-home'}[s] || '';
}
function statusLabel(s) {
  return {'Fabric Ordered':'Cloth ordered','Bin':'Bin','Batam':'Batam','Delta':'Delta','In-store':'In-store','Take Home':'Take home'}[s] || 'Not started';
}
function toggleItemStatus(oi, ii, field) {
  var item = orders[oi].items[ii];
  if (field === 'status') {
    var states = getStatusStates(item.product), cur = states.indexOf(item.status);
    item.status = states[cur === -1 ? 0 : (cur+1) % states.length];
  } else { item[field] = !item[field]; }
  renderOrders(); updateCounts(); syncToServer(orders[oi]);
}
function toggleArchiveItemPaid(ai, ii) {
  archivedOrders[ai].items[ii].paid = !archivedOrders[ai].items[ii].paid;
  renderArchive(); syncToServer(archivedOrders[ai]);
}

function toggleOrderFitted(oi) {
  var current = orders[oi].fitted || 0, next = current + 1;
  if (next > 3) return;
  tlPendingOi = oi; tlPendingNext = next; tlEditingExisting = false; arcTlPendingIdx = -1;
  $('tl-title').textContent = TL_LABELS[next];
  $('tl-sub').textContent = 'Order ' + orders[oi].orderNum + (orders[oi].customerName ? ' · ' + orders[oi].customerName : '');
  $('tl-date').value = todayYMD();
  $('tl-modal').classList.add('open');
}
function editTlDate(oi, level) {
  tlPendingOi = oi; tlPendingNext = level; tlEditingExisting = true; arcTlPendingIdx = -1;
  $('tl-title').textContent = TL_LABELS[level];
  $('tl-sub').textContent = 'Change the date recorded for this fitting.';
  $('tl-date').value = (orders[oi].fittedDates || {})[level] || '';
  $('tl-modal').classList.add('open');
}
function toggleArchiveFitted(ai) {
  var o = archivedOrders[ai]; if (!o) return;
  var next = (o.fitted || 0) + 1; if (next > 3) return;
  arcTlPendingIdx = ai; arcTlPendingNext = next; arcTlEditingExisting = false; tlPendingOi = -1;
  $('tl-title').textContent = TL_LABELS[next];
  $('tl-sub').textContent = 'Order ' + o.orderNum;
  $('tl-date').value = todayYMD();
  $('tl-modal').classList.add('open');
}
function editArcTlDate(ai, level) {
  arcTlPendingIdx = ai; arcTlPendingNext = level; arcTlEditingExisting = true; tlPendingOi = -1;
  $('tl-title').textContent = TL_LABELS[level];
  $('tl-sub').textContent = 'Change the date recorded for this fitting.';
  $('tl-date').value = (archivedOrders[ai].fittedDates || {})[level] || '';
  $('tl-modal').classList.add('open');
}
function closeTlModal() {
  $('tl-modal').classList.remove('open');
  tlPendingOi = -1; tlPendingNext = 0; tlEditingExisting = false;
  arcTlPendingIdx = -1; arcTlPendingNext = 0; arcTlEditingExisting = false;
}
function saveTlModal() {
  var dateVal = $('tl-date').value;
  if (!dateVal) { showToast('Pick a date first.'); return; }
  if (arcTlPendingIdx >= 0) {
    var ao = archivedOrders[arcTlPendingIdx];
    if (!ao.fittedDates) ao.fittedDates = {};
    if (!arcTlEditingExisting) ao.fitted = arcTlPendingNext;
    ao.fittedDates[arcTlPendingNext] = dateVal;
    var _ai = arcTlPendingIdx; closeTlModal(); renderArchive(); syncToServer(archivedOrders[_ai]);
    return;
  }
  if (tlPendingOi < 0) return;
  if (!tlEditingExisting) orders[tlPendingOi].fitted = tlPendingNext;
  if (!orders[tlPendingOi].fittedDates) orders[tlPendingOi].fittedDates = {};
  orders[tlPendingOi].fittedDates[tlPendingNext] = dateVal;
  var _oi = tlPendingOi; closeTlModal(); renderOrders(); syncToServer(orders[_oi]);
}
function deleteTlDot(oi, level) {
  if (!orders[oi].fittedDates) orders[oi].fittedDates = {};
  for (var l = level; l <= 3; l++) delete orders[oi].fittedDates[l];
  orders[oi].fitted = level - 1; renderOrders(); syncToServer(orders[oi]);
}
function deleteArcTlDot(ai, level) {
  var o = archivedOrders[ai]; if (!o) return;
  if (!o.fittedDates) o.fittedDates = {};
  for (var l = level; l <= 3; l++) delete o.fittedDates[l];
  o.fitted = level - 1; renderArchive(); syncToServer(o);
}

/* ══ INLINE DATE EDIT ══════════════════════════════ */
function openInlineDate(cell) {
  cell.querySelector('.meta-val').style.display = 'none';
  var p = cell.querySelector('input[type=date]');
  p.style.display = 'inline-block'; p.focus();
  try { p.showPicker(); } catch(e) {}
}
function saveInlineDate(idx, type, picker) {
  if (type === 'due') orders[idx].dueDate = picker.value; else orders[idx].fittingDate = picker.value;
  renderOrders(); syncToServer(orders[idx]);
}
function cancelInlineDate() { setTimeout(renderOrders, 150); }

/* ══ DELETE / ARCHIVE ══════════════════════════════ */
function deleteOrder(idx) {
  delPendingType='order'; delPendingOi=idx;
  $('del-msg').textContent = 'Order ' + orders[idx].orderNum + ' will be removed from the sheet. This cannot be undone — archive it instead if you might need it later.';
  $('del-modal').classList.add('open');
}
function deleteArchiveOrder(ai) {
  delPendingType='archive'; delPendingOi=ai;
  $('del-msg').textContent = 'Archived order ' + archivedOrders[ai].orderNum + ' will be removed from the sheet for good.';
  $('del-modal').classList.add('open');
}
function deleteItem(oi, ii) {
  delPendingType='item'; delPendingOi=oi; delPendingIi=ii;
  var o = orders[oi];
  $('del-msg').textContent = o.items.length === 1
    ? 'That is the only garment on order ' + o.orderNum + ', so the whole order goes with it.'
    : 'Remove the ' + o.items[ii].product.toLowerCase() + ' from order ' + o.orderNum + '?';
  $('del-modal').classList.add('open');
}
function closeDelModal() { $('del-modal').classList.remove('open'); delPendingType=''; delPendingOi=-1; delPendingIi=-1; }
function confirmDelete() {
  if (delPendingType === 'order') {
    var o = orders[delPendingOi]; orders.splice(delPendingOi,1); syncToServer(o,true); closeDelModal(); renderOrders(); updateCounts();
  } else if (delPendingType === 'item') {
    var o2 = orders[delPendingOi];
    if (o2.items.length === 1) { orders.splice(delPendingOi,1); syncToServer(o2,true); }
    else { o2.items.splice(delPendingIi,1); syncToServer(o2); }
    closeDelModal(); renderOrders(); updateCounts();
  } else if (delPendingType === 'archive') {
    var o3 = archivedOrders[delPendingOi]; archivedOrders.splice(delPendingOi,1); syncToServer(o3,true); closeDelModal(); renderArchive(); updateCounts();
  }
}
function archiveOrder(idx) {
  archivePendingIdx = idx; restorePendingIdx = -1;
  var o = orders[idx];
  $('confirm-title').textContent = 'Archive this order?';
  $('confirm-msg').innerHTML = 'Order <strong>'+esc(o.orderNum)+'</strong> moves to the archive. You can bring it back any time.';
  var b = $('confirm-go'); b.textContent = 'Archive'; b.className = 'btn btn-ink'; b.onclick = doArchive;
  $('confirm-modal').classList.add('open');
}
function doArchive() {
  if (archivePendingIdx < 0) return;
  var o = orders[archivePendingIdx]; o.archived = true;
  archivedOrders.unshift(o); orders.splice(archivePendingIdx,1);
  archivePendingIdx = -1; closeConfirmModal();
  renderOrders(); renderArchive(); updateCounts(); syncToServer(o);
  showToast('Order ' + o.orderNum + ' archived');
}
function confirmRestore(ai) {
  restorePendingIdx = ai; archivePendingIdx = -1;
  var o = archivedOrders[ai];
  $('confirm-title').textContent = 'Bring this order back?';
  $('confirm-msg').innerHTML = 'Order <strong>'+esc(o.orderNum)+'</strong> returns to the active list.';
  var b = $('confirm-go'); b.textContent = 'Restore'; b.className = 'btn btn-ok'; b.onclick = doRestore;
  $('confirm-modal').classList.add('open');
}
function doRestore() {
  if (restorePendingIdx < 0) return;
  var o = archivedOrders[restorePendingIdx]; o.archived = false;
  orders.unshift(o); archivedOrders.splice(restorePendingIdx,1);
  restorePendingIdx = -1; closeConfirmModal();
  renderOrders(); renderArchive(); updateCounts(); syncToServer(o);
  showToast('Order ' + o.orderNum + ' restored');
}
function closeConfirmModal() { $('confirm-modal').classList.remove('open'); archivePendingIdx=-1; restorePendingIdx=-1; }

/* ══ EDIT MODAL ════════════════════════════════════ */
function openEditModal(idx) {
  editIdx = idx; var o = orders[idx];
  $('modal-ordernum').value        = o.orderNum;
  $('modal-customername').value    = o.customerName || '';
  $('modal-customercontact').value = o.customerContact || '';
  $('modal-customeremail').value   = o.customerEmail || '';
  $('modal-duedate').value         = o.dueDate || '';
  $('modal-fittingdate').value     = o.fittingDate || '';
  $('modal-remarks').value         = o.remarks || '';
  renderModalItems(o.items || []);
  $('edit-modal').classList.add('open');
}
function closeEditModal() { $('edit-modal').classList.remove('open'); editIdx = -1; }
function saveEditModal() {
  if (editIdx < 0) return;
  var newNum = $('modal-ordernum').value.trim();
  if (!newNum) { showToast('The order needs a number.'); return; }
  var o = orders[editIdx];
  var oldNum = o.orderNum;
  o.orderNum        = newNum;
  o.customerName    = $('modal-customername').value.trim();
  o.customerContact = $('modal-customercontact').value.trim();
  o.customerEmail   = $('modal-customeremail').value.trim();
  o.dueDate         = $('modal-duedate').value;
  o.fittingDate     = $('modal-fittingdate').value;
  o.remarks         = $('modal-remarks').value.trim();
  o.items           = getModalItems();
  var _ei = editIdx; closeEditModal(); renderOrders(); updateCounts(); syncToServer(orders[_ei]);
}
function renderModalItems(items) {
  var html = '';
  items.forEach(function(item,i) {
    html += '<div class="cloth-card"><div class="cloth-head">'
      + '<select class="field modal-item-product" data-idx="'+i+'" style="height:40px;flex:1">'
      + PRODUCTS.map(function(p){ return '<option value="'+esc(p)+'"'+(p===item.product?' selected':'')+'>'+esc(p)+'</option>'; }).join('')
      + '</select>'
      + '<button class="icon-btn danger" style="margin-left:9px" onclick="removeModalItem('+i+')" aria-label="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'
      + '<div class="cloth-row"><label>Cloth</label><input type="text" class="modal-item-fabric" value="'+esc(item.fabric||'')+'"></div>'
      + '<div class="cloth-row"><label>Lining</label><input type="text" class="modal-item-lining" placeholder="Lining no." value="'+esc(item.lining||'')+'"></div>'
      + '</div>';
  });
  $('modal-items').innerHTML = html + '<button class="btn sm" style="width:100%;margin-top:4px" onclick="addModalItem()">+ Add garment</button>';
}
function addModalItem()   { var i = getModalItems(); i.push({product:'Jacket',fabric:'',lining:'',status:'',paid:false,invoice:false,stuck:false}); renderModalItems(i); }
function removeModalItem(idx) { var i = getModalItems(); i.splice(idx,1); renderModalItems(i); }
function getModalItems() {
  var c = $('modal-items');
  var p = c.querySelectorAll('.modal-item-product'), f = c.querySelectorAll('.modal-item-fabric'), l = c.querySelectorAll('.modal-item-lining');
  var ex = editIdx >= 0 ? (orders[editIdx].items || []) : [], items = [];
  for (var i = 0; i < p.length; i++) {
    items.push({
      product: p[i].value,
      fabric: f[i] ? f[i].value.trim() : '',
      lining: l[i] ? l[i].value.trim() : '',
      status: (ex[i]||{}).status || '', paid: (ex[i]||{}).paid || false,
      invoice: (ex[i]||{}).invoice || false, stuck: (ex[i]||{}).stuck || false
    });
  }
  return items;
}

/* ══ ORDERS LIST ═══════════════════════════════════ */
function clientLine(o) {
  var name = o.customerName || '', phone = o.customerContact || '', email = o.customerEmail || '';
  if (!name && !phone && !email) return '';
  var h = '';
  if (name)  h += '<div class="meta-cell"><span class="meta-key">Client</span><span class="meta-val">'+esc(name)+'</span></div>';
  if (phone) h += '<div class="meta-cell"><span class="meta-key">Phone</span><span class="meta-val soft">'+esc(phone)+'</span></div>';
  if (email) h += '<div class="meta-cell"><span class="meta-key">Email</span><span class="meta-val soft">'+esc(email)+'</span></div>';
  return h;
}

function renderOrders() {
  var el = $('orders-content'); if (!el) return;
  var term = ($('order-search') ? $('order-search').value : '').trim().toLowerCase();
  var x = $('order-search-x'); if (x) x.classList.toggle('show', !!term);
  var hasPF = Object.keys(activeProductFilters).some(function(k){ return activeProductFilters[k]; });

  var rows = orders.map(function(o,i){ return {order:o, idx:i}; }).filter(function(e) {
    var o = e.order, items = o.items || [];
    if (hasPF && !items.some(function(it){ return activeProductFilters[it.product]; })) return false;
    if (activeStatusFilter && !items.some(function(it){ return it.status === activeStatusFilter; })) return false;
    if (activeStuckFilter  && !items.some(function(it){ return it.stuck; })) return false;
    if (activeUnpaidFilter && !items.some(function(it){ return !it.paid; })) return false;
    if (filterOrderedFrom && (o.date||'') < filterOrderedFrom) return false;
    if (filterOrderedTo   && (o.date||'') > filterOrderedTo)   return false;
    if (filterDueFrom && (o.dueDate||'') < filterDueFrom) return false;
    if (filterDueTo   && (o.dueDate||'') > filterDueTo)   return false;
    if (!term) return true;
    if (String(o.orderNum||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerName||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerContact||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerEmail||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.remarks||'').toLowerCase().indexOf(term) !== -1) return true;
    return items.some(function(it){
      return (it.fabric||'').toLowerCase().indexOf(term) !== -1 || (it.lining||'').toLowerCase().indexOf(term) !== -1;
    });
  });

  sortRows(rows, currentSort);

  if (rows.length === 0) {
    el.innerHTML = term
      ? emptyState('Nothing matches “'+esc(term)+'”', 'Try the order number, the client\'s name, or a cloth number.')
      : emptyState('No orders on the floor', 'Orders are opened by saving an invoice — raise the bill and the garments land here.', '<button class="btn gold" onclick="go(\'invoice\');openInvoiceModal()">+ New invoice</button>');
    updateCounts(); return;
  }

  var html = '';
  rows.forEach(function(e) {
    var o = e.order, oi = e.idx, items = o.items || [];
    var dueSoon = isDueSoon(o.dueDate) && items.some(function(it){ return it.status !== 'Take Home'; });
    html += '<article class="order-card'+(dueSoon?' flag-due':'')+'">'
      + '<div class="oc-head">'
      +   '<div class="oc-ref"><span class="oc-ref-label">Order</span><span class="oc-num">'+esc(o.orderNum)+'</span></div>'
      +   '<div class="oc-meta">'
      +     clientLine(o)
      +     '<div class="meta-cell"><span class="meta-key">Ordered</span><span class="meta-val soft">'+esc(formatDisplayDate(o.date))+'</span></div>'
      +     '<div class="meta-cell tap" onclick="openInlineDate(this)"><span class="meta-key">Fitting</span><span class="meta-val">'+esc(formatDisplayDate(o.fittingDate))+'</span>'
      +       '<input type="date" value="'+esc(o.fittingDate||'')+'" onchange="saveInlineDate('+oi+',\'fitting\',this)" onblur="cancelInlineDate()" onclick="event.stopPropagation()"></div>'
      +     '<div class="meta-cell tap" onclick="openInlineDate(this)"><span class="meta-key">Due</span><span class="meta-val'+(dueSoon?' alarm':'')+'">'+esc(formatDisplayDate(o.dueDate))+'</span>'
      +       '<input type="date" value="'+esc(o.dueDate||'')+'" onchange="saveInlineDate('+oi+',\'due\',this)" onblur="cancelInlineDate()" onclick="event.stopPropagation()"></div>'
      +   '</div>'
      +   '<div class="oc-tools" onclick="event.stopPropagation()">'
      +     threadHtml(o, oi, false)
      +     '<button class="btn sm" onclick="newInvoiceFor(\''+esc(o.orderNum)+'\')">Invoice</button>'
      +     '<button class="btn sm" onclick="archiveOrder('+oi+')">Archive</button>'
      +     '<button class="icon-btn" onclick="openEditModal('+oi+')" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'
      +     '<button class="icon-btn danger" onclick="deleteOrder('+oi+')" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>'
      +   '</div>'
      + '</div>';
    items.forEach(function(it,ii) {
      html += '<div class="g-row"><div class="g-name">'+esc(it.product)+'</div>'
        + '<div class="g-cloth">Cloth <b>'+esc(it.fabric||'—')+'</b>'+(it.lining?' &nbsp;·&nbsp; Lining <b>'+esc(it.lining)+'</b>':'')
        + (hasDesign(it.design) ? '<div class="cell-sub">'+esc(it.design.code)+'</div>' : '')+'</div>'
        + '<div class="g-tools">'
        +   (it.product === 'Jacket' ? designButton('order', o.orderNum, ii, it.design, 'Jacket · order ' + o.orderNum) + ' ' : '')
        +   '<span class="pill '+statusClass(it.status)+'" onclick="toggleItemStatus('+oi+','+ii+',\'status\')">'+esc(statusLabel(it.status))+'</span>'
        +   '<span class="pill'+(it.stuck?' st-stuck':'')+'" onclick="toggleItemStatus('+oi+','+ii+',\'stuck\')">'+(it.stuck?'Stuck':'On track')+'</span>'
        +   '<span class="pill'+(it.paid?' st-paid':' st-unpaid')+'" onclick="toggleItemStatus('+oi+','+ii+',\'paid\')">'+(it.paid?'Paid':'Unpaid')+'</span>'
        +   '<button class="icon-btn danger" onclick="deleteItem('+oi+','+ii+')" aria-label="Remove garment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
        + '</div></div>';
    });
    html += designStrip(o);
    if (o.remarks) html += '<div class="oc-note">'+esc(o.remarks)+'</div>';
    html += '</article>';
  });
  el.innerHTML = html;
  updateCounts();
}

function sortRows(rows, mode) {
  if (mode === 'newest')       rows.sort(function(a,b){ return (b.order.orderNum||'').localeCompare(a.order.orderNum||'', undefined, {numeric:true}); });
  else if (mode === 'oldest')  rows.sort(function(a,b){ return (a.order.orderNum||'').localeCompare(b.order.orderNum||'', undefined, {numeric:true}); });
  else if (mode === 'due-asc') rows.sort(function(a,b){ return (a.order.dueDate||'9999').localeCompare(b.order.dueDate||'9999'); });
  else if (mode === 'due-desc')rows.sort(function(a,b){ return (b.order.dueDate||'9999').localeCompare(a.order.dueDate||'9999'); });
  else if (mode === 'fit-asc') rows.sort(function(a,b){ return (a.order.fittingDate||'9999').localeCompare(b.order.fittingDate||'9999'); });
  else if (mode === 'fit-desc')rows.sort(function(a,b){ return (b.order.fittingDate||'9999').localeCompare(a.order.fittingDate||'9999'); });
}

function emptyState(title, body, action) {
  return '<div class="empty"><div class="empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>'
    + '<div class="empty-title">'+title+'</div><div class="empty-body">'+body+'</div>' + (action||'') + '</div>';
}

/* ══ ARCHIVE ═══════════════════════════════════════ */
function renderArchive() {
  var el = $('archive-content'); if (!el) return;
  var term = ($('archive-search') ? $('archive-search').value : '').trim().toLowerCase();
  var x = $('archive-search-x'); if (x) x.classList.toggle('show', !!term);

  var rows = archivedOrders.map(function(o,i){ return {order:o, idx:i}; }).filter(function(e) {
    var o = e.order;
    if (!term) return true;
    if (String(o.orderNum||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerName||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerContact||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.customerEmail||'').toLowerCase().indexOf(term) !== -1) return true;
    if (String(o.remarks||'').toLowerCase().indexOf(term) !== -1) return true;
    return (o.items||[]).some(function(it){
      return (it.fabric||'').toLowerCase().indexOf(term) !== -1 || (it.lining||'').toLowerCase().indexOf(term) !== -1;
    });
  });
  sortRows(rows, currentArchiveSort);

  if (rows.length === 0) {
    el.innerHTML = term
      ? emptyState('Nothing matches “'+esc(term)+'”', 'The archive keeps everything you have closed off.')
      : emptyState('The archive is empty', 'Finished orders you archive from the floor land here, and can be restored any time.');
    return;
  }

  var html = '';
  rows.forEach(function(e) {
    var o = e.order, ai = e.idx, items = o.items || [];
    html += '<article class="order-card"><div class="oc-head">'
      + '<div class="oc-ref"><span class="oc-ref-label">Order</span><span class="oc-num">'+esc(o.orderNum)+'</span></div>'
      + '<div class="oc-meta">'
      +   clientLine(o)
      +   '<div class="meta-cell"><span class="meta-key">Ordered</span><span class="meta-val soft">'+esc(formatDisplayDate(o.date))+'</span></div>'
      +   '<div class="meta-cell"><span class="meta-key">Fitting</span><span class="meta-val soft">'+esc(formatDisplayDate(o.fittingDate))+'</span></div>'
      +   '<div class="meta-cell"><span class="meta-key">Due</span><span class="meta-val soft">'+esc(formatDisplayDate(o.dueDate))+'</span></div>'
      + '</div>'
      + '<div class="oc-tools" onclick="event.stopPropagation()">'
      +   threadHtml(o, ai, true)
      +   '<button class="btn sm" onclick="confirmRestore('+ai+')">Restore</button>'
      +   '<button class="icon-btn danger" onclick="deleteArchiveOrder('+ai+')" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>'
      + '</div></div>';
    items.forEach(function(it,ii) {
      html += '<div class="g-row"><div class="g-name">'+esc(it.product)+'</div>'
        + '<div class="g-cloth">Cloth <b>'+esc(it.fabric||'—')+'</b>'+(it.lining?' &nbsp;·&nbsp; Lining <b>'+esc(it.lining)+'</b>':'')
        + (hasDesign(it.design) ? '<div class="cell-sub">'+esc(it.design.code)+'</div>' : '')+'</div>'
        + '<div class="g-tools">'
        +   (it.product === 'Jacket' ? designButton('order', o.orderNum, ii, it.design, 'Jacket · order ' + o.orderNum) + ' ' : '')
        +   '<span class="tag">'+esc(statusLabel(it.status))+'</span>'
        +   '<span class="pill'+(it.paid?' st-paid':' st-unpaid')+'" onclick="toggleArchiveItemPaid('+ai+','+ii+')">'+(it.paid?'Paid':'Unpaid')+'</span>'
        + '</div></div>';
    });
    html += designStrip(o);
    if (o.remarks) html += '<div class="oc-note">'+esc(o.remarks)+'</div>';
    html += '</article>';
  });
  el.innerHTML = html;
}

/* ══ FILTERS ═══════════════════════════════════════ */
function toggleFilters() {
  filtersOpen = !filtersOpen;
  $('filter-panel').style.display = filtersOpen ? '' : 'none';
  $('btn-filters').classList.toggle('on', filtersOpen);
}
function setSort(mode)        { currentSort = mode; updateSortButtons(); renderOrders(); }
function toggleDueSort()      { setSort(currentSort === 'due-asc' ? 'due-desc' : 'due-asc'); }
function toggleFitSort()      { setSort(currentSort === 'fit-asc' ? 'fit-desc' : 'fit-asc'); }
function setArchiveSort(mode) { currentArchiveSort = mode; updateArchiveSortButtons(); renderArchive(); }
function toggleArchiveDueSort(){ setArchiveSort(currentArchiveSort === 'due-asc' ? 'due-desc' : 'due-asc'); }
function updateSortButtons() {
  document.querySelectorAll('[data-sort]').forEach(function(b){ b.classList.remove('on'); });
  var a = document.querySelector('[data-sort="'+currentSort+'"]'); if (a) a.classList.add('on');
}
function updateArchiveSortButtons() {
  document.querySelectorAll('[data-archive-sort]').forEach(function(b){ b.classList.remove('on'); });
  var a = document.querySelector('[data-archive-sort="'+currentArchiveSort+'"]'); if (a) a.classList.add('on');
}
function toggleProductFilter(p) { activeProductFilters[p] = !activeProductFilters[p]; updateProductFilterButtons(); renderOrders(); }
function updateProductFilterButtons() {
  document.querySelectorAll('.gfilter').forEach(function(b){ b.classList.toggle('on', !!activeProductFilters[b.getAttribute('data-product')]); });
}
function toggleStatusFilter(s) {
  activeStatusFilter = (activeStatusFilter === s) ? null : s;
  activeStuckFilter = false; activeUnpaidFilter = false;
  updateFilterButtons(); renderOrders();
}
function toggleStuckFilter()  { activeStuckFilter = !activeStuckFilter; activeStatusFilter = null; activeUnpaidFilter = false; updateFilterButtons(); renderOrders(); }
function toggleUnpaidFilter() { activeUnpaidFilter = !activeUnpaidFilter; activeStatusFilter = null; activeStuckFilter = false; updateFilterButtons(); renderOrders(); }
function updateFilterButtons() {
  document.querySelectorAll('.sfilter').forEach(function(b){ b.classList.toggle('on', activeStatusFilter === b.getAttribute('data-status')); });
  $('filter-stuck').classList.toggle('on', activeStuckFilter);
  $('filter-unpaid').classList.toggle('on', activeUnpaidFilter);
}
function applyDateFilter() {
  filterOrderedFrom = ($('filter-ordered-from')||{}).value || '';
  filterOrderedTo   = ($('filter-ordered-to')||{}).value || '';
  filterDueFrom     = ($('filter-due-from')||{}).value || '';
  filterDueTo       = ($('filter-due-to')||{}).value || '';
  renderOrders();
}
function clearAllFilters() {
  activeStatusFilter = null; activeStuckFilter = false; activeUnpaidFilter = false; activeProductFilters = {};
  filterOrderedFrom = filterOrderedTo = filterDueFrom = filterDueTo = '';
  ['filter-ordered-from','filter-ordered-to','filter-due-from','filter-due-to'].forEach(function(id){ var e = $(id); if (e) e.value = ''; });
  updateFilterButtons(); updateProductFilterButtons(); renderOrders();
  showToast('Filters cleared');
}
function clearSearch()        { $('order-search').value = ''; renderOrders(); }
function clearArchiveSearch() { $('archive-search').value = ''; renderArchive(); }