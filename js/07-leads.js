/* ══════════════════════════════════════════════════
   LEADS
   Every enquiry, from first message to first order.

   A CrudScreen (see js/lib/00-crud-screen.js).
   ══════════════════════════════════════════════════ */

function isYes(v) { return String(v || '').toLowerCase() === 'yes'; }

function leadStage(l) {
  if (isYes(l.purchased)) return 'Purchased';
  if (isYes(l.attended)) return 'Attended';
  if (isYes(l.booked)) return 'Booked';
  return 'Enquiry';
}

function stageTag(s) {
  var tone = { Purchased: 'green', Attended: 'gold', Booked: 'blue', Enquiry: '' }[s] || '';
  return '<span class="tag ' + tone + '">' + esc(s) + '</span>';
}

class LeadsScreen extends CrudScreen {
  constructor() {
    super({
      name: 'Lead',
      collection: 'leads',
      persist: 'persistLeads',
      contentId: 'leads-content',
      searchId: 'leads-search',
      modalId: 'lead-modal',
      focusId: 'ld-name',
      filters: { stage: 'all' },
      fields: {
        'ld-name': 'name', 'ld-date': 'date', 'ld-phone': 'phone',
        'ld-email': 'email', 'ld-source': 'source', 'ld-consult': 'consultDate',
        'ld-purchdate': 'purchaseDate', 'ld-follow': 'followUp', 'ld-remarks': 'remarks'
      }
    });
    /* the three Yes/No pills in the form, before they are saved */
    this.flags = { booked: false, attended: false, purchased: false };
  }

  setStage(f) { this.setFilter('stage', f, 'data-leadfilter'); }

  keep(l, term) {
    var f = this.filters.stage;
    if (f === 'new' && (isYes(l.booked) || isYes(l.purchased))) return false;
    if (f === 'booked' && !isYes(l.booked)) return false;
    if (f === 'attended' && !isYes(l.attended)) return false;
    if (f === 'won' && !isYes(l.purchased)) return false;
    if (f === 'followup' && !l.followUp) return false;
    if (!term) return true;
    return [l.name, l.phone, l.email, l.source, l.remarks]
      .some(function (v) { return hit(v, term); });
  }

  compare(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }

  /* click Booked / Came / Bought straight on the row.
     Marking a later stage fills in the earlier ones. */
  cycle(id, field) {
    var l = this.find(id);
    if (!l) return;
    l[field] = isYes(l[field]) ? 'No' : 'Yes';
    if (field === 'purchased' && isYes(l.purchased)) {
      if (!l.purchaseDate) l.purchaseDate = todayYMD();
      l.booked = 'Yes'; l.attended = 'Yes';
    }
    if (field === 'attended' && isYes(l.attended)) l.booked = 'Yes';
    this.persist();
    this.render();
    updateCounts();
  }

  render() {
    var el = document.getElementById(this.contentId);
    if (!el) return;

    var total = leads.length;
    var booked = leads.filter(function (l) { return isYes(l.booked); }).length;
    var attended = leads.filter(function (l) { return isYes(l.attended); }).length;
    var won = leads.filter(function (l) { return isYes(l.purchased); }).length;
    var conv = total ? Math.round(won / total * 1000) / 10 : 0;

    $('leads-stats').innerHTML =
        stat('Leads', total, 'Every enquiry logged')
      + stat('Consultations booked', booked, total ? Math.round(booked / total * 100) + '% of leads' : '—')
      + stat('Attended', attended, booked ? Math.round(attended / booked * 100) + '% of bookings kept' : 'No bookings yet')
      + stat('Purchased', won, conv + '% of leads convert', won ? 'ok' : '');

    var rows = this.visible();

    if (rows.length === 0) {
      el.innerHTML = leads.length === 0
        ? emptyState('No leads yet', 'Log every enquiry as it comes in — website, Google, Instagram, walk-in — and watch what converts.', '<button class="btn gold" onclick="openLeadModal()">+ New lead</button>')
        : emptyState('Nothing matches', 'Try a name, a phone number, or where the lead came from.');
      updateCounts();
      return;
    }

    el.innerHTML = this.html(rows);
    updateCounts();
  }

  html(rows) {
    var self = this;
    var body = rows.map(function (l) { return self.row(l); }).join('');
    return '<div class="table-wrap"><div class="tscroll"><table class="grid" style="min-width:1040px">'
      + '<thead><tr><th>Enquired</th><th>Name</th><th>Contact</th><th>Source</th><th>Stage</th>'
      + '<th>Progress</th><th>Consultation</th><th>Follow up</th><th></th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></div></div>';
  }

