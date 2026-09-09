/* ══════════════════════════════════════════════════
   SIGNING IN — the app's half
   login.html does the signing in. This file does the
   rest: it puts the token on every request the app
   makes, shows who is signed in, and sends anyone
   without a good token back to the door.
   ══════════════════════════════════════════════════ */

var SakalAuth = (function () {
  var KEY = 'sakal-auth';
  var session = null;

  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (session && session.expires && Date.now() > session.expires) session = null;

  function toDoor(why) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.replace('login.html' + (why ? '?why=' + why : ''));
  }

  return {
    get:     function () { return session; },
    token:   function () { return session ? session.token : ''; },
    name:    function () { return session ? session.name : ''; },
    role:    function () { return session ? session.role : ''; },
    isOwner: function () { return !!session && session.role === 'owner'; },
    signOut: function () { toDoor('out'); },
    /* the sheet stopped accepting the token — nothing to do but ask again */
    expire:  function () { if (session) { session = null; toDoor('expired'); } }
  };
})();


/* ── every call to the sheet carries the token ──
   One patch here means no other file has to know this exists. */
(function () {
  var nativeFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var api = '';
    try { api = API_URL; } catch (e) {}
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!api || url.indexOf(api) !== 0) return nativeFetch(input, init);

    var token = SakalAuth.token();
    init = init || {};

    if (init.method && String(init.method).toUpperCase() === 'POST') {
      try {
        var body = JSON.parse(init.body);
        if (token) {
          body.token = token;
          init = Object.assign({}, init, {body: JSON.stringify(body)});
        }
      } catch (e) { /* not ours to rewrite */ }
    } else if (token) {
      input = url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + encodeURIComponent(token);
    }

    return nativeFetch(input, init).then(function (r) {
      /* peek at a copy so the caller still gets an unread body */
      r.clone().text().then(function (t) {
        if (t && t.indexOf('"unauthorized"') !== -1) SakalAuth.expire();
      }).catch(function () {});
      return r;
    });
  };
})();


/* ── who is signed in, in the bottom left ── */
function renderAuthChip() {
  var foot = document.querySelector('.rail-foot');
  if (!foot) return;
  var s = SakalAuth.get();
  if (!s) return;

  var chip = document.getElementById('auth-chip');
  if (!chip) {
    chip = document.createElement('div');
    chip.className = 'auth-chip';
    chip.id = 'auth-chip';
    foot.insertBefore(chip, foot.firstChild);
  }
  var who = String(s.name || s.username || '');
  chip.innerHTML =
      '<span class="auth-who">' + (typeof esc === 'function' ? esc(who) : who)
    + (s.role === 'owner' ? '' : ' \u00b7 floor') + '</span>'
    + '<button class="auth-link" onclick="openPasswordChange()">Password</button>'
    + '<button class="auth-link" onclick="SakalAuth.signOut()">Sign out</button>';
}

/* ── changing your own password ── */
function openPasswordChange() {
  var current = prompt('Current password:');
  if (current === null) return;
  var next = prompt('New password (at least 8 characters):');
  if (next === null) return;
  if (next.length < 8) { showToast('At least 8 characters, please.'); return; }
  if (next !== prompt('New password again:')) { showToast('The two did not match.'); return; }

  fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: {'Content-Type': 'text/plain;charset=utf-8'},
    body: JSON.stringify({action: 'CHANGE_PASSWORD', current: current, next: next})
  })
  .then(function (r) { return r.text(); })
  .then(function (t) {
    var res = JSON.parse(t);
    showToast(res.status === 'success' ? 'Password changed' : (res.message || 'Could not change it'));
  })
  .catch(function () { showToast('Could not reach the sheet.'); });
}

document.addEventListener('DOMContentLoaded', renderAuthChip);