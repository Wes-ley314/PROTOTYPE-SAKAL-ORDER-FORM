/* ══════════════════════════════════════════════════
   DELTA
   The making charges from Delta — their own order
   numbers, the canvas and add-ons on each jacket, what
   it costs, where it has got to, and whether it has
   been paid and invoiced.
   ══════════════════════════════════════════════════ */

var DELTA_CANVAS = {'Half Canvas': 140, 'Full Canvas': 180};
var DELTA_ADDONS = {
  'Milanese': 10, 'Surgeon': 10, 'Half-Line': 30, 'No-Line': 30,
  'Lining': 30, 'Tuxedo': 30, 'Vest': 55, 'Embroidery': 10
};
var DELTA_STAGES = [
  {k:'backend',   l:'Back-End',  cls:'st-fabric'},
  {k:'bin',       l:'Bin',       cls:'st-bin'},
  {k:'delivered', l:'Delivered', cls:'st-store'}
];

var deltaView = 'active', deltaSortAsc = false, deltaFilters = {}, deltaEdit = -1, deltaCanvas = 'Half Canvas';

/* What Delta charges is the shop's business, not the floor's, so the list
   keeps it out of sight until somebody asks for it. */
var deltaShowCharge = false;
try { deltaShowCharge = localStorage.getItem('sakal-delta-charge') === '1'; } catch(e) {}
function toggleDeltaCharge() {
  deltaShowCharge = !deltaShowCharge;
  try { localStorage.setItem('sakal-delta-charge', deltaShowCharge ? '1' : '0'); } catch(e) {}
  var b = $('delta-charge-btn');
  if (b) { b.classList.toggle('on', deltaShowCharge); b.textContent = deltaShowCharge ? 'Hide charges' : 'Show charges'; }
  renderDelta();
}

function deltaTotal(o) {
  return (DELTA_CANVAS[o.canvas] || 0)
       + (o.addons || []).reduce(function(s,a){ return s + (DELTA_ADDONS[a] || 0); }, 0);
}
function deltaStage(o) {
  var s = DELTA_STAGES.find(function(x){ return o[x.k]; });
  return s ? s.l : 'Not started';
}

function setDeltaView(v) {
  deltaView = v;
  document.querySelectorAll('[data-deltaview]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-deltaview') === v); });
  $('delta-filters').style.display = v === 'active' ? '' : 'none';
  renderDelta();
}
function toggleDeltaSort() {
  deltaSortAsc = !deltaSortAsc;
  $('delta-sort').textContent = deltaSortAsc ? 'Earliest due first' : 'Latest due first';
  renderDelta();
}
/* The chips read as questions: show me what is unpaid, what has no invoice. */
function toggleDeltaFilter(k) {
  if (deltaFilters[k]) delete deltaFilters[k]; else deltaFilters[k] = true;
  document.querySelectorAll('[data-deltaf]').forEach(function(b) {
    b.classList.toggle('on', !!deltaFilters[b.getAttribute('data-deltaf')]);
  });
  renderDelta();
}
function deltaMatches(o, k) { return !!o[k]; }

