/* ══════════════════════════════════════════════════
   CrudScreen
   The shape every list screen in this app already had:
   a collection, some filters, a search box, a table,
   and a modal to add or edit one row.

   Stock, Leads, Customers, Operation and the Price list
   were all writing that out longhand.  This holds the
   common half so a screen only has to say what is
   different about it.

   Nothing here talks to the network.  Saving still goes
   through the persist* functions in 02-core.js.
   ══════════════════════════════════════════════════ */

class CrudScreen {
  /*
    name        label used in toasts, e.g. 'Stock item'
    collection  name of the global array, e.g. 'stock'
    persist     name of the persist function, e.g. 'persistStock'
    contentId   element the table is drawn into
    searchId    the search input, if the screen has one
    modalId     the add/edit modal wrapper
    fields      { 'element-id': 'rowProperty' } for the modal
    filters     starting filter values
  */
  constructor(opts) {
    this.name = opts.name || 'Item';
    this.collection = opts.collection;
    this.persistFn = opts.persist;
    this.contentId = opts.contentId;
    this.searchId = opts.searchId || '';
    this.modalId = opts.modalId || '';
    this.fields = opts.fields || {};
    this.filters = Object.assign({}, opts.filters);
    /* wording for the three toasts, overridable per screen */
    this.toasts = Object.assign({
      added: this.name + ' added',
      updated: this.name + ' updated',
      removed: this.name + ' removed'
    }, opts.toasts);
    /* which field takes the cursor when the modal opens */
    this.focusId = opts.focusId || Object.keys(this.fields)[0] || '';
    this.editId = '';
  }

  /* ── the collection lives on window so the parts of the app
        that have not been converted yet still see the same array ── */
  get rows() { return window[this.collection] || []; }
  set rows(v) { window[this.collection] = v; }

  find(id) {
    return this.rows.filter(function (r) { return r.id === id; })[0] || null;
  }

  persist() {
    var fn = window[this.persistFn];
    if (typeof fn === 'function') fn();
  }

  /* ── filters ── */

  /* a group of buttons where one is on at a time, e.g. [data-stockcat] */
  setFilter(key, value, attr) {
    this.filters[key] = value;
    if (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute(attr) === value);
      });
    }
    this.render();
  }

  /* a single on/off button, e.g. "only show what needs reordering" */
  toggleFilter(key, buttonId) {
    this.filters[key] = !this.filters[key];
    var b = document.getElementById(buttonId);
    if (b) b.classList.toggle('on', this.filters[key]);
    this.render();
  }

  get term() {
    var el = this.searchId ? document.getElementById(this.searchId) : null;
    return el ? el.value.trim().toLowerCase() : '';
  }

  /* ── the list ── */

  /* subclasses say which rows survive the filters, and in what order */
  keep() { return true; }
  compare() { return 0; }

  visible() {
    var self = this, t = this.term;
    return this.rows
      .filter(function (r) { return self.keep(r, t); })
      .sort(function (a, b) { return self.compare(a, b); });
  }

  /* subclasses build the html; this just puts it on the page */
  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;
    el.innerHTML = this.html(this.visible());
    if (typeof updateCounts === 'function') updateCounts();
  }

  html() { return ''; }

  /* ── the modal ── */

  open(id) {
    this.editId = id || '';
    var row = id ? this.find(id) : null;
    var title = document.getElementById(this.modalId + '-title');
    if (title) title.textContent = this.title(row);
    this.fill(row);
    var m = document.getElementById(this.modalId);
    if (m) m.classList.add('open');
    var first = this.focusId;
    if (first) setTimeout(function () {
      var f = document.getElementById(first);
      if (f) f.focus();
    }, 60);
  }

  /* what the modal heading says.  Override where a screen names the
     record itself, e.g. "Lead — Teo I-Jen". */
  title(row) {
    return (row ? 'Edit ' : 'Add ') + this.name.toLowerCase();
  }

  close() {
    var m = document.getElementById(this.modalId);
    if (m) m.classList.remove('open');
    this.editId = '';
  }

  /* put a row into the form.  Override when a field needs a smarter
     default than "" for a new record. */
  fill(row) {
    var self = this;
    Object.keys(this.fields).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.value = row ? (row[self.fields[id]] || '') : '';
    });
  }

  /* read the form back out.  Override to trim, coerce or add extras. */
  collect() {
    var self = this, out = {};
    Object.keys(this.fields).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) out[self.fields[id]] = String(el.value || '').trim();
    });
    return out;
  }

  /* mark a required field as bad and stop the save */
  reject(fieldId) {
    var f = document.getElementById(fieldId);
    var e = document.getElementById(fieldId + '-err');
    if (e) e.classList.add('show');
    if (f) { f.classList.add('err'); f.focus(); }
    return false;
  }

  clearErrors() {
    var self = this;
    Object.keys(this.fields).forEach(function (id) {
      var f = document.getElementById(id);
      var e = document.getElementById(id + '-err');
      if (e) e.classList.remove('show');
      if (f) f.classList.remove('err');
    });
  }

  /* subclasses override to check required fields; return false to stop */
  validate() { return true; }

  save() {
    if (this.validate() === false) return;
    var payload = this.collect();
    if (this.editId) {
      var i = -1, id = this.editId, list = this.rows;
      for (var n = 0; n < list.length; n++) if (list[n].id === id) { i = n; break; }
      if (i > -1) list[i] = Object.assign(list[i], payload);
    } else {
      payload.id = uid();
      this.rows.unshift(payload);
    }
    var wasEdit = !!this.editId;
    this.persist();
    this.close();
    this.render();
    showToast(wasEdit ? this.toasts.updated : this.toasts.added);
  }

  remove() {
    if (!this.editId) return;
    var id = this.editId;
    this.rows = this.rows.filter(function (r) { return r.id !== id; });
    this.persist();
    this.close();
    this.render();
    showToast(this.toasts.removed);
  }

  /* ── keeping the old onclick="" handlers working ──
     The markup calls things like openStockModal('s3').  Rather than
     rewrite 271 handlers in one go, a screen publishes the names the
     markup already uses and they land on the instance. */
  expose(map) {
    var self = this;
    Object.keys(map).forEach(function (globalName) {
      var method = map[globalName];
      window[globalName] = function () {
        return self[method].apply(self, arguments);
      };
    });
  }
}
