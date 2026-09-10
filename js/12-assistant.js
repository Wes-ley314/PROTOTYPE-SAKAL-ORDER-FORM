/* ══════════════════════════════════════════════════
   ASSISTANT
   Two things in one place. The reports are worked out
   here, from the shop's own records, so the numbers are
   exact and arrive with no key and no waiting. The
   conversation on top of them is what needs a model —
   it is handed the same reports, and can propose changes
   for you to approve.
   ══════════════════════════════════════════════════ */

var chatLog = [], chatBusy = false, pendingActions = null;

function aiCfg() {
  var c = {};
  try { c = JSON.parse(localStorage.getItem('sakal-ai') || '{}'); } catch(e) {}
  return {mode: c.mode || 'sheet', key: c.key || '', model: c.model || 'claude-sonnet-4-6'};
}
function saveAiCfg(c) { try { localStorage.setItem('sakal-ai', JSON.stringify(c)); } catch(e) {} }
function aiReady() { var c = aiCfg(); return c.mode === 'sheet' || !!c.key; }

/* ── Small helpers the reports lean on ── */
function monthKey(d) { return String(d || '').substring(0, 7); }
function monthName(k) {
  if (!k || k.length < 7) return '—';
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[parseInt(k.substring(5,7),10)-1] + ' ' + k.substring(0,4);
}
function daysBetween(a, b) {
  var x = new Date(parseToYMD(a)), y = new Date(parseToYMD(b));
  if (isNaN(x) || isNaN(y)) return null;
  return Math.round((y - x) / 86400000);
}
function orderDone(o) {
  var it = o.items || [];
  return it.length > 0 && it.every(function(i){ return i.status === 'Take Home'; });
}
function orderStage(o) {
  var it = (o.items || []).filter(function(i){ return i.status !== 'Take Home'; });
  if (!it.length) return 'Take Home';
  var seen = {};
  it.forEach(function(i){ seen[i.status || 'Not started'] = true; });
  return Object.keys(seen).join(' / ');
}

/* ══ THE REPORTS ══════════════════════════════════ */

function reportRevenue() {
  var by = {};
  invoices.forEach(function(v) {
    var k = monthKey(v.issued); if (!k) return;
    if (!by[k]) by[k] = {n: 0, total: 0};
    by[k].n++; by[k].total += invoiceTotal(v);
  });
  var keys = Object.keys(by).sort();
  if (!keys.length) return 'No invoices on file yet, so there is nothing to add up.';
  var recent = keys.slice(-12);
  var grand = keys.reduce(function(s,k){ return s + by[k].total; }, 0);
  var best = keys.reduce(function(a,k){ return by[k].total > by[a].total ? k : a; }, keys[0]);
  var avg = grand / keys.length;

  var lines = recent.map(function(k) {
    var m = by[k];
    var bar = '▍'.repeat(Math.max(1, Math.round(m.total / Math.max(1, by[best].total) * 18)));
    return '- **' + monthName(k) + '** — S$ ' + money(m.total)
      + ' from ' + m.n + ' invoice' + (m.n===1?'':'s') + '  \n  ' + bar;
  });
  var last = by[keys[keys.length-1]], prev = keys.length > 1 ? by[keys[keys.length-2]] : null;
  var move = prev ? (last.total - prev.total) : 0;

  return 'Revenue by month, from every invoice on file.\n\n' + lines.join('\n') + '\n\n'
    + 'Best month was **' + monthName(best) + '** at S$ ' + money(by[best].total) + '. '
    + 'The average is S$ ' + money(avg) + ' a month across ' + keys.length + ' month'
    + (keys.length===1?'':'s') + ', S$ ' + money(grand) + ' in all.'
    + (prev ? '\n\n' + monthName(keys[keys.length-1]) + ' is '
        + (move >= 0 ? 'up S$ ' + money(move) : 'down S$ ' + money(-move))
        + ' on ' + monthName(keys[keys.length-2]) + '.' : '');
}

function reportSpenders(n) {
  n = n || 10;
  var by = {};
  invoices.forEach(function(v) {
    var name = String(v.client || '').trim(); if (!name) return;
    var k = name.toLowerCase();
    if (!by[k]) by[k] = {name: name, total: 0, n: 0, last: ''};
    by[k].total += invoiceTotal(v); by[k].n++;
    if (String(v.issued||'') > by[k].last) by[k].last = v.issued || '';
  });
  var list = Object.keys(by).map(function(k){ return by[k]; })
                   .sort(function(a,b){ return b.total - a.total; });
  if (!list.length) return 'Nobody has been invoiced yet.';
  var grand = list.reduce(function(s,c){ return s + c.total; }, 0);
  var top = list.slice(0, n);
  var topShare = top.reduce(function(s,c){ return s + c.total; }, 0);

  return 'Your best customers by what they have been billed.\n\n'
    + top.map(function(c, i) {
        return '- **' + (i+1) + '. ' + c.name + '** — S$ ' + money(c.total)
          + ' across ' + c.n + ' invoice' + (c.n===1?'':'s')
          + (c.last ? ', last on ' + formatDisplayDate(c.last) : '');
      }).join('\n')
    + '\n\nThese ' + top.length + ' account for S$ ' + money(topShare) + ' of S$ ' + money(grand)
    + ' — ' + Math.round(topShare / grand * 100) + '% of everything billed, from '
    + list.length + ' customer' + (list.length===1?'':'s') + ' in all.';
}