function renderDelta() {
  var el = $('delta-content'); if (!el) return;
  var term = ($('delta-search') ? $('delta-search').value : '').trim().toLowerCase();
  var wantArch = deltaView === 'archive';

  var list = deltaOrders.map(function(o,i){ return {o:o, i:i}; })
                        .filter(function(x){ return !!x.o.archived === wantArch; });

  var keys = Object.keys(deltaFilters);
  var rows = list.filter(function(x) {
    if (!wantArch && keys.length && !keys.some(function(k){ return deltaMatches(x.o, k); })) return false;
    if (!term) return true;
    return hit(x.o.orderNum, term) || hit(x.o.canvas, term)
        || (x.o.addons || []).some(function(a){ return hit(a, term); });
  }).sort(function(a,b) {
    var da = a.o.dueDate || (deltaSortAsc ? '9999' : '0000');
    var db = b.o.dueDate || (deltaSortAsc ? '9999' : '0000');
    var c = da < db ? -1 : da > db ? 1 : 0;
    return (deltaSortAsc ? c : -c) || (b.i - a.i);
  });

  var value  = list.reduce(function(s,x){ return s + (Number(x.o.total) || 0); }, 0);
  var due    = list.filter(function(x){ return !x.o.delivered && isDueSoon(x.o.dueDate); }).length;
  var done   = list.filter(function(x){ return x.o.delivered; }).length;
  var open   = list.length - done;

  $('delta-stats').innerHTML = wantArch
    ? stat('Archived', list.length, 'Closed off')
      + (deltaShowCharge ? stat('Archived value', 'S$ ' + money0(value), 'What they came to') : '')
    : stat('With Delta', list.length, 'Jackets on their bench')
      + stat('Due soon', due, due ? 'Within three days' : 'Nothing pressing', due ? 'alarm' : 'ok')
      + stat('Delivered', done, done + ' of ' + list.length + ' back from Delta')
      + stat('Still with them', open, open ? 'Not delivered yet' : 'All delivered', open ? '' : 'ok');

  if (rows.length === 0) {
    el.innerHTML = list.length === 0
      ? emptyState(wantArch ? 'Nothing archived' : 'Nothing with Delta',
          wantArch ? 'Orders you close off from the list land here.'
                   : 'Log what has gone out to Delta and what it costs to have it made.',
          wantArch ? '' : '<button class="btn gold" onclick="openDeltaModal()">+ New Delta order</button>')
      : emptyState('Nothing matches', 'Try another chip, or clear the search.');
    updateCounts(); return;
  }

  var body = rows.map(function(x) {
    var o = x.o, i = x.i;
    var urgent = !o.delivered && isDueSoon(o.dueDate);
    var addons = (o.addons || []).length
      ? o.addons.map(function(a){ return '<span class="tag">'+esc(a)+'</span>'; }).join(' ')
      : '<span style="color:var(--faint)">—</span>';
    var stages = DELTA_STAGES.map(function(s) {
      return '<span class="pill'+(o[s.k] ? ' ' + s.cls : '')+'" style="min-width:88px" '
           + 'onclick="toggleDeltaStage('+i+',\'' + s.k + '\')">' + s.l + '</span>';
    }).join(' ');
    return '<tr class="'+(urgent ? 'row-flag' : '')+'">'
      + '<td><div class="cell-strong num">'+esc(o.orderNum)+'</div>'
      +   '<div class="cell-sub">placed '+esc(o.date || '—')+'</div></td>'
      + '<td class="tap-date" onclick="openDeltaDate('+i+',this)">'
      +   '<span class="dd-disp"'+(urgent ? ' style="color:var(--danger);font-weight:600"' : '')+'>'
      +   esc(o.dueDate ? formatDisplayDate(o.dueDate) : '—')+'</span>'
      +   '<input type="date" class="dd-pick" style="display:none" value="'+esc(o.dueDate||'')+'" '
      +   'onchange="saveDeltaDate('+i+',this)" onblur="closeDeltaDate()" onclick="event.stopPropagation()"></td>'
      + '<td>'+esc(o.canvas || '—')+'</td>'
      + '<td>'+addons+'</td>'
      + (deltaShowCharge ? '<td class="num">S$ '+money0(o.total)+'</td>' : '')
      + '<td>'+stages+'</td>'
      + '<td class="acts">'
      +   '<button class="btn sm" onclick="openDeltaModal('+i+')">Edit</button> '
      +   (wantArch
            ? '<button class="btn sm" onclick="restoreDelta('+i+')">Restore</button> '
            : '<button class="btn sm" onclick="archiveDelta('+i+')">Archive</button> ')
      +   '<button class="icon-btn danger" onclick="deleteDelta('+i+')" aria-label="Delete">'
      +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>'
      + '</td></tr>';
  }).join('');

  var shown = rows.reduce(function(s,x){ return s + (Number(x.o.total)||0); }, 0);
  el.innerHTML = '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:'+(deltaShowCharge?1040:950)+'px">'
    + '<thead><tr><th>Delta no.</th><th>Due</th><th>Canvas</th><th>Add-ons</th>'
    + (deltaShowCharge ? '<th class="num">Charge</th>' : '')
    + '<th>Stage</th><th></th></tr></thead>'
    + '<tbody>' + body + '</tbody></table></div>'
    + '<div class="oc-note" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">'
    +   '<span>' + rows.length + ' of ' + list.length + ' order' + (list.length===1?'':'s') + '</span>'
    +   (deltaShowCharge ? '<span>Showing <b>S$ ' + money0(shown) + '</b> of S$ ' + money0(value) + '</span>' : '')
    + '</div></div>';
  updateCounts();
}

