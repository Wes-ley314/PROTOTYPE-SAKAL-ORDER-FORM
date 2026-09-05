/* ══════════════════════════════════════════════════
   SETUP
   Connecting the sheet, and putting the app on the
   home screen. Both live inside the app so there is
   no file to open on a phone.
   ══════════════════════════════════════════════════ */

var APPS_SCRIPT_CODE = "/**\n * \u0160AKAL Workshop \u2014 storage for everything that is not an order.\n *\n * Orders already save to your sheet. This adds the same for invoices,\n * customers, the price list, stock, leads, operation cards and\n * measurements, so nothing lives on one phone only.\n *\n * HOW TO ADD IT\n *  1. Open the Apps Script project behind your \u0160AKAL sheet.\n *  2. Paste everything below at the bottom of the existing file.\n *  3. Find your existing doPost(e) and add the three marked lines at\n *     the very top of it (see HOOK 1).\n *  4. Find your existing doGet(e) and add the two marked lines at the\n *     very top of it (see HOOK 2).\n *  5. Deploy \u2192 Manage deployments \u2192 edit the live deployment \u2192\n *     Version: New version \u2192 Deploy. The URL stays the same.\n *  6. In the app, press \"Save all to sheet\" in the bottom left once.\n *\n * HOOK 1 \u2014 first lines inside your existing doPost(e):\n *\n *     var body = JSON.parse(e.postData.contents);\n *     if (body.action === 'SAVE_MODULE') return saveModule_(body);\n *     // ...your existing order handling carries on below, using body\n *\n * HOOK 2 \u2014 first lines inside your existing doGet(e):\n *\n *     if (e && e.parameter && e.parameter.modules) return getModules_();\n *     // ...your existing order handling carries on below\n */\n\nvar MODULE_SHEET = 'Modules';\nvar CHUNK = 40000;            // a cell holds 50,000 characters; leave room\nvar MODULE_NAMES = ['measurements','invoices','pricelist','stock','leads','customers','ops'];\n\nfunction moduleSheet_() {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sh = ss.getSheetByName(MODULE_SHEET);\n  if (!sh) {\n    sh = ss.insertSheet(MODULE_SHEET);\n    sh.appendRow(['module', 'part', 'data', 'updated']);\n    sh.hideSheet();\n  }\n  return sh;\n}\n\nfunction jsonOut_(obj) {\n  return ContentService\n    .createTextOutput(JSON.stringify(obj))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\n/** Stores one list. Rewrites only that list's rows. */\nfunction saveModule_(body) {\n  var lock = LockService.getScriptLock();\n  try {\n    lock.waitLock(20000);\n\n    var name = String(body.module || '').trim();\n    if (MODULE_NAMES.indexOf(name) === -1) {\n      return jsonOut_({status: 'error', message: 'Unknown module: ' + name});\n    }\n\n    var sh = moduleSheet_();\n    var text = JSON.stringify(body.payload === undefined ? null : body.payload);\n    var stamp = new Date().toISOString();\n\n    // Drop this module's existing rows, bottom up so the indexes hold.\n    var last = sh.getLastRow();\n    if (last > 1) {\n      var col = sh.getRange(2, 1, last - 1, 1).getValues();\n      for (var r = col.length - 1; r >= 0; r--) {\n        if (String(col[r][0]) === name) sh.deleteRow(r + 2);\n      }\n    }\n\n    // Write it back in chunks a cell can hold.\n    var rows = [];\n    for (var i = 0, part = 0; i < text.length; i += CHUNK, part++) {\n      rows.push([name, part, text.substring(i, i + CHUNK), stamp]);\n    }\n    if (!rows.length) rows.push([name, 0, '', stamp]);\n    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);\n\n    return jsonOut_({status: 'success', module: name, parts: rows.length, updated: stamp});\n  } catch (err) {\n    return jsonOut_({status: 'error', message: String(err)});\n  } finally {\n    try { lock.releaseLock(); } catch (e) {}\n  }\n}\n\n/** Hands every stored list back in one response. */\nfunction getModules_() {\n  try {\n    var sh = moduleSheet_();\n    var out = {};\n    var last = sh.getLastRow();\n\n    if (last > 1) {\n      var vals = sh.getRange(2, 1, last - 1, 3).getValues();\n      var buckets = {};\n      vals.forEach(function (row) {\n        var name = String(row[0]);\n        if (!name) return;\n        if (!buckets[name]) buckets[name] = [];\n        buckets[name].push({part: Number(row[1]) || 0, data: String(row[2] == null ? '' : row[2])});\n      });\n      Object.keys(buckets).forEach(function (name) {\n        buckets[name].sort(function (a, b) { return a.part - b.part; });\n        var text = buckets[name].map(function (c) { return c.data; }).join('');\n        if (!text) return;\n        try { out[name] = JSON.parse(text); } catch (e) { /* leave it out rather than send rubbish */ }\n      });\n    }\n\n    return jsonOut_({status: 'success', modules: out});\n  } catch (err) {\n    return jsonOut_({status: 'error', message: String(err)});\n  }\n}\n\n/** Run once from the editor to check the sheet and permissions are fine. */\nfunction testModules_() {\n  saveModule_({module: 'leads', payload: [{id: 'test', name: 'Test lead'}]});\n  Logger.log(getModules_().getContent());\n}\n\n\n/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n   THE ASSISTANT\n   Lets the app ask Anthropic a question without the key ever\n   leaving Google. Add it the same way as above:\n\n   HOOK 3 \u2014 in your doPost(e), next to the SAVE_MODULE line:\n\n       if (body.action === 'ASK_AI') return askAi_(body);\n\n   HOOK 4 \u2014 in your doGet(e), next to the modules line:\n\n       if (e && e.parameter && e.parameter.ai) return aiReady_();\n\n   Then put the key in: Project Settings \u2192 Script Properties \u2192\n   Add script property \u2192 name ANTHROPIC_KEY, value sk-ant-\u2026\n   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */\n\nfunction askAi_(body) {\n  try {\n    var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');\n    if (!key) {\n      return jsonOut_({status: 'error',\n        message: 'No ANTHROPIC_KEY in Script Properties yet.'});\n    }\n    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {\n      method: 'post',\n      contentType: 'application/json',\n      muteHttpExceptions: true,\n      headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'},\n      payload: JSON.stringify(body.payload || {})\n    });\n    var data = JSON.parse(res.getContentText());\n    if (data.error) return jsonOut_({status: 'error', message: data.error.message});\n    var reply = (data.content || [])\n      .filter(function (b) { return b.type === 'text'; })\n      .map(function (b) { return b.text; })\n      .join('\\n');\n    return jsonOut_({status: 'success', reply: reply});\n  } catch (err) {\n    return jsonOut_({status: 'error', message: String(err)});\n  }\n}\n\n/** Lets the app check whether an assistant is set up before it asks anything.\n *  Without this the app would post a question into the orders handler and get\n *  a confusing answer back. */\nfunction aiReady_() {\n  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');\n  return jsonOut_({status: 'success', ai: !!key});\n}\n";

