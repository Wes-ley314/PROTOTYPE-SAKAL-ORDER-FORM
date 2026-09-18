/* ══════════════════════════════════════════════════
   SEED DATA — deliberately empty.

   Everything in this folder is served to anyone who
   opens the site, signed in or not. Real names, phone
   numbers, prices and charges must never live here.

   The price list, stock, leads, invoices, customers,
   operation cards and Delta orders all come from the
   Google Sheet once someone signs in. These lists are
   only a fallback for a device that has never synced,
   so empty is the right answer.

   Do not paste shop data back in. If a fresh device
   ever shows nothing, press "Refresh from sheet".
   ══════════════════════════════════════════════════ */

/* The tier card. Not seed data and not customer data: the app reads these
   prices straight out of here, and they are not kept on the sheet. */
var PRICE_TIERS = [{"tier": "YELLOW", "name": "PREMIUM", "p2": 899.0, "p3": 1199.0, "pJ": 700.0, "pV": 220.0, "pT": 199.0}, {"tier": "PINK", "name": "LUXURY", "p2": 1099.0, "p3": 1369.0, "pJ": 850.0, "pV": 270.0, "pT": 249.0}, {"tier": "ORANGE", "name": "OPULENCE", "p2": 1399.0, "p3": 1799.0, "pJ": 1050.0, "pV": 400.0, "pT": 349.0}, {"tier": "GREEN", "name": "GRANDIOSE", "p2": 1799.0, "p3": 2299.0, "pJ": 1300.0, "pV": 500.0, "pT": 499.0}, {"tier": "RED", "name": "SYBERITIC", "p2": 2499.0, "p3": 3199.0, "pJ": 1800.0, "pV": 700.0, "pT": 699.0}];

var SEED_PRICELIST    = [];
var SEED_STOCK        = [];
var SEED_LEADS        = [];
var SEED_INVOICES     = [];
var SEED_VEHICLES     = [];
var SEED_OPS          = [];
var SEED_CONSTRUCTION = [];
var SEED_DELTA        = [];