/* Back-End, Bin and Delivered are one after another, not all at once. */
function toggleDeltaStage(i, k) {
  var o = deltaOrders[i]; if (!o) return;
  var was = o[k];
  DELTA_STAGES.forEach(function(s){ o[s.k] = false; });
  o[k] = !was;
  persistDelta(); renderDelta();
}
function toggleDeltaFlag(i, k) {
  var o = deltaOrders[i]; if (!o) return;
  o[k] = !o[k];
  persistDelta(); renderDelta();
}
function archiveDelta(i) { deltaOrders[i].archived = true;  persistDelta(); renderDelta(); showToast('Delta ' + deltaOrders[i].orderNum + ' archived'); }
function restoreDelta(i) { deltaOrders[i].archived = false; persistDelta(); renderDelta(); showToast('Delta ' + deltaOrders[i].orderNum + ' restored'); }

var deltaDelPending = -1;
function deleteDelta(i) {
  deltaDelPending = i;
  $('confirm-title').textContent = 'Delete this Delta order?';
  $('confirm-msg').innerHTML = 'Delta <strong>'+esc(deltaOrders[i].orderNum)+'</strong> and its charge come off the list for good.';
  var b = $('confirm-go'); b.textContent = 'Delete'; b.className = 'btn btn-danger';
  b.onclick = function() {
    if (deltaDelPending < 0) return;
    var n = deltaOrders[deltaDelPending].orderNum;
    deltaOrders.splice(deltaDelPending, 1); deltaDelPending = -1;
    closeConfirmModal(); persistDelta(); renderDelta(); showToast('Delta ' + n + ' deleted');
  };
  $('confirm-modal').classList.add('open');
}

function openDeltaDate(i, cell) {
  cell.querySelector('.dd-disp').style.display = 'none';
  var p = cell.querySelector('.dd-pick');
  p.style.display = 'inline-block'; p.focus();
  try { p.showPicker(); } catch(e) {}
}
function saveDeltaDate(i, pick) { deltaOrders[i].dueDate = pick.value; persistDelta(); renderDelta(); }
function closeDeltaDate() { setTimeout(renderDelta, 150); }

/* ── The form ── */
function setDeltaCanvas(t) {
  deltaCanvas = t;
  document.querySelectorAll('[data-canvas]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-canvas') === t); });
  updateDeltaTotal();
}
function toggleDeltaAddon(btn) { btn.classList.toggle('on'); updateDeltaTotal(); }
function chosenAddons() {
  return Array.prototype.map.call(document.querySelectorAll('#dm-addons .chip.on'),
    function(b){ return b.getAttribute('data-addon'); });
}
/* The charge is still worked out and saved with the order — it just is
   not shown while the order is being put together, only later on the
   list if "Show charges" is switched on. */
function updateDeltaTotal() {
  return deltaTotal({canvas: deltaCanvas, addons: chosenAddons()});
}