function openSetup() {
  $('setup-code').textContent = APPS_SCRIPT_CODE;
  $('setup-state').textContent = modulesOnServer === true
    ? 'The sheet is answering — your lists are saving there.'
    : (modulesOnServer === false
        ? 'The sheet is not taking the lists yet, so they are on this device only. The five steps below fix that.'
        : 'Checking the sheet…');
  $('setup-modal').classList.add('open');
  if (modulesOnServer === null) checkSheetLink(true);
}
function closeSetup() { $('setup-modal').classList.remove('open'); }

function copySetupCode() {
  var text = APPS_SCRIPT_CODE;
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    showToast(ok ? 'Code copied — paste it into Apps Script'
                 : 'Select the code and copy it by hand');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function(){ showToast('Code copied — paste it into Apps Script'); })
      .catch(fallback);
  } else { fallback(); }
}

async function checkSheetLink(quiet) {
  $('setup-state').textContent = 'Checking the sheet…';
  var ok = await fetchModulesFromServer();
  $('setup-state').textContent = ok
    ? 'The sheet is answering — your lists are saving there.'
    : 'The sheet is not taking the lists yet, so they are on this device only. The five steps below fix that.';
  if (!quiet) showToast(ok ? 'Connected' : 'Not connected yet');
  setSync(ok ? '' : 'warn', ok ? 'All changes saved' : 'Orders on the sheet · lists on this device');
}

/* ── Home screen ── */
function platformGuess() {
  var ua = navigator.userAgent || '';
  var touchMac = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  if (/iPad/.test(ua) || touchMac) return 'ipad';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/Macintosh/.test(ua)) return 'mac';
  return 'other';
}
function openInstall() {
  var p = platformGuess();
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
  var local = location.protocol === 'file:';

  var steps = {
    iphone: [
      'Open this page in <b>Safari</b>.',
      'Tap the <b>Share</b> button at the bottom — the square with an arrow.',
      'Scroll down and tap <b>Add to Home Screen</b>.',
      'Name it ŠAKAL and tap <b>Add</b>. It opens full screen, with no address bar.'
    ],
    ipad: [
      'Open this page in <b>Safari</b>.',
      'Tap the <b>Share</b> button in the top toolbar.',
      'Tap <b>Add to Home Screen</b>.',
      'Name it ŠAKAL and tap <b>Add</b>. It runs in its own window, and works in Split View.'
    ],
    mac: [
      'Open this page in <b>Safari</b>.',
      'Choose <b>File → Add to Dock</b> (Safari 17 or newer). In Chrome it is the install icon in the address bar.',
      'Name it ŠAKAL and click <b>Add</b>.',
      'It now opens from the Dock like any other Mac app.'
    ],
    other: [
      'Open this page in Chrome or Edge.',
      'Use the install icon in the address bar, or the menu → <b>Install</b>.',
      'It then opens in its own window.'
    ]
  }[p];

  $('install-msg').innerHTML = standalone
    ? 'You are already running it as an app. Nothing more to do.'
    : (local
        ? 'This copy is open straight from a file, so the home screen cannot hold it. Put the file on a web address first — any static host will do — then follow these steps on that address.'
        : 'A few taps and ŠAKAL sits on the home screen like any other app, full screen and offline-ready.');
  $('install-steps').innerHTML = standalone ? ''
    : steps.map(function(s, i) {
        return '<div class="step"><span class="step-n">'+(i+1)+'</span><span class="step-t">'+s+'</span></div>';
      }).join('')
      + '<div class="inline-note" style="margin-top:12px">Everything is saved to your Google Sheet, so the same orders show up on the shop iPad, your iPhone and the Mac.</div>';

  $('install-modal').classList.add('open');
}
function closeInstall() { $('install-modal').classList.remove('open'); }