  row(l) {
    var due = l.followUp && !isYes(l.purchased) && isOverdue(l.followUp);
    var contact = [l.phone, l.email].filter(Boolean);
    return '<tr class="' + (due ? 'row-flag' : '') + '">'
      + '<td>' + esc(formatDisplayDate(l.date)) + '</td>'
      + '<td><div class="cell-strong">' + esc(l.name) + '</div>'
      + (l.remarks ? '<div class="cell-sub">' + esc(l.remarks) + '</div>' : '') + '</td>'
      + '<td>' + (l.phone ? '<div>' + esc(l.phone) + '</div>' : '')
      + (l.email ? '<div class="cell-sub">' + esc(l.email) + '</div>' : '')
      + (contact.length ? '' : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td><span class="tag">' + esc(l.source || '—') + '</span></td>'
      + '<td>' + stageTag(leadStage(l)) + '</td>'
      + '<td class="acts" style="white-space:nowrap">'
      + '<span class="yn' + (isYes(l.booked) ? ' y' : ' n') + '" onclick="cycleLead(\'' + esc(l.id) + '\',\'booked\')">Booked</span> '
      + '<span class="yn' + (isYes(l.attended) ? ' y' : ' n') + '" onclick="cycleLead(\'' + esc(l.id) + '\',\'attended\')">Came</span> '
      + '<span class="yn' + (isYes(l.purchased) ? ' y' : ' n') + '" onclick="cycleLead(\'' + esc(l.id) + '\',\'purchased\')">Bought</span>'
      + '</td>'
      + '<td>' + (l.consultDate ? esc(formatDisplayDate(l.consultDate)) : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td>' + (l.followUp ? '<span style="' + (due ? 'color:var(--danger);font-weight:600' : '') + '">' + esc(formatDisplayDate(l.followUp)) + '</span>' : '<span style="color:var(--faint)">—</span>') + '</td>'
      + '<td class="acts"><button class="btn sm" onclick="openLeadModal(\'' + esc(l.id) + '\')">Open</button></td>'
      + '</tr>';
  }

  /* ── the modal ── */
  title(l) { return l ? 'Lead — ' + l.name : 'New lead'; }

  toggleFlag(k) {
    this.flags[k] = !this.flags[k];
    $('ld-' + k).classList.toggle('on', this.flags[k]);
  }

  fill(l) {
    var self = this;
    $('ld-name').value  = l ? (l.name || '') : '';
    $('ld-date').value  = l ? parseToYMD(l.date) : todayYMD();
    $('ld-phone').value = l ? (l.phone || '') : '';
    $('ld-email').value = l ? (l.email || '') : '';
    $('ld-source').value = l && l.source ? l.source : 'Website';
    /* a source typed in on an older version may not be in the list */
    if (l && l.source && !Array.from($('ld-source').options).some(function (o) { return o.value === l.source; })) {
      var opt = document.createElement('option');
      opt.textContent = l.source;
      $('ld-source').appendChild(opt);
      $('ld-source').value = l.source;
    }
    $('ld-consult').value   = l ? parseToYMD(l.consultDate) : '';
    $('ld-purchdate').value = l ? parseToYMD(l.purchaseDate) : '';
    $('ld-follow').value    = l ? parseToYMD(l.followUp) : '';
    $('ld-remarks').value   = l ? (l.remarks || '') : '';

    ['booked', 'attended', 'purchased'].forEach(function (k) {
      self.flags[k] = l ? isYes(l[k]) : false;
      $('ld-' + k).classList.toggle('on', self.flags[k]);
    });
    $('ld-delete').style.display = l ? '' : 'none';
    $('ld-name-err').classList.remove('show');
    $('ld-name').classList.remove('err');
  }

  validate() {
    if (!$('ld-name').value.trim()) return this.reject('ld-name');
    return true;
  }

  collect() {
    return {
      name: $('ld-name').value.trim(),
      date: $('ld-date').value || todayYMD(),
      phone: $('ld-phone').value.trim(),
      email: $('ld-email').value.trim(),
      source: $('ld-source').value,
      booked:    this.flags.booked    ? 'Yes' : 'No',
      attended:  this.flags.attended  ? 'Yes' : 'No',
      purchased: this.flags.purchased ? 'Yes' : 'No',
      consultDate: $('ld-consult').value,
      purchaseDate: $('ld-purchdate').value,
      followUp: $('ld-follow').value,
      remarks: $('ld-remarks').value.trim(),
      updated: todayYMD()
    };
  }

  save() { super.save(); updateCounts(); }
  remove() { super.remove(); updateCounts(); }

  export() {
    var rows = [['Date', 'Name', 'Phone', 'Email', 'Source', 'Consultation booked', 'Consultation date', 'Attended', 'Purchased', 'Purchase date', 'Follow-up date', 'Remarks']];
    leads.forEach(function (l) {
      rows.push([l.date, l.name, l.phone, l.email, l.source, l.booked, l.consultDate,
                 l.attended, l.purchased, l.purchaseDate, l.followUp, l.remarks]);
    });
    downloadCsv('sakal-leads.csv', rows);
  }
}

var leadsScreen = new LeadsScreen();

/* the names the markup already calls */
leadsScreen.expose({
  renderLeads:   'render',
  setLeadFilter: 'setStage',
  cycleLead:     'cycle',
  toggleLd:      'toggleFlag',
  openLeadModal: 'open',
  closeLeadModal:'close',
  saveLeadForm:  'save',
  deleteLead:    'remove',
  exportLeads:   'export'
});