function openDeltaModal(i) {
  deltaEdit = (i === undefined || i === null) ? -1 : i;
  var o = deltaEdit >= 0 ? deltaOrders[deltaEdit] : null;
  $('delta-modal-title').textContent = o ? 'Delta ' + o.orderNum : 'New Delta order';
  $('dm-num').value = o ? o.orderNum : '';
  if (o) { $('dm-due').value = o.dueDate || ''; }
  else {
    var d = new Date(); d.setDate(d.getDate() + 7);
    $('dm-due').value = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  $('dm-addons').innerHTML = Object.keys(DELTA_ADDONS).map(function(a) {
    var on = o && (o.addons||[]).indexOf(a) !== -1;
    return '<button class="chip'+(on?' on':'')+'" data-addon="'+esc(a)+'" onclick="toggleDeltaAddon(this)">'
      + esc(a) + '</button>';
  }).join('');
  setDeltaCanvas(o ? o.canvas : 'Half Canvas');
  $('dm-delete').style.display = o ? '' : 'none';
  $('dm-num-err').classList.remove('show'); $('dm-num').classList.remove('err');
  $('delta-modal').classList.add('open');
  setTimeout(function(){ $('dm-num').focus(); }, 60);
}
function closeDeltaModal() { $('delta-modal').classList.remove('open'); deltaEdit = -1; }

function saveDeltaOrder() {
  var num = $('dm-num').value.trim();
  var err = $('dm-num-err');
  if (!num) { err.textContent = 'Give the order its Delta number.'; err.classList.add('show'); $('dm-num').classList.add('err'); $('dm-num').focus(); return; }
  var clash = deltaOrders.some(function(o, i){ return o.orderNum === num && i !== deltaEdit; });
  if (clash) { err.textContent = 'Delta ' + num + ' is already on the list.'; err.classList.add('show'); $('dm-num').classList.add('err'); return; }
  var due = $('dm-due').value;
  if (!due) { showToast('Pick a due date.'); $('dm-due').focus(); return; }

  var payload = {orderNum: num, dueDate: due, canvas: deltaCanvas, addons: chosenAddons()};
  payload.total = deltaTotal(payload);

  if (deltaEdit >= 0) {
    deltaOrders[deltaEdit] = Object.assign(deltaOrders[deltaEdit], payload);
    showToast('Delta ' + num + ' updated and saved');
  } else {
    payload.date = formatDisplayDate(todayYMD());
    payload.backend = payload.bin = payload.delivered = false;
    payload.paid = payload.invoice = payload.archived = false;
    deltaOrders.unshift(payload);
    if (deltaView !== 'active') setDeltaView('active');
    showToast('Delta ' + num + ' added and saved');
  }
  closeDeltaModal(); persistDelta(); renderDelta();
}

function deleteDeltaFromModal() {
  if (deltaEdit < 0) return;
  var i = deltaEdit; closeDeltaModal(); deleteDelta(i);
}

function exportDelta() {
  var rows = [['Delta no.','Placed','Due','Canvas','Add-ons','Charge','Stage','Archived']];
  deltaOrders.forEach(function(o) {
    rows.push([o.orderNum, o.date, o.dueDate, o.canvas, (o.addons||[]).join(' · '),
               o.total, deltaStage(o), o.archived ? 'Yes' : 'No']);
  });
  downloadCsv('sakal-delta.csv', rows);
}

/* ══════════════════════════════════════════════════
   BRINGING DELTA ACROSS FROM THE HQ DASHBOARD
   The dashboard keeps its list in that page's own storage,
   which no other page can read. Its "Back up data" button
   writes the lot to a file — drop that file in here and the
   two lists match again.
   ══════════════════════════════════════════════════ */

var DELTA_DASH_KEY = 'cs-order-list-v1';
var deltaIncoming = null;

function normaliseDelta(o) {
  var d = {
    orderNum: String(o.orderNum == null ? '' : o.orderNum).trim(),
    dueDate:  parseToYMD(o.dueDate) || '',
    canvas:   DELTA_CANVAS[o.canvas] ? o.canvas : 'Half Canvas',
    addons:   Array.isArray(o.addons) ? o.addons.filter(function(a){ return DELTA_ADDONS[a] !== undefined; }) : [],
    date:     o.date || formatDisplayDate(todayYMD()),
    backend:  !!o.backend, bin: !!o.bin, delivered: !!o.delivered,
    paid:     !!o.paid, invoice: !!o.invoice, archived: !!o.archived
  };
  d.total = (typeof o.total === 'number' && o.total > 0) ? o.total : deltaTotal(d);
  return d;
}

/* Reads a dashboard backup, a bare export of that one key, or a plain array. */
function extractDeltaList(obj) {
  var d = (obj && obj.data) ? obj.data : obj;
  var raw = d && d[DELTA_DASH_KEY];
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = null; } }
  if (!Array.isArray(raw)) raw = Array.isArray(obj) ? obj : (Array.isArray(d) ? d : null);
  if (!Array.isArray(raw)) return null;
  var list = raw.filter(function(o){ return o && o.orderNum; }).map(normaliseDelta);
  return list.length ? list : null;
}

