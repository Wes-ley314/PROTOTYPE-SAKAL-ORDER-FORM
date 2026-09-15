/* ══════════════════════════════════════════════════
   OPERATION ↔ THE SHEET
   The Operation page (SIM cards, stored-value cards,
   motorcycle tax) lives on the sheet as ONE JSON-LD
   document, shared by every phone and laptop.

   How it stays in step on several devices at once:

   - `shadow` is the last copy of each record the sheet
     gave us, with its version number.
   - Saving on this device compares the lists with the
     shadow and queues only what actually changed
     (`pending`), each with the version it started from.
   - The sheet (Apps Script V10, SYNC_OPERATION) accepts
     a change only if nobody changed that record in the
     meantime; otherwise the other device's edit stands
     and this one shows it.
   - Deletes travel as tombstones, so a record removed
     on one phone does not come back from another.
   - The document arrives with the boot's ?modules=1 answer.
     After that the page pulls every 30 s while Operation is
     open, and on focus. Nothing is pulled over unsent work,
     and nothing at all on a V9 sheet (its ?operation=1
     answer is the whole order list).

   Offline, everything is kept on the device and sent
   the next time the sheet answers.
   ══════════════════════════════════════════════════ */

var OpsSync = (function () {
  var K_SHADOW  = 'sakal-ops-shadow';
  var K_PENDING = 'sakal-ops-pending';
  var K_META    = 'sakal-ops-meta';

  var CARD = 'urn:sakal:card:', MOTO = 'urn:sakal:motorcycle:';
  /* same vocabulary the Apps Script stamps on the stored document */
  var OPS_CONTEXT = {
    '@vocab': 'https://schema.org/', 'sakal': 'https://sakal.com.sg/ns/operation#',
    'SimCard': 'sakal:SimCard', 'StoredValueCard': 'sakal:StoredValueCard', 'MotorcycleTax': 'sakal:MotorcycleTaxRecord',
    'cardType': 'sakal:cardType', 'number': 'identifier', 'holder': 'sakal:heldBy',
    'owner': 'sakal:owner', 'plate': 'sakal:plateNumber', 'taxMonth': 'sakal:annualTaxMonth',
    'plateYear': 'sakal:plateRenewalYear', 'taxPaidYear': 'sakal:taxPaidForYear',
    'expires': {'@id': 'expires', '@type': 'Date'}, 'lastTopUp': {'@id': 'sakal:lastTopUp', '@type': 'Date'},
    'lastAmount': 'sakal:lastTopUpAmountSGD', 'note': 'description', 'deleted': 'sakal:deleted',
    'modifiedBy': 'sakal:modifiedBy', 'dateModified': {'@id': 'dateModified', '@type': 'DateTime'}
  };
  var META_KEYS = { version: 1, dateModified: 1, modifiedBy: 1 };

  var shadow  = load(K_SHADOW, {});     // @id → node, as the sheet last had it
  var pending = load(K_PENDING, {});    // @id → {base, node}
  var meta    = load(K_META, { migrated: false, version: 0, synced: '' });

  var timer = null, inFlight = null, lastPull = 0, poller = null;
  /* Only POST once a GET has proved the sheet runs V10: an older script
     reads any POST it does not know as an order save. */
  var backendOk = false;
  var state = 'idle';   // idle | saving | offline | old-backend

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v || d; } catch (e) { return d; } }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function saveState() { keep(K_SHADOW, shadow); keep(K_PENDING, pending); keep(K_META, meta); }

  /* ── app rows ⇄ JSON-LD nodes ── */
  function blank(v) { return v === undefined || v === null ? '' : v; }

  function cardNode(o) {
    return {
      '@id': CARD + o.id,
      '@type': o.type === 'SIM Card' ? 'SimCard' : 'StoredValueCard',
      cardType: blank(o.type), number: blank(o.number), provider: blank(o.provider),
      holder: blank(o.holder), expires: blank(o.expiry),
      lastAmount: blank(o.amount), lastTopUp: blank(o.topup), note: blank(o.note)
    };
  }
  function motoNode(o) {
    return {
      '@id': MOTO + o.id,
      '@type': 'MotorcycleTax',
      owner: blank(o.owner), plate: blank(o.plate),
      taxMonth: blank(o.taxMonth), plateYear: blank(o.plateYear),
      taxPaidYear: blank(o.taxPaidYear), note: blank(o.note)
    };
  }
  function day(n) { return n.dateModified ? String(n.dateModified).slice(0, 10) : ''; }
  function fromNode(n) {
    var id = String(n['@id']);
    if (id.indexOf(CARD) === 0) {
      return ['card', {
        id: id.slice(CARD.length), type: n.cardType || (n['@type'] === 'SimCard' ? 'SIM Card' : 'Ez-Link Card'),
        number: blank(n.number), provider: blank(n.provider), holder: blank(n.holder),
        expiry: blank(n.expires), amount: blank(n.lastAmount), topup: blank(n.lastTopUp),
        note: blank(n.note), updated: day(n)
      }];
    }
    if (id.indexOf(MOTO) === 0) {
      return ['moto', {
        id: id.slice(MOTO.length), owner: blank(n.owner), plate: blank(n.plate),
        taxMonth: blank(n.taxMonth), plateYear: blank(n.plateYear),
        taxPaidYear: blank(n.taxPaidYear), note: blank(n.note), updated: day(n)
      }];
    }
    return [null, null];
  }

  /* content only — the stamps the sheet adds are not a change */
  function canon(n) {
    if (!n) return '';
    var out = {};
    Object.keys(n).sort().forEach(function (k) { if (!META_KEYS[k]) out[k] = n[k]; });
    return JSON.stringify(out);
  }

  function currentNodes() {
    var map = {};
    (opitems || []).forEach(function (o) { if (o && o.id) { var n = cardNode(o); map[n['@id']] = n; } });
    (vehicles || []).forEach(function (o) { if (o && o.id) { var n = motoNode(o); map[n['@id']] = n; } });
    return map;
  }

  /* what the sheet has, with this device's unsent changes laid on top */
  function merged() {
    var view = {};
    Object.keys(shadow).forEach(function (id) { if (shadow[id].deleted !== true) view[id] = shadow[id]; });
    Object.keys(pending).forEach(function (id) {
      var n = pending[id].node;
      if (n.deleted === true) delete view[id]; else view[id] = n;
    });
    return view;
  }

  /* rebuild opitems / vehicles from merged(), keeping this device's order */
  function rebuildLists() {
    var view = merged(), cards = [], motos = [], seen = {};
    function take(list, prefix, out) {
      (list || []).forEach(function (o) {
        var id = prefix + o.id;
        if (view[id] && !seen[id]) { seen[id] = 1; out.push(fromNode(view[id])[1]); }
      });
    }
    take(opitems, CARD, cards);
    take(vehicles, MOTO, motos);
    Object.keys(view).forEach(function (id) {
      if (seen[id]) return;
      var r = fromNode(view[id]);
      if (r[0] === 'card') cards.unshift(r[1]);
      if (r[0] === 'moto') motos.unshift(r[1]);
    });
    opitems = cards; vehicles = motos;
    try {
      localStorage.setItem('sakal-ops', JSON.stringify(opitems));
      localStorage.setItem('sakal-vehicles', JSON.stringify(vehicles));
    } catch (e) {}
  }

  function redraw() {
    if (typeof renderOps === 'function') renderOps();
    if (typeof updateCounts === 'function') updateCounts();
    note();
  }

  /* ── this device changed something ── */
  function persist() {
    try {
      localStorage.setItem('sakal-ops', JSON.stringify(opitems));
      localStorage.setItem('sakal-vehicles', JSON.stringify(vehicles));
    } catch (e) { console.log('Cache write failed for operation'); }

    var now = currentNodes();
    Object.keys(now).forEach(function (id) {
      var known = shadow[id], p = pending[id];
      var ref = p ? canon(p.node) : (known && known.deleted !== true ? canon(known) : null);
      if (canon(now[id]) === ref) return;
      if (known && known.deleted !== true && canon(now[id]) === canon(known)) { delete pending[id]; return; }
      pending[id] = { base: known ? (Number(known.version) || 0) : 0, node: now[id] };
    });
    Object.keys(merged()).forEach(function (id) {
      if (now[id]) return;
      var known = shadow[id];
      if (known && known.deleted !== true) {
        pending[id] = { base: Number(known.version) || 0, node: { '@id': id, '@type': known['@type'], deleted: true } };
      } else {
        delete pending[id];   // never reached the sheet — nothing to tell it
      }
    });
    saveState();
    schedule(1200);
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; push(); }, ms);
    if (Object.keys(pending).length) say('warn', 'Saving operation…');
  }

  function say(s, text, toast) { if (typeof _say === 'function') _say(s, text, toast); }

  /* ── talking to the sheet ── */
  function adopt(doc) {
    if (!doc || !Array.isArray(doc['@graph'])) return false;
    var next = {};
    doc['@graph'].forEach(function (n) { if (n && n['@id']) next[n['@id']] = n; });
    shadow = next;
    meta.version = Number(doc.version) || 0;
    meta.synced = new Date().toISOString();
    return true;
  }

  async function push() {
    if (inFlight) { await inFlight; }
    if (!Object.keys(pending).length) return true;
    if (!backendOk || !meta.migrated) {
      if (state === 'old-backend') { note(); return false; }   // V9: keep it on the device, don't ask again
      if (!(await pull(true, true))) return false;
    }
    var ids = Object.keys(pending);
    if (!ids.length) return true;
    var sent = {};
    var changes = ids.map(function (id) { sent[id] = canon(pending[id].node) + '|' + pending[id].base; return pending[id]; });
    state = 'saving'; note();

    inFlight = (async function () {
      try {
        var r = await fetch(API_URL, {
          method: 'POST', redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'SYNC_OPERATION', changes: changes })
        });
        var text = await r.text(), res = {};
        try { res = JSON.parse(text); } catch (_) {}
        if (res.status !== 'success' || !res.doc) {
          state = 'offline';
          say('warn', 'Operation saved on this device only');
          return false;
        }
        adopt(res.doc);
        var lost = [];
        (res.accepted || []).concat(res.rejected || []).forEach(function (id) {
          var p = pending[id];
          if (!p) return;
          var same = canon(p.node) + '|' + p.base === sent[id];
          if ((res.rejected || []).indexOf(id) > -1) {
            if (same) {
              if (canon(shadow[id]) !== canon(p.node) && !(p.node.deleted && shadow[id] && shadow[id].deleted)) lost.push(id);
              delete pending[id];
            }
            else { p.base = shadow[id] ? Number(shadow[id].version) || 0 : 0; }   // edited again mid-flight: retry on top
          } else if (same) {
            delete pending[id];
          } else {
            p.base = shadow[id] ? Number(shadow[id].version) || 0 : 0;         // edited again mid-flight: send the newer one
          }
        });
        rebuildLists();
        saveState();
        state = 'idle';
        redraw();
        if (lost.length) {
          say('warn', 'Operation updated elsewhere',
              lost.length === 1 ? 'That record was changed on another device — showing the latest.'
                                : lost.length + ' records were changed on another device — showing the latest.');
        } else {
          say('', 'All changes saved', 'Saved');
        }
        if (Object.keys(pending).length) schedule(300);
        return true;
      } catch (err) {
        state = 'offline';
        say('bad', 'No connection — operation saved on this device');
        return false;
      } finally {
        note();
      }
    })();
    var out = await inFlight;
    inFlight = null;
    return out;
  }

  /* First time this device meets the shared document: anything typed here
     before syncing existed goes up, untouched seed rows defer to the sheet. */
  function migrate() {
    var seeds = {};
    (typeof SEED_OPS !== 'undefined' ? SEED_OPS : []).forEach(function (o) { var n = cardNode(o); seeds[n['@id']] = canon(n); });
    (typeof SEED_VEHICLES !== 'undefined' ? SEED_VEHICLES : []).forEach(function (o) { var n = motoNode(o); seeds[n['@id']] = canon(n); });
    var sheetHasData = meta.version > 0;
    var now = currentNodes();
    Object.keys(now).forEach(function (id) {
      var pristine = seeds[id] === canon(now[id]);
      var known = shadow[id];
      if (pristine && (sheetHasData || known)) { delete pending[id]; return; }   // the sheet's word stands
      if (known && known.deleted !== true && canon(known) === canon(now[id])) { delete pending[id]; return; }
      pending[id] = { base: known ? Number(known.version) || 0 : 0, node: now[id] };
    });
    Object.keys(pending).forEach(function (id) {
      if (!now[id] && !shadow[id]) delete pending[id];
    });
    meta.migrated = true;
  }

  /* Older app versions kept the cards in the plain 'ops' list. Used once,
     before the first sync, so nothing typed on another phone is stranded. */
  function adoptLegacy(list) {
    if (meta.migrated || !Array.isArray(list) || !list.length) return;
    var have = {};
    (opitems || []).forEach(function (o) { have[o.id] = o; });
    var seeds = {};
    (typeof SEED_OPS !== 'undefined' ? SEED_OPS : []).forEach(function (o) { seeds[o.id] = canon(cardNode(o)); });
    list.forEach(function (o) {
      if (!o || !o.id) return;
      var mine = have[o.id];
      if (!mine) { opitems.push(o); return; }
      if (seeds[o.id] === canon(cardNode(mine))) Object.assign(mine, o);   // replace an untouched seed
    });
    try { localStorage.setItem('sakal-ops', JSON.stringify(opitems)); } catch (e) {}
  }

  /* take a document the sheet handed us, from ?operation=1 or from ?modules=1 */
  function absorb(doc, force, fromPush) {
    backendOk = true;
    meta.oldBackendAt = 0;
    var before = meta.version;
    adopt(doc);
    if (!meta.migrated) migrate();
    rebuildLists();
    saveState();
    state = 'idle';
    if (before !== meta.version || force) redraw(); else note();
    if (!fromPush && Object.keys(pending).length) schedule(200);
  }

  /* The boot already asks for ?modules=1. A V10 sheet includes 'operation'
     in that answer, so no second request is needed; a V9 sheet leaves it
     out, which is how we know not to keep asking. */
  function fromModules(modules) {
    lastPull = Date.now();
    if (modules && modules.operation && Array.isArray(modules.operation['@graph'])) {
      if (!inFlight) absorb(modules.operation, true, false);
      return;
    }
    oldBackend();
  }
  function oldBackend() {
    backendOk = false;
    state = 'old-backend';
    meta.oldBackendAt = Date.now();
    saveState();
    note();
  }

  async function pull(force, fromPush) {
    /* On a V9 sheet ?operation=1 returns the WHOLE order list — never
       ask it on a timer. Only a Refresh tap (force) or every 30 min. */
    if (!force && !fromPush && state === 'old-backend' && Date.now() - (meta.oldBackendAt || 0) < 1800000) return false;
    if (!fromPush && backendOk && Object.keys(pending).length && !inFlight) { await push(); }
    if (inFlight && !fromPush) return false;
    lastPull = Date.now();
    try {
      var r = await fetch(API_URL + '?operation=1', { redirect: 'follow' });
      var text = await r.text(), res = {};
      try { res = JSON.parse(text); } catch (_) {}
      if (res.status !== 'success' || !res.doc) {
        // A V9 script answers ?operation=1 with the order list.
        if (res.status === 'success') oldBackend(); else { state = 'offline'; note(); }
        return false;
      }
      if (inFlight && !fromPush) return false;   // a save started meanwhile; its answer is newer
      absorb(res.doc, force, fromPush);
      return true;
    } catch (err) {
      state = 'offline';
      note();
      return false;
    }
  }

  function hasPending() {
    return !!inFlight || !!timer || Object.keys(pending).length > 0;
  }

  /* the small line under the Operation stats */
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return formatDisplayDate(iso);
  }
  function note() {
    var el = document.getElementById('ops-sync-note');
    if (!el) return;
    var n = Object.keys(pending).length;
    var txt =
        state === 'saving'      ? 'Saving to the sheet…'
      : state === 'old-backend' ? 'On this device only — the sheet needs Apps Script V10 to share this page' + (n ? ' · ' + n + ' waiting' : '')
      : state === 'offline'     ? 'No connection — ' + (n ? n + ' change' + (n > 1 ? 's' : '') + ' waiting to send' : 'showing the last copy')
      : n                       ? n + ' change' + (n > 1 ? 's' : '') + ' waiting to send'
      : 'Shared with every device · synced ' + ago(meta.synced);
    el.textContent = txt;
    el.style.color = state === 'old-backend' || state === 'offline' ? 'var(--danger)' : 'var(--faint)';
  }

  /* keep pulling while someone might be looking */
  function tick() {
    if (document.visibilityState !== 'visible') return;
    if (hasPending()) { if (!inFlight && !timer && Object.keys(pending).length) push(); return; }
    if (state === 'old-backend') { note(); return; }
    /* only while someone is looking at Operation; elsewhere the app
       catches up on focus and when the page is opened */
    var onOps = typeof currentPage !== 'undefined' && currentPage === 'ops';
    if (onOps && Date.now() - lastPull >= 30000) pull();
    else note();
  }
  function start() {
    if (poller) return;
    poller = setInterval(tick, 5000);
    window.addEventListener('focus', function () { if (Date.now() - lastPull > 60000) pull(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { if (Date.now() - lastPull > 60000) pull(); }
      else if (timer) { clearTimeout(timer); timer = null; push(); }
    });
  }

  /* the whole register as JSON-LD, e.g. for an export or a look in the console */
  function toJsonLd() {
    var view = merged();
    return {
      '@context': OPS_CONTEXT,
      '@id': 'urn:sakal:operation',
      '@type': 'sakal:OperationRegister',
      version: meta.version,
      '@graph': Object.keys(view).map(function (id) { return view[id]; })
    };
  }

  return {
    persist: persist, push: push, pull: pull, start: start, fromModules: fromModules,
    /* opening the Operation page: catch up if the copy is more than 15 s old */
    onOpen: function () { if (Date.now() - lastPull > 15000) pull(); else note(); },
    hasPending: hasPending, adoptLegacy: adoptLegacy, toJsonLd: toJsonLd,
    note: note,
    /* for the test harness */
    _state: function () { return { shadow: shadow, pending: pending, meta: meta, state: state }; }
  };
})();

/* Download the shared register as a .jsonld file. */
function exportOperationJsonLd() {
  var blob = new Blob([JSON.stringify(OpsSync.toJsonLd(), null, 2)], {type: 'application/ld+json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sakal-operation-' + todayYMD() + '.jsonld';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  showToast('Downloaded ' + a.download);
}