function reportSlow() {
  var today = todayYMD();
  var live = orders.filter(function(o){ return !orderDone(o); });
  if (!live.length) return 'Nothing is outstanding — every order on the floor is finished.';

  var rows = live.map(function(o) {
    var age = daysBetween(o.date, today);
    var late = o.dueDate ? daysBetween(o.dueDate, today) : null;
    return {o: o, age: age === null ? 0 : age, late: late};
  }).sort(function(a,b) {
    if ((b.late || -9999) !== (a.late || -9999)) return (b.late || -9999) - (a.late || -9999);
    return b.age - a.age;
  });

  var overdue = rows.filter(function(r){ return r.late !== null && r.late > 0; });
  var stale = rows.filter(function(r){ return (r.late === null || r.late <= 0) && r.age > 30; });

  var out = [];
  if (overdue.length) {
    out.push('**Past their due date**\n' + overdue.slice(0, 15).map(function(r) {
      return '- ' + r.o.orderNum + ' · ' + (r.o.customerName || 'no name')
        + ' — **' + r.late + ' day' + (r.late===1?'':'s') + ' over**, due '
        + formatDisplayDate(r.o.dueDate) + ' · ' + orderStage(r.o);
    }).join('\n'));
  }
  if (stale.length) {
    out.push('**On the floor a long time**\n' + stale.slice(0, 15).map(function(r) {
      return '- ' + r.o.orderNum + ' · ' + (r.o.customerName || 'no name')
        + ' — ' + r.age + ' days since it was taken · ' + orderStage(r.o);
    }).join('\n'));
  }
  if (!out.length) out.push('Nothing is late and nothing has been sitting more than a month.');

  var stuck = live.filter(function(o){ return (o.items||[]).some(function(i){ return i.stuck; }); });
  if (stuck.length) {
    out.push('**Marked stuck**\n' + stuck.map(function(o) {
      return '- ' + o.orderNum + ' · ' + (o.customerName || 'no name');
    }).join('\n'));
  }
  out.push(live.length + ' order' + (live.length===1?'':'s') + ' still open, '
    + overdue.length + ' past due.');
  return out.join('\n\n');
}

function reportStock() {
  var byCat = {}, byLoc = {Batam: 0, Singapore: 0};
  stock.forEach(function(s) {
    var c = catOf(s);
    byCat[c] = (byCat[c] || 0) + 1;
    if (byLoc[s.loc] !== undefined) byLoc[s.loc]++;
  });
  var flagged = stock.filter(function(s){ return s.reorder; });
  var old = stock.filter(function(s) {
    var d = s.purchased ? daysBetween(s.purchased, todayYMD()) : null;
    return d !== null && d > 180 && !s.reorder;
  });

  var out = ['**What is held**\n' + Object.keys(byCat).map(function(c) {
    return '- ' + c + ' — ' + byCat[c] + ' item' + (byCat[c]===1?'':'s');
  }).join('\n') + '\n- Batam ' + byLoc.Batam + ' · Singapore ' + byLoc.Singapore
    + ' · ' + stock.length + ' in all'];

  out.push(flagged.length
    ? '**Flagged to reorder**\n' + flagged.map(function(s) {
        return '- ' + s.item + (s.color ? ' · ' + s.color : '') + ' — ' + catOf(s) + ', ' + s.loc
          + (s.supplier ? ' · ' + s.supplier : '');
      }).join('\n')
    : '**Flagged to reorder**\nNothing is flagged.');

  if (old.length) {
    out.push('**Not bought in over six months**\n' + old.slice(0, 12).map(function(s) {
      return '- ' + s.item + ' — last bought ' + formatDisplayDate(s.purchased);
    }).join('\n'));
  }
  return out.join('\n\n');
}

function reportLeads() {
  var total = leads.length;
  if (!total) return 'No leads logged yet.';
  var booked = leads.filter(function(l){ return isYes(l.booked); }).length;
  var came   = leads.filter(function(l){ return isYes(l.attended); }).length;
  var won    = leads.filter(function(l){ return isYes(l.purchased); }).length;

  var bySrc = {};
  leads.forEach(function(l) {
    var s = l.source || 'Unknown';
    if (!bySrc[s]) bySrc[s] = {n: 0, won: 0};
    bySrc[s].n++; if (isYes(l.purchased)) bySrc[s].won++;
  });
  var src = Object.keys(bySrc).sort(function(a,b){ return bySrc[b].n - bySrc[a].n; });

  var overdue = leads.filter(function(l) {
    return l.followUp && !isYes(l.purchased) && isOverdue(l.followUp);
  });

  return 'Out of **' + total + ' leads**, ' + booked + ' booked a consultation, '
    + came + ' turned up and ' + won + ' bought — a conversion of **'
    + Math.round(won / total * 100) + '%**.\n\n'
    + '**Where they come from**\n' + src.map(function(s) {
        return '- ' + s + ' — ' + bySrc[s].n + ' lead' + (bySrc[s].n===1?'':'s')
          + ', ' + bySrc[s].won + ' bought'
          + (bySrc[s].n >= 3 ? ' (' + Math.round(bySrc[s].won/bySrc[s].n*100) + '%)' : '');
      }).join('\n')
    + (overdue.length
        ? '\n\n**Follow-ups already past**\n' + overdue.slice(0, 12).map(function(l) {
            return '- ' + l.name + ' — was due ' + formatDisplayDate(l.followUp)
              + (l.phone ? ' · ' + l.phone : '');
          }).join('\n')
        : '\n\nNo follow-up dates have slipped.');
}

