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
  04-responsive.css   loaded last: phone / tablet / landscape / desktop / print
js/
  lib/
    00-crud-screen.js CrudScreen — the shared list+modal machinery
    vendor/           jsPDF, the logo art and the two fonts, loaded only
                      when an invoice PDF is made (MIT / SIL OFL licences)
  00-seed-data.js     the tier card, and empty seed lists — see "Nothing real
                      in the code" below
  01-roles.js         who sees what — a 'delta' account sees only the Delta page, view only
  02-core.js          helpers, storage, sync with Apps Script, page routing
  03-orders.js        orders and the archive
  04-delta.js         Delta making charges
  05-pricelist.js     the fabric library         <- CrudScreen
  06-stock.js         stock                      <- CrudScreen
  07-leads.js         leads                      <- CrudScreen
  08-customers.js     the customer book          <- CrudScreen
  09-ops.js           SIM cards, stored-value cards and motorcycle tax <- CrudScreen (x2)
  09-ops-sync.js      Operation <-> the sheet, record by record (JSON-LD)
  10-attachments.js   the PDFs: order forms and Delta orders (key DELTA-<no.>)
  11-setup.js         connecting the sheet
  12-assistant.js     the AI assistant and the reports behind it
  13-invoicing.js     invoices
  14-invoice-pdf.js   the tax invoice PDF, and emailing it to the client
  99-boot.js          what runs on DOMContentLoaded
```

Load order in `index.html` is the same order the code was in before, so
anything that worked before still works.

---

## Running it locally

```bash
npm run serve        # http://localhost:8080
```

No install needed. The test tools that used to live in `tools/` were removed
(they were only for checking the refactor and new features before pushing).

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
behaviour that changed anywhere.

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

**4. Check it.** Open the screen, try the filters, search, add, edit and
delete, and make sure the toasts and the list match what the old screen did
before you push.

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

## Operation is shared live (V10)

The Operation page — SIM cards, stored-value cards and **motorcycle tax**
(`Punya Lia · Pajak 07 · Plat 2030`) — is one JSON-LD document on the sheet
(hidden `Modules` tab, name `operation`; readable copy in the `Operation` tab).

Unlike the other lists it is not saved whole. Each record has a version; a
phone sends only what it changed, the sheet accepts it only if nobody changed
that record first, and deletes travel as tombstones. So several people can use
the page at once and nobody undoes anybody. It arrives inside the boot-time
`?modules=1` answer (no extra request), then refreshes every 30 s only while
the Operation page is open, and on focus. Offline edits wait and go later.
On a V9 sheet it never polls: there `?operation=1` returns the whole order list.

**To switch it on:** paste the V10 backend script over the Apps Script project,
then Deploy → Manage deployments → edit → New version (keep the same URL).
Until then the page says "On this device only" and never posts to the sheet.

Measurements, stock and invoices still save to the device only. The sync stub
in `js/02-core.js` marks exactly what the Apps Script needs to accept them.

---

## Where the PDFs go

| PDFs | Drive folder | Set by |
|---|---|---|
| Order forms (Orders tab) | `PDF_FOLDER_ID`, or **ŠAKAL order forms** in the script account's My Drive when blank | backend script |
| Delta orders (Delta tab) | **Sakal-Delta** (`1eqWxx4SONfewI0MaRHeooC7tdUeMXccF`) | `SAKAL-DELTA-PDF.gs` add-on |
| Emailed invoices (a copy of each) | **ŠAKAL invoices** | `SAKAL-INVOICE-MAILER.gs` add-on |

Delta files are named `DELTA-<delta no.> — <file>.pdf`, order forms
`<order no.> — <file>.pdf`. The app sends both the same way; the Delta add-on
picks out anything numbered `DELTA-` before the normal upload runs. Without
the add-on, Delta PDFs fall back to the order-forms folder.

Setting up the Delta folder (once): add `SAKAL-DELTA-PDF.gs` to the Apps
Script project, put `if (isDeltaPdfUpload_(body)) return uploadDeltaPdf_(body);`
in `doPost` just above the `UPLOAD_PDF` line, run `testDeltaPdfFolder`, then
`moveDeltaPdfsToSakalDelta` to bring over the Delta PDFs already filed, and
deploy a new version. The account the script runs as needs Editor (or
Content manager) on Sakal-Delta. Moving keeps each file's id, so links the
app already holds keep working.

---

## Emailing invoices

Each invoice has **PDF** (preview / download) and **Email** buttons, on the
list and inside the invoice form. The PDF is a full GST tax invoice drawn in
the app: the ŠAKAL logo and name, SAKAL Pte Ltd, UEN, GST reg. no., line
items, the GST included in the total, amount received and balance due. It
carries no payment instructions — those are given to the client in person.
What is printed on it — company details, the email wording — is set in
`INVOICE_BUSINESS` in `js/00-config.js`; the logo is
`js/lib/vendor/sakal-logo.js`.

Sending needs the add-on **SAKAL-INVOICE-MAILER.gs** in the Apps Script
project (steps at the top of that file: paste it in as a new script file,
add one line to doPost and one to doGet, run `testInvoiceMail`, redeploy).
It sends from suits@sakal.com.sg, keeps a copy of every sent PDF in the Drive
folder **ŠAKAL invoices** (private), and lists each email on an
**Invoice emails** tab. Until it is added the app says so and sends nothing.

---

## Nothing real in the code

Every file in this folder is served to anyone who opens the site, signed in or
not, and the repository it lives in is visible to anyone who can see it on
GitHub. So no customer name, phone number, invoice, charge or SIM card number
may be written into a file here. All of that lives on the Google Sheet and
reaches the app only after someone signs in.

`js/00-seed-data.js` used to hold the shop's real leads, invoices and Delta
orders as first-run fallbacks. They were taken out; the lists are empty and
must stay empty. `PRICE_TIERS` in that file is the exception — the app reads
it directly and it is not kept on the sheet.

Because the app no longer carries a copy of anything, **"Save all to sheet"
refuses to run until this device has read the sheet at least once** — otherwise
a phone that could not reach the sheet would write its emptiness over the
shop's records.

---

## Delta accounts (view only)

An account whose Role is **delta** (Users tab) signs in to the Delta page and
nothing else: no orders, invoices, customers, leads, stock, price list,
operation or assistant. It can open Delta PDFs but cannot change anything,
and Delta charges are never sent to it.

The screen is stripped to the list alone — no rail, no title bar, no count
cards, no search or filters — with **Sign out** pinned to the top right
corner (the `.ro-out` button in `index.html`; the rules live under
"Restricted accounts" in `css/04-responsive.css`). A delta account has no
way to change its own password from the app; an admin resets it in the
Users tab of the sheet.

The lock is in the Apps Script add-on **SAKAL-ROLES.gs** (steps at the top of
that file: one hook line in doPost, one in doGet, run `testRoleGate`,
redeploy). The app side (`js/01-roles.js`) only tidies the screen and wipes
anything an admin left cached on a shared device.
