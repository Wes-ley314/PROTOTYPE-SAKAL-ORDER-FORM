/* ══════════════════════════════════════════════════
   SUIT ORDER FORM
   Every jacket carries its own design. The form runs
   whole inside a frame, and what comes back is stored
   on the garment — so the drawing, the codes and the
   workshop instructions travel with the order.
   ══════════════════════════════════════════════════ */

var designTarget = null;

function designCodeOf(d) { return d && d.code ? d.code : ''; }
function hasDesign(d) { return !!(d && d.rows && d.rows.length); }

function currentDesignFor(t) {
  if (!t) return null;
  if (t.kind === 'invoice') {
    var l = invLines[t.a]; if (!l) return null;
    var p = (l.parts || [])[t.b]; return p ? p.design : null;
  }
  var o = findOrder(t.a); if (!o) return null;
  var it = (o.items || [])[t.b]; return it ? it.design : null;
}

var designBlobUrl = '', designTab = null, designHandoffTimer = 0;

function openJacketForm(kind, a, b, label) {
  designTarget = {kind: kind, a: a, b: b};
  var d = currentDesignFor(designTarget);
  $('design-sub').textContent = (label || 'Jacket')
    + (hasDesign(d) ? ' · ' + d.code : ' · nothing filled in yet');
  $('design-fallback').classList.remove('show');

  var f = $('design-frame');
  var loaded = false;
  f.onload = function() {
    loaded = true;
    try { f.contentWindow.postMessage({type:'sakal-load', design: d, title: label || ''}, '*'); } catch(e) {}
  };
  // srcdoc keeps the form in one file; a blob URL is the sturdier route
  // where a browser refuses it, so try that first and fall back.
  try {
    if (designBlobUrl) URL.revokeObjectURL(designBlobUrl);
    designBlobUrl = URL.createObjectURL(new Blob([JACKET_FORM_HTML], {type:'text/html'}));
    f.removeAttribute('srcdoc');
    f.src = designBlobUrl;
  } catch (e) {
    f.srcdoc = JACKET_FORM_HTML;
  }

  $('design-over').classList.add('open');
  document.body.style.overflow = 'hidden';
  // If nothing has rendered after a moment, offer the tab instead.
  setTimeout(function() {
    if (!loaded) $('design-fallback').classList.add('show');
  }, 2500);

  watchDesignHandoff();
}

function closeJacketForm() {
  $('design-over').classList.remove('open');
  document.body.style.overflow = '';
  var f = $('design-frame');
  f.onload = null; f.removeAttribute('src'); f.removeAttribute('srcdoc');
  if (designBlobUrl) { URL.revokeObjectURL(designBlobUrl); designBlobUrl = ''; }
  clearInterval(designHandoffTimer); designHandoffTimer = 0;
  designTarget = null;
}

/* Opening the form in its own tab, for any browser that will not run a
   page inside a page. The design travels out on the address and comes
   back through the browser's own storage. */
function openDesignInTab() {
  if (!designTarget) return;
  var d = currentDesignFor(designTarget);
  var payload = {design: d || null, title: $('design-sub').textContent};
  try { localStorage.removeItem('sakal-design-handoff'); } catch(e) {}
  var url = URL.createObjectURL(new Blob([JACKET_FORM_HTML], {type:'text/html'}))
          + '#' + encodeURIComponent(JSON.stringify(payload));
  designTab = window.open(url, '_blank');
  if (!designTab) { showToast('Allow pop-ups for this site, then try again.'); return; }
  showToast('Design the jacket, then press Attach to order');
  watchDesignHandoff();
}

/* The tab writes its answer to storage; this picks it up either way. */
function watchDesignHandoff() {
  clearInterval(designHandoffTimer);
  designHandoffTimer = setInterval(function() {
    var raw = null;
    try { raw = localStorage.getItem('sakal-design-handoff'); } catch(e) {}
    if (!raw) return;
    try { localStorage.removeItem('sakal-design-handoff'); } catch(e) {}
    try { applyDesign(JSON.parse(raw)); } catch(e) {}
  }, 700);
}

function applyDesign(p) {
  var t = designTarget;
  if (!t || !p) return;
  p.updated = todayYMD();

  if (t.kind === 'invoice') {
    var line = invLines[t.a];
    if (line) {
      var part = ensureParts(line)[t.b];
      if (part) part.design = p;
      renderInvLines();
    }
  } else {
    var o = findOrder(t.a);
    if (o && o.items && o.items[t.b]) {
      o.items[t.b].design = p;
      syncToServer(o);
      renderOrders(); renderArchive();
    }
  }
  closeJacketForm();
  showToast('Suit order form attached — ' + p.code);
}

window.addEventListener('message', function(e) {
  var d = e.data || {};
  if (d.type === 'sakal-design' && d.payload) applyDesign(d.payload);
});

/* The button that sits next to a jacket, wherever it appears. */
function designButton(kind, a, b, design, label) {
  var on = hasDesign(design);
  return '<button class="btn sm'+(on?'':' gold')+'" '
    + 'onclick="openJacketForm(\''+kind+'\','+(typeof a === 'string' ? '\''+esc(a)+'\'' : a)+','+b+',\''+esc(label||'Jacket')+'\')" '
    + 'title="'+(on ? esc(design.code) : 'Fill in the suit order form')+'">'
    + (on ? 'Form ✓' : 'Suit order form') + '</button>';
}

/* A jacket's design, read out under the order it belongs to. */
function designStrip(o) {
  var rows = (o.items || []).filter(function(it){ return hasDesign(it.design); });
  if (!rows.length) return '';
  return rows.map(function(it) {
    var d = it.design;
    return '<div class="oc-note" style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">'
      + '<span style="font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)">'
      +   esc(it.product) + ' form</span>'
      + '<span style="font-variant-numeric:tabular-nums">'+esc(d.code)+'</span>'
      + (d.notes && d.notes.trim() ? '<span style="flex:1 1 200px">'+esc(d.notes.trim())+'</span>' : '')
      + '</div>';
  }).join('');
}