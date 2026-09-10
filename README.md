# ŠAKAL Workshop — how the code is laid out

The app used to be one `index.html` of 6,430 lines. It is now the same app,
split into files you can open one at a time. **Nothing about how it runs has
changed**: still no build step, still plain `<script src>` tags, still
GitHub → Netlify.

---

## Where things live

```
index.html            the markup only — 1,077 lines instead of 6,430
_headers              Netlify cache rules
css/
  01-base.css         variables, layout, the rail, the topbar
  02-orders.css       order cards and the timeline
  03-modules.css      price list, leads, pickers, modals
js/
  lib/
    00-crud-screen.js CrudScreen — the shared list+modal machinery
  00-seed-data.js     the starting price list, stock, leads, invoices, ops, delta
  02-core.js          helpers, storage, sync with Apps Script, page routing
  03-orders.js        orders and the archive
  04-delta.js         Delta making charges
  05-pricelist.js     the fabric library         <- CrudScreen
  06-stock.js         stock                      <- CrudScreen
  07-leads.js         leads                      <- CrudScreen
  08-customers.js     the customer book          <- CrudScreen
  09-ops.js           SIM and stored-value cards <- CrudScreen
  10-attachments.js   the order-form PDF: picking it, sending it, the link back
  11-setup.js         connecting the sheet
  12-assistant.js     the AI assistant and the reports behind it
  13-invoicing.js     invoices
  99-boot.js          what runs on DOMContentLoaded
apps-script/
  SAKAL-BACKEND-V9.gs the Google Apps Script behind the sheet — the whole
                      backend, kept here so it is versioned with the app.
                      Paste it over the script project and redeploy.
tools/
  smoke.js            boots the app headless and checks the wiring
  pdf-check.js        the Attach PDF button, on the floor and in the archive
  viewer-check.js     the in-app PDF viewer — open, replace, remove, Esc
  backend-check.js    the Apps Script PDF path, run against a fake Drive
  folderid-check.js   PDF_FOLDER_ID — filing order forms on a Shared Drive
  gas-harness.js      the fake Drive/Sheet backend-check.js runs on
  compare.js          proves each rewritten screen behaves like the old one
  bundle.py           squashes everything back into one file
  reference/          the pre-refactor screens, kept for comparison
```

Load order in `index.html` is the same order the code was in before, so
anything that worked before still works.

---

## Running it

```bash
npm install          # once, for the test tools
npm run serve        # http://localhost:8080
npm test             # headless boot + wiring check
npm run compare      # old vs new, every converted screen
npm run compare ops  # ...or just one
```

`npm test` reports:

- every `onclick=""` in the markup calls a function that actually exists
- every `$('some-id')` in the code matches an element that actually exists
- no uncaught errors during boot

Run it before you push. It catches the two mistakes that hurt most in a
no-build-step project: a typo'd function name and a renamed element id.

---

## Going back to one file

```bash
npm run bundle       # writes dist/index.html
```

Useful if you ever need to email somebody a single self-contained file, or
open the app straight off a USB stick with no web server.

---

## One bug fixed on the way

All five screens shared the same slip. Editing a record toasted **"… added"**
instead of **"… updated"**, because the close function cleared the "am I
editing?" flag on the line before the message read it:

```js
persistStock(); closeStockModal(); renderStock();          // clears stockEditId
showToast(stockEditId ? 'Stock item updated' : 'Stock item added');   // always false
```

The base class captures the flag before closing, so it now reads correctly on
Stock, Leads, Customers, Operation and the Price list. That is the only
behaviour that changed anywhere; `npm run compare` proves the rest is
identical, step by step.

---

## Converting another screen

Five are done. If you ever add a sixth list screen, this is the pattern —
`js/06-stock.js` is the smallest worked example, `js/05-pricelist.js` the
most stretched.

**1. Subclass `CrudScreen`** and hand it the names it needs.

```js
class LeadsScreen extends CrudScreen {
  constructor() {
    super({
      name:       'Lead',           // used in toasts and the modal title
      collection: 'leads',          // the global array
      persist:    'persistLeads',   // the save function in 02-core.js
      contentId:  'leads-content',
      searchId:   'leads-search',
      modalId:    'lead-modal',
      filters:    { stage: 'all' },
      fields:     { 'ld-name': 'name', 'ld-phone': 'phone' }
    });
  }
}
```

**2. Say what is different.** Override only these:

| method | what it does |
|---|---|
| `keep(row, term)` | is this row allowed through the filters and search |
| `compare(a, b)` | sort order |
| `html(rows)` | build the table |
| `fill(row)` | put a row in the form (`row` is `null` when adding) |
| `collect()` | read the form back out |
| `validate()` | return `this.reject('field-id')` to block the save |

Everything else — opening and closing the modal, add vs update, delete,
toasts, the filter buttons going `.on` — comes from the base class.

**3. Keep the old handler names working.**

```js
var leadsScreen = new LeadsScreen();
leadsScreen.expose({
  renderLeads:     'render',
  openLeadModal:   'open',
  closeLeadModal:  'close',
  saveLeadForm:    'save',
  deleteLeadRow:   'remove'
});
```

`expose` publishes each method under the global name the markup already
calls, so none of the 271 `onclick=""` handlers need touching. That is what
lets you convert one screen without breaking the eleven you have not got to
yet.

**4. Prove it.** Save the old file to `tools/reference/<name>.js.orig`, add a
block to the `SCREENS` map in `tools/compare.js` naming the elements to watch
and the actions to drive, then run `npm run compare <name>`. It boots the app
twice — old file and new — and diffs the page and the data after every step.
If they match, the rewrite is safe to push.

---

## What was deliberately left alone

Orders, Delta, the assistant and invoicing are **not** list-and-modal screens.
Orders is a card timeline with per-garment state; Delta is a two-view charge
ledger; invoicing carries line items, totals and a PDF; the assistant is
reports and a chat. Forcing them into `CrudScreen` would mean overriding
almost every method — more code than they have now, and a real chance of
breaking something for no gain in readability.

Split into their own files they are already far easier to work on than they
were. Leave them unless a specific problem turns up.

Measurements, stock and invoices still save to the device only. The sync stub
in `js/02-core.js` marks exactly what the Apps Script needs to accept them.