function reportDelta() {
  var live = deltaOrders.filter(function(o){ return !o.archived; });
  if (!live.length) return 'Nothing is with Delta.';
  var unpaid = live.filter(function(o){ return !o.paid; });
  var owed = unpaid.reduce(function(s,o){ return s + (o.total||0); }, 0);
  var stages = {};
  live.forEach(function(o){ var s = deltaStage(o); stages[s] = (stages[s]||0)+1; });
  var late = live.filter(function(o){ return !o.delivered && o.dueDate && isOverdue(o.dueDate); });

  return live.length + ' jacket' + (live.length===1?'':'s') + ' with Delta.\n\n'
    + '**Where they are**\n' + Object.keys(stages).map(function(s) {
        return '- ' + s + ' — ' + stages[s];
      }).join('\n')
    + '\n\n**Money**\n- Unpaid to Delta: S$ ' + money(owed) + ' across ' + unpaid.length + ' order'
    + (unpaid.length===1?'':'s')
    + '\n- Total making charges on the bench: S$ '
    + money(live.reduce(function(s,o){ return s + (o.total||0); }, 0))
    + (late.length
        ? '\n\n**Overdue back from Delta**\n' + late.map(function(o) {
            return '- ' + o.orderNum + ' — was due ' + formatDisplayDate(o.dueDate);
          }).join('\n')
        : '\n\nNothing is overdue back from Delta.');
}

function reportToday() {
  var t = todayYMD();
  var live = orders.filter(function(o){ return !orderDone(o); });
  var soon = live.filter(function(o){ return o.dueDate && daysBetween(t, o.dueDate) !== null
                                          && daysBetween(t, o.dueDate) >= 0 && daysBetween(t, o.dueDate) <= 7; });
  var fittings = orders.filter(function(o){ return o.fittingDate && daysBetween(t, o.fittingDate) >= 0
                                                 && daysBetween(t, o.fittingDate) <= 7; });
  var late = live.filter(function(o){ return o.dueDate && isOverdue(o.dueDate); });
  var thisMonth = invoices.filter(function(v){ return monthKey(v.issued) === monthKey(t); });
  var billed = thisMonth.reduce(function(s,v){ return s + invoiceTotal(v); }, 0);

  return '**' + formatDisplayDate(t) + '**\n\n'
    + '- ' + live.length + ' order' + (live.length===1?'':'s') + ' on the floor, ' + late.length + ' past due\n'
    + '- ' + soon.length + ' due in the next week\n'
    + '- ' + fittings.length + ' fitting' + (fittings.length===1?'':'s') + ' in the next week\n'
    + '- S$ ' + money(billed) + ' invoiced this month across ' + thisMonth.length + ' invoice'
    + (thisMonth.length===1?'':'s') + '\n'
    + '- ' + stock.filter(function(s){ return s.reorder; }).length + ' stock item(s) flagged to reorder\n'
    + '- ' + deltaOrders.filter(function(o){ return !o.archived && !o.paid; }).length + ' Delta order(s) unpaid'
    + (soon.length
        ? '\n\n**Due this week**\n' + soon.sort(function(a,b){ return String(a.dueDate).localeCompare(String(b.dueDate)); })
            .map(function(o) {
              return '- ' + formatDisplayDate(o.dueDate) + ' — ' + o.orderNum + ' · '
                + (o.customerName || 'no name') + ' · ' + orderStage(o);
            }).join('\n')
        : '');
}

/* ══════════════════════════════════════════════════
   ANSWERING WITHOUT A MODEL
   Most of what gets asked across a bench is a lookup:
   what has this person spent, where is that order, what
   is late. Those are worked out here, exactly, and need
   nothing set up. Only the open-ended questions go out.
   ══════════════════════════════════════════════════ */

/* Every name the shop knows, from any of the lists. */
function knownNames() {
  var seen = {};
  function add(n) {
    n = String(n || '').trim();
    if (n.length < 2) return;
    var k = n.toLowerCase();
    if (!seen[k]) seen[k] = n;
  }
  invoices.forEach(function(v){ add(v.client); });
  orders.concat(archivedOrders).forEach(function(o){ add(o.customerName); });
  customers.forEach(function(c){ add(c.name); });
  leads.forEach(function(l){ add(l.name); });
  return Object.keys(seen).map(function(k){ return {key: k, name: seen[k]}; });
}

/* Finds the person a question is about — the whole name if it is there,
   otherwise a distinctive part of one. */