function openDeltaImport() {
  deltaIncoming = null;
  $('di-paste').value = '';
  $('di-file').value = '';
  $('di-report').innerHTML = '<span class="inline-note">Nothing loaded yet.</span>';
  $('di-replace').disabled = true; $('di-merge').disabled = true;
  $('delta-import-modal').classList.add('open');
}
function closeDeltaImport() { $('delta-import-modal').classList.remove('open'); deltaIncoming = null; }

function deltaImportFile(input) {
  var f = input.files && input.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function(){ takeDeltaText(r.result, f.name); };
  r.readAsText(f);
}
function deltaImportPaste() { takeDeltaText($('di-paste').value, 'what you pasted'); }

function takeDeltaText(text, where) {
  var obj;
  try { obj = JSON.parse(text); }
  catch(e) {
    $('di-report').innerHTML = '<span style="color:var(--danger)">That is not readable JSON.</span>';
    $('di-replace').disabled = true; $('di-merge').disabled = true; return;
  }
  var list = extractDeltaList(obj);
  if (!list) {
    $('di-report').innerHTML = '<span style="color:var(--danger)">No order list found in ' + esc(where)
      + '. A dashboard backup holds it under <b>' + DELTA_DASH_KEY + '</b>.</span>';
    $('di-replace').disabled = true; $('di-merge').disabled = true; return;
  }
  deltaIncoming = list;

  var have = {}; deltaOrders.forEach(function(o){ have[o.orderNum] = o; });
  var fresh = list.filter(function(o){ return !have[o.orderNum]; }).length;
  var same  = list.filter(function(o) {
    var e = have[o.orderNum];
    return e && JSON.stringify(normaliseDelta(e)) === JSON.stringify(o);
  }).length;
  var changed = list.length - fresh - same;
  var value = list.reduce(function(s,o){ return s + o.total; }, 0);

  $('di-report').innerHTML =
      '<b>' + list.length + ' order' + (list.length===1?'':'s') + '</b> read from ' + esc(where)
    + ', worth S$ ' + money0(value) + '.<br>'
    + fresh + ' not on this list yet · ' + changed + ' different here · ' + same + ' already identical.';
  $('di-replace').disabled = false; $('di-merge').disabled = false;
}

function applyDeltaImport(mode) {
  if (!deltaIncoming) return;
  if (mode === 'replace') {
    deltaOrders = deltaIncoming.slice();
  } else {
    var have = {}; deltaOrders.forEach(function(o, i){ have[o.orderNum] = i; });
    deltaIncoming.forEach(function(o) {
      if (have[o.orderNum] === undefined) deltaOrders.push(o);
      else deltaOrders[have[o.orderNum]] = o;
    });
  }
  var n = deltaIncoming.length;
  closeDeltaImport(); persistDelta(); renderDelta(); updateCounts();
  showToast(mode === 'replace' ? 'Delta replaced with ' + n + ' orders' : n + ' orders merged in');
}

/* Puts back the eighteen that shipped with the app. */
function resetDeltaToFile() {
  deltaOrders = JSON.parse(JSON.stringify(SEED_DELTA)).map(normaliseDelta);
  closeDeltaImport(); persistDelta(); renderDelta(); updateCounts();
  showToast('Delta reset to the list from the dashboard file');
}