function nameInQuestion(q) {
  var s = ' ' + String(q||'').toLowerCase().replace(/[^\w\s'-]/g, ' ') + ' ';
  var names = knownNames(), best = null;
  names.forEach(function(n) {
    if (s.indexOf(' ' + n.key + ' ') !== -1 || s.indexOf(n.key) !== -1) {
      if (!best || n.key.length > best.key.length) best = n;
    }
  });
  if (best) return best.name;
  var words = s.split(/\s+/).filter(function(w){ return w.length >= 4; });
  names.forEach(function(n) {
    n.key.split(/\s+/).forEach(function(part) {
      if (part.length >= 4 && words.indexOf(part) !== -1) {
        if (!best || n.key.length > best.key.length) best = n;
      }
    });
  });
  return best ? best.name : null;
}

/* Everything the shop holds on one person. */
function reportPerson(name) {
  var k = String(name).toLowerCase();
  var bills = invoices.filter(function(v){ return String(v.client||'').toLowerCase() === k; })
                      .sort(function(a,b){ return String(b.issued).localeCompare(String(a.issued)); });
  var theirOrders = orders.concat(archivedOrders)
                          .filter(function(o){ return String(o.customerName||'').toLowerCase() === k; });
  var c = customers.find(function(x){ return String(x.name||'').toLowerCase() === k; });
  var l = leads.find(function(x){ return String(x.name||'').toLowerCase() === k; });

  var spent = bills.reduce(function(s,v){ return s + invoiceTotal(v); }, 0);
  var out = ['**' + name + '**'];

  var contact = [];
  if (c && c.phone) contact.push(c.phone);
  if (c && c.email) contact.push(c.email);
  if (!contact.length && l) { if (l.phone) contact.push(l.phone); if (l.email) contact.push(l.email); }
  if (!contact.length) {
    var o0 = theirOrders.find(function(o){ return o.customerContact || o.customerEmail; });
    if (o0) { if (o0.customerContact) contact.push(o0.customerContact); if (o0.customerEmail) contact.push(o0.customerEmail); }
  }
  if (contact.length) out.push(contact.join(' · '));

  if (bills.length) {
    out.push('Spent **S$ ' + money(spent) + '** across ' + bills.length + ' invoice'
      + (bills.length===1?'':'s') + '.');
    out.push(bills.map(function(v) {
      var what = (v.lines||[]).map(function(x){ return x.desc; }).filter(Boolean).join(', ');
      return '- ' + (v.issued ? formatDisplayDate(v.issued) : 'no date') + ' · ' + v.no
        + ' · S$ ' + money(invoiceTotal(v)) + (what ? ' · ' + what : '')
        + ' · ' + invoiceStatus(v);
    }).join('\n'));
    var first = bills[bills.length-1].issued, last = bills[0].issued;
    if (bills.length > 1 && first && last) {
      out.push('First bought ' + formatDisplayDate(first) + ', last ' + formatDisplayDate(last)
        + ' — an average of S$ ' + money(spent / bills.length) + ' an order.');
    }
  } else {
    out.push('Nothing has been invoiced to this name.');
  }

  if (theirOrders.length) {
    out.push('**On the floor**\n' + theirOrders.map(function(o) {
      return '- ' + o.orderNum + (o.dueDate ? ' · due ' + formatDisplayDate(o.dueDate) : '')
        + ' · ' + (o.items||[]).map(function(i){ return i.product; }).join(', ')
        + ' · ' + (o.archived ? 'archived' : orderStage(o));
    }).join('\n'));
  }
  if (l) {
    out.push('Came in as a lead on ' + formatDisplayDate(l.date) + ' from ' + (l.source || 'an unknown source')
      + ' — ' + leadStage(l) + (l.remarks ? '. ' + l.remarks : '.'));
  }
  return out.join('\n\n');
}

function reportRecord(num) {
  var out = [];
  var o = findOrder(num);
  if (o) {
    out.push('**Order ' + o.orderNum + '** · ' + (o.customerName || 'no name')
      + (o.customerContact ? ' · ' + o.customerContact : ''));
    out.push('Taken ' + formatDisplayDate(o.date)
      + (o.fittingDate ? ', fitting ' + formatDisplayDate(o.fittingDate) : '')
      + (o.dueDate ? ', due ' + formatDisplayDate(o.dueDate) : '')
      + (o.dueDate && isOverdue(o.dueDate) && !orderDone(o)
          ? ' — **' + daysBetween(o.dueDate, todayYMD()) + ' days over**' : ''));
    out.push((o.items||[]).map(function(i) {
      return '- ' + i.product + ' · cloth ' + (i.fabric || '—')
        + (i.lining ? ' · lining ' + i.lining : '')
        + ' · ' + (i.status || 'not started') + (i.stuck ? ' · STUCK' : '');
    }).join('\n'));
    if (hasPdf(o.orderNum)) out.push('Order form PDF on file: ' + pdfFor(o.orderNum).name);
    if (o.remarks) out.push(o.remarks);
  }
  var v = invoices.find(function(x){ return String(x.no||'').replace(/\D/g,'') === String(num); });
  if (v) {
    out.push('**Invoice ' + v.no + '** · ' + (v.client || '—') + ' · '
      + (v.issued ? formatDisplayDate(v.issued) : 'no date')
      + ' · S$ ' + money(invoiceTotal(v)) + ' · ' + invoiceStatus(v));
    out.push((v.lines||[]).map(function(l) {
      return '- ' + (l.desc || '—') + ' · ' + (l.qty||1) + ' × S$ ' + money(l.unit||0);
    }).join('\n'));
  }
  var dd = deltaOrders.find(function(x){ return String(x.orderNum) === String(num); });
  if (dd) {
    out.push('**With Delta as ' + dd.orderNum + '** · ' + dd.canvas
      + ((dd.addons||[]).length ? ' + ' + dd.addons.join(', ') : '')
      + ' · ' + deltaStage(dd) + ' · ' + (dd.paid ? 'paid' : 'unpaid'));
  }
  return out.length ? out.join('\n\n') : null;
}

function reportOwing() {
  var open = invoices.filter(function(v){ return invoiceStatus(v) !== 'Paid'; })
                     .sort(function(a,b){ return invoiceTotal(b) - invoiceTotal(a); });
  if (!open.length) return 'Every invoice on file is settled.';
  var total = open.reduce(function(s,v){ return s + invoiceTotal(v); }, 0);
  return 'S$ **' + money(total) + '** is outstanding across ' + open.length + ' invoice'
    + (open.length===1?'':'s') + '.\n\n'
    + open.slice(0, 20).map(function(v) {
        return '- ' + (v.client || '—') + ' · ' + v.no + ' · S$ ' + money(invoiceTotal(v))
          + (v.issued ? ' · issued ' + formatDisplayDate(v.issued) : '') + ' · ' + invoiceStatus(v);
      }).join('\n');
}

/* Reads the question and answers it from the records where it can. */
function localAnswer(q) {
  var s = String(q || '').toLowerCase();

  var num = (s.match(/\b\d{4,7}\b/) || [])[0];
  if (num) { var rec = reportRecord(num); if (rec) return rec; }

  var name = nameInQuestion(q);
  if (name && /spen|spend|spent|paid|bought|buy|order|invoice|owe|worth|history|much|total|customer|client|who is|about/.test(s)) {
    return reportPerson(name);
  }

  if (/revenue|turnover|takings|sales|earn|income|month/.test(s) && !/delta/.test(s)) return reportRevenue();
  if (/top |best |biggest |spender|highest/.test(s)) return reportSpenders(10);
  if (/late|overdue|too long|slow|delay|behind|waiting/.test(s)) return reportSlow();
  if (/stock|reorder|button|lining|packaging|supplies/.test(s)) return reportStock();
  if (/lead|enquir|inquir|conversion|follow up|follow-up/.test(s)) return reportLeads();
  if (/delta|maker|making charge/.test(s)) return reportDelta();
  if (/owe|outstanding|unpaid|debt|collect/.test(s)) return reportOwing();
  if (/today|this week|what.s on|due soon|schedule/.test(s)) return reportToday();

  return null;
}

/* When the model is out of reach, a named person is still better than
   an apology. */
function localFallback(q) {
  var name = nameInQuestion(q);
  return name ? reportPerson(name) : null;
}

var REPORTS = {
  today:    {label: 'Today',           run: reportToday},
  revenue:  {label: 'Monthly revenue', run: reportRevenue},
  spenders: {label: 'Top spenders',    run: function(){ return reportSpenders(10); }},
  slow:     {label: 'Taking too long', run: reportSlow},
  stock:    {label: 'Stock status',    run: reportStock},
  owing:    {label: 'Who owes me',     run: reportOwing},
  leads:    {label: 'Leads',           run: reportLeads},
  delta:    {label: 'Delta',           run: reportDelta}
};

/* Everything the model is given, worked out rather than guessed at. */
function reportPack() {
  return Object.keys(REPORTS).map(function(k) {
    return '### ' + REPORTS[k].label.toUpperCase() + '\n' + REPORTS[k].run();
  }).join('\n\n');
}

/* ── The records themselves, compactly ── */
function shopSnapshot() {
  var live = orders.slice(0, 80).map(function(o) {
    var g = (o.items||[]).map(function(i) {
      return i.product + (i.fabric ? ' [' + i.fabric + ']' : '')
        + (i.lining ? ' lining ' + i.lining : '')
        + ' — ' + (i.status || 'not started') + (i.stuck ? ' STUCK' : '');
    }).join('; ');
    return '- ' + o.orderNum + ' · ' + (o.customerName || 'no name')
      + (o.customerContact ? ' · ' + o.customerContact : '')
      + ' · taken ' + (o.date || '?')
      + (o.fittingDate ? ' · fitting ' + o.fittingDate : '')
      + (o.dueDate ? ' · due ' + o.dueDate : '')
      + ' · ' + (g || 'no garments') + (o.remarks ? ' · note: ' + o.remarks : '');
  }).join('\n');

  var bills = invoices.slice(0, 120).map(function(v) {
    return '- ' + v.no + ' · ' + (v.client || '—') + ' · ' + (v.issued || '')
      + ' · S$' + invoiceTotal(v).toFixed(2) + ' · ' + invoiceStatus(v)
      + ' · ' + ((v.lines||[]).map(function(l){ return l.desc; }).filter(Boolean).join(', ') || 'no lines');
  }).join('\n');

  var st = stock.map(function(s) {
    return '- ' + s.item + ' · ' + catOf(s) + ' · ' + (s.color || '—') + ' · ' + s.loc
      + (s.reorder ? ' · TO REORDER' : '') + (s.purchased ? ' · bought ' + s.purchased : '');
  }).join('\n');

  var dl = deltaOrders.filter(function(o){ return !o.archived; }).map(function(o) {
    return '- ' + o.orderNum + ' · due ' + (o.dueDate || '—') + ' · ' + o.canvas
      + ((o.addons||[]).length ? ' + ' + o.addons.join(', ') : '')
      + ' · S$' + o.total + ' · ' + deltaStage(o)
      + ' · ' + (o.paid ? 'paid' : 'unpaid') + ' · ' + (o.invoice ? 'invoiced' : 'no invoice');
  }).join('\n');

  var ld = leads.map(function(l) {
    return '- ' + l.name + ' · ' + (l.date || '') + ' · ' + (l.source || '?')
      + ' · ' + leadStage(l) + (l.followUp ? ' · follow up ' + l.followUp : '')
      + (l.phone ? ' · ' + l.phone : '') + (l.remarks ? ' · ' + l.remarks : '');
  }).join('\n');

  var ops = opitems.map(function(o) {
    return '- ' + o.type + ' ' + (o.number || '—') + ' · ' + (o.holder || 'unassigned')
      + (o.expiry ? ' · expires ' + o.expiry : '')
      + (o.topup ? ' · topped up ' + o.topup + (o.amount !== '' ? ' at S$' + o.amount : '') : '');
  }).join('\n');

  return [
    'Today is ' + todayYMD() + '. Next running number: ' + nextRunningNo() + '.',
    '', 'ORDERS ON THE FLOOR (' + orders.length + ' live, ' + archivedOrders.length + ' archived):', live || '(none)',
    '', 'INVOICES (' + invoices.length + '):', bills || '(none)',
    '', 'STOCK (' + stock.length + '):', st || '(none)',
    '', 'WITH DELTA (an outside maker — these are costs to the shop, not sales):', dl || '(none)',
    '', 'LEADS (' + leads.length + '):', ld || '(none)',
    '', 'OPERATION CARDS:', ops || '(none)',
    '', 'PRICE LIST: ' + pricelist.length + ' entries across '
      + Array.from(new Set(pricelist.map(function(f){ return f.brand; }))).length + ' brands.',
    'CUSTOMERS: ' + customers.length + ' on file.'
  ].join('\n');
}

/* ══ ACTIONS ══════════════════════════════════════
   The assistant may propose changes. It never makes them;
   it hands you a card and you decide. */
var ACTION_HELP =
  'You may propose changes to the records. Never claim to have made one — you cannot. ' +
  'To propose, end your reply with a fenced block marked `action` holding a JSON array. ' +
  'Each item is one of:\n' +
  '  {"do":"order_stage","order":"260255","product":"Jacket","to":"Batam"}   status: ' +
  '"", "Fabric Ordered", "Bin", "Batam", "Delta", "In-store", "Take Home"\n' +
  '  {"do":"order_date","order":"260255","field":"due","to":"2026-10-05"}    field: "due" or "fitting"\n' +
  '  {"do":"order_stuck","order":"260255","product":"Jacket","to":true}\n' +
  '  {"do":"delta","number":"19684","field":"paid","to":true}               field: paid, invoice, backend, bin, delivered\n' +
  '  {"do":"stock_reorder","item":"Lining FB12","to":true}\n' +
  '  {"do":"lead","name":"Eugene Lee","field":"followUp","to":"2026-09-20"} field: followUp, booked, attended, purchased\n' +
  'Only propose what was clearly asked for. Say in words what you are proposing before the block.';

function actionText(a) {
  if (a.do === 'order_stage')   return 'Order ' + a.order + ' — move the ' + (a.product||'garment').toLowerCase() + ' to ' + (a.to || 'not started');
  if (a.do === 'order_date')    return 'Order ' + a.order + ' — set the ' + a.field + ' date to ' + formatDisplayDate(a.to);
  if (a.do === 'order_stuck')   return 'Order ' + a.order + ' — mark the ' + (a.product||'garment').toLowerCase() + (a.to ? ' stuck' : ' back on track');
  if (a.do === 'delta')         return 'Delta ' + a.number + ' — ' + (a.to ? 'set' : 'clear') + ' ' + a.field;
  if (a.do === 'stock_reorder') return a.item + ' — ' + (a.to ? 'flag to reorder' : 'clear the reorder flag');
  if (a.do === 'lead')          return a.name + ' — set ' + a.field + ' to ' + a.to;
  return JSON.stringify(a);
}

function applyAction(a) {
  if (a.do === 'order_stage' || a.do === 'order_stuck') {
    var o = findOrder(String(a.order)); if (!o) return 'no order ' + a.order;
    var hit = (o.items||[]).filter(function(i) {
      return !a.product || String(i.product).toLowerCase() === String(a.product).toLowerCase();
    });
    if (!hit.length) return 'no ' + a.product + ' on ' + a.order;
    hit.forEach(function(i) {
      if (a.do === 'order_stage') i.status = a.to || '';
      else i.stuck = !!a.to;
    });
    syncToServer(o); return '';
  }
  if (a.do === 'order_date') {
    var o2 = findOrder(String(a.order)); if (!o2) return 'no order ' + a.order;
    if (a.field === 'fitting') o2.fittingDate = parseToYMD(a.to); else o2.dueDate = parseToYMD(a.to);
    syncToServer(o2); return '';
  }
  if (a.do === 'delta') {
    var d = deltaOrders.find(function(x){ return String(x.orderNum) === String(a.number); });
    if (!d) return 'no Delta ' + a.number;
    if (['backend','bin','delivered'].indexOf(a.field) !== -1) {
      ['backend','bin','delivered'].forEach(function(k){ d[k] = false; });
      d[a.field] = !!a.to;
    } else d[a.field] = !!a.to;
    persistDelta(); return '';
  }
  if (a.do === 'stock_reorder') {
    var s = stock.find(function(x){ return String(x.item).toLowerCase() === String(a.item).toLowerCase(); });
    if (!s) return 'no stock item "' + a.item + '"';
    s.reorder = !!a.to; persistStock(); return '';
  }
  if (a.do === 'lead') {
    var l = leads.find(function(x){ return String(x.name).toLowerCase() === String(a.name).toLowerCase(); });
    if (!l) return 'no lead "' + a.name + '"';
    if (a.field === 'followUp') l.followUp = parseToYMD(a.to);
    else l[a.field] = a.to ? 'Yes' : 'No';
    persistLeads(); return '';
  }
  return 'not something I can change';
}

function applyPendingActions() {
  if (!pendingActions) return;
  var done = 0, failed = [];
  pendingActions.forEach(function(a) {
    var err = applyAction(a);
    if (err) failed.push(err); else done++;
  });
  pendingActions = null;
  renderAll();
  chatLog.push({role: 'assistant', content:
    (done ? 'Done — ' + done + ' change' + (done===1?'':'s') + ' made and saved.' : 'Nothing was changed.')
    + (failed.length ? '\n\nI could not do: ' + failed.join('; ') + '.' : '')});
  renderChat();
  showToast(done + ' change' + (done===1?'':'s') + ' saved');
}
function discardPendingActions() {
  pendingActions = null;
  chatLog.push({role: 'assistant', content: 'Left as it was.'});
  renderChat();
}

/* ── Talking to the model ── */
var CHAT_SYSTEM =
  'You are the assistant inside ŠAKAL Workshop, the order and invoicing app for ŠAKAL, a bespoke ' +
  'tailoring atelier on Jalan Besar, Singapore. You are speaking to the people who run the shop.\n\n' +
  'You are their reporting tool as much as anything: revenue by month, best customers, orders taking ' +
  'too long, stock to reorder, leads and conversion, what is with the maker. Worked-out reports are ' +
  'given to you below — trust those figures over your own arithmetic, and quote them exactly.\n\n' +
  'Answer only from the data given. If it is not there, say so plainly rather than guessing. Amounts ' +
  'are Singapore dollars. Dates come as YYYY-MM-DD; write them back as "14 Jun 2026". Order numbers ' +
  'look like 260255 and invoice numbers like INV260255 — the same job.\n\n' +
  'A two piece suit is a jacket and trousers; a three piece adds the vest. Production runs Fabric ' +
  'Ordered → Bin → Batam or Delta → In-store → Take Home. Fittings are baste, fitting, final. Delta ' +
  'is an outside maker: what they charge is a cost to the shop, not a sale.\n\n' +
  'Keep answers short and practical, the way a colleague would answer across the bench. Lead with the ' +
  'number or the name that was asked for. Use a list only when the answer really is a list.\n\n' +
  ACTION_HELP;

function extraContext(q) {
  var s = String(q || '').toLowerCase(), bits = [];
  (s.match(/\b\d{4,7}\b/g) || []).forEach(function(n) {
    var o = findOrder(n);
    if (o) bits.push('FULL ORDER ' + n + ':\n' + JSON.stringify(o, null, 1));
    var v = invoices.find(function(x){ return String(x.no||'').replace(/\D/g,'') === n; });
    if (v) bits.push('FULL INVOICE ' + v.no + ':\n' + JSON.stringify(v, null, 1));
  });
  customers.forEach(function(c) {
    if (c.name && c.name.length > 2 && s.indexOf(c.name.toLowerCase()) !== -1) {
      bits.push('CUSTOMER ' + c.name + ':\n' + JSON.stringify(c)
        + '\nPurchases:\n' + JSON.stringify(purchaseHistory(c), null, 1));
    }
  });
  return bits.join('\n\n');
}

/* The old Apps Script has no assistant in it. Sending it a question
   would land in the orders handler and come back as a conflict, so the
   endpoint is asked once whether it can take one at all. */
var aiSheetOk = null;
async function sheetHasAi() {
  if (aiSheetOk !== null) return aiSheetOk;
  try {
    var r = await fetch(API_URL + '?ai=1', {redirect: 'follow'});
    var out = JSON.parse(await r.text());
    aiSheetOk = out.status === 'success' && out.ai === true;
  } catch (e) { aiSheetOk = false; }
  return aiSheetOk;
}

async function askModel(messages) {
  var cfg = aiCfg();
  var sys = CHAT_SYSTEM
    + '\n\n=== REPORTS, ALREADY WORKED OUT ===\n' + reportPack()
    + '\n\n=== THE RECORDS ===\n' + shopSnapshot();
  var last = messages[messages.length - 1];
  var extra = extraContext(last && last.content);
  if (extra) sys += '\n\n=== RECORDS THE QUESTION NAMES ===\n' + extra;

  var body = {model: cfg.model, max_tokens: 1500, system: sys, messages: messages};

  if (cfg.mode === 'sheet') {
    var ok = await sheetHasAi();
    if (!ok) throw new Error('SHEET_NO_AI');
    var r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'ASK_AI', payload: body})
    });
    var text = await r.text(), out = {};
    try { out = JSON.parse(text); } catch(e) { throw new Error('The sheet did not answer in a way I understand.'); }
    if (out.status !== 'success' || out.reply === undefined) {
      aiSheetOk = false;
      throw new Error('SHEET_NO_AI');
    }
    return out.reply || '';
  }

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (data.error) throw new Error(data.error.message || 'The assistant refused that.');
  return (data.content || []).filter(function(b){ return b.type === 'text'; })
                             .map(function(b){ return b.text; }).join('\n');
}

/* ── The page ── */
var CHAT_STARTERS = [
  'How much has Gerard spent?',
  'Who owes me money?',
  'What is running late?',
  'What should I reorder?',
  'What is Delta holding?'
];

function renderChat() {
  var el = $('chat-log'); if (!el) return;

  var quick = '<div class="quick-reports">'
    + Object.keys(REPORTS).map(function(k) {
        return '<button class="chip" onclick="runReport(\'' + k + '\')">' + esc(REPORTS[k].label) + '</button>';
      }).join('')
    + '</div>';

  if (!chatLog.length) {
    el.innerHTML = '<div class="chat-empty">'
      + '<div class="empty-title">Ask the workshop anything</div>'
      + '<div class="empty-body">Ask about anyone by name, any order or invoice by number, or the money, '
      + 'the stock, the leads and Delta. It reads your own records, so it answers at once and needs nothing set up.</div>'
      + quick
      + '<div class="chips" style="justify-content:center;margin-top:16px">'
      + CHAT_STARTERS.map(function(s){ return '<button class="chip" onclick="chatAsk(this.dataset.q)" data-q="'+esc(s)+'">'+esc(s)+'</button>'; }).join('')
      + '</div></div>';
  } else {
    el.innerHTML = quick + chatLog.map(function(m) {
      return '<div class="msg ' + (m.role === 'user' ? 'me' : 'it') + '">'
        + '<div class="bubble">' + chatFormat(m.content) + '</div></div>';
    }).join('')
    + (pendingActions ? actionCard() : '')
    + (chatBusy ? '<div class="msg it"><div class="bubble thinking">Reading the floor…</div></div>' : '');
  }
  el.scrollTop = el.scrollHeight;
  $('chat-send').disabled = chatBusy;
  $('chat-state').textContent =
      aiSheetOk === false && aiCfg().mode === 'sheet'
        ? 'Answers from your records · the sheet has no model yet, see Settings'
    : aiCfg().mode === 'direct' && aiCfg().key
        ? 'Answers from your records · open questions use your key on this device'
    : 'Answers from your records · open questions go through your Google Sheet';
}

function actionCard() {
  return '<div class="action-card"><div class="ac-head">Shall I make these changes?</div><ul>'
    + pendingActions.map(function(a){ return '<li>' + esc(actionText(a)) + '</li>'; }).join('')
    + '</ul><div class="ac-btns">'
    + '<button class="btn" onclick="discardPendingActions()">Leave it</button>'
    + '<button class="btn gold" onclick="applyPendingActions()">Make the changes</button>'
    + '</div></div>';
}

function chatFormat(t) {
  var safe = esc(t).replace(/```action[\s\S]*?```/g, '').trim();
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return safe.split(/\n{2,}/).map(function(p) {
    if (/^\s*[-*•]\s+/m.test(p)) {
      var head = '', lines = p.split('\n');
      if (!/^\s*[-*•]/.test(lines[0])) { head = '<p>' + lines.shift() + '</p>'; }
      return head + '<ul>' + lines.filter(function(l){ return l.trim(); })
        .map(function(l){ return '<li>' + l.replace(/^\s*[-*•]\s+/, '') + '</li>'; }).join('') + '</ul>';
    }
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

/* A report needs no key and no connection — it is just arithmetic. */
function runReport(k) {
  var r = REPORTS[k]; if (!r) return;
  chatLog.push({role: 'user', content: r.label});
  chatLog.push({role: 'assistant', content: r.run()});
  renderChat();
}

function chatAsk(q) { $('chat-input').value = q; sendChat(); }

async function sendChat() {
  var box = $('chat-input');
  var text = box.value.trim();
  if (!text || chatBusy) return;

  chatLog.push({role: 'user', content: text});
  box.value = ''; box.style.height = 'auto';
  pendingActions = null;

  // Anything that is a lookup is answered from the records, exactly and at once.
  var local = localAnswer(text);
  if (local) {
    chatLog.push({role: 'assistant', content: local});
    renderChat();
    return;
  }

  chatBusy = true; renderChat();
  try {
    var reply = await askModel(chatLog.slice(-12).map(function(m) {
      return {role: m.role, content: m.content};
    }));
    chatLog.push({role: 'assistant', content: reply || '(no answer came back)'});
    var m = reply.match(/```action\s*([\s\S]*?)```/);
    if (m) {
      try {
        var list = JSON.parse(m[1].trim());
        if (Array.isArray(list) && list.length) pendingActions = list;
      } catch(e) {}
    }
  } catch (err) {
    var near = localFallback(text);
    chatLog.push({role: 'assistant', content:
      near ? near + '\n\n---\n\n' + chatTrouble(err) : chatTrouble(err)});
  }
  chatBusy = false; renderChat();
}

/* Says what actually went wrong, and what to do about it. */
function chatTrouble(err) {
  var msg = String((err && err.message) || err);
  if (msg === 'SHEET_NO_AI') {
    return 'I can answer anything about a person, an order, an invoice, money, stock, leads or Delta '
      + 'straight from your records — try naming one, or use the buttons above.\n\n'
      + 'For questions in your own words I need a model, and your Google Sheet has not been given one '
      + 'yet. Open **Settings** on this page: either add the assistant section to your Apps Script, or '
      + 'switch to keeping a key on this device.';
  }
  if (/api key|x-api-key|authentication|401/i.test(msg)) {
    return 'That key was refused. Check it in **Settings** — it should begin sk-ant-.';
  }
  if (/model/i.test(msg) && /not.*found|invalid/i.test(msg)) {
    return 'That model name was not recognised. Change it in **Settings**.';
  }
  if (/credit|quota|billing|rate/i.test(msg)) {
    return 'The model would not answer: ' + msg + '. The reports above still work.';
  }
  return 'That did not go through — ' + msg + '. The reports above still work, and I can answer about '
    + 'any person, order or invoice by name or number.';
}

function clearChat() { chatLog = []; pendingActions = null; renderChat(); }
function growChatBox(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }

/* ── Settings ── */
function openAiSettings() {
  var c = aiCfg();
  $('ai-mode').value = c.mode; $('ai-key').value = c.key; $('ai-model').value = c.model;
  onAiModeChange();
  $('ai-modal').classList.add('open');
}
function closeAiSettings() { $('ai-modal').classList.remove('open'); }
function onAiModeChange() {
  $('ai-key-block').style.display = $('ai-mode').value === 'direct' ? '' : 'none';
  $('ai-sheet-note').style.display = $('ai-mode').value === 'sheet' ? '' : 'none';
}
function saveAiSettings() {
  saveAiCfg({mode: $('ai-mode').value, key: $('ai-key').value.trim(),
             model: $('ai-model').value.trim() || 'claude-sonnet-4-6'});
  aiSheetOk = null;
  closeAiSettings(); renderChat();
  showToast('Assistant settings saved');
}