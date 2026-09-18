/* ══════════════════════════════════════════════════
   WHERE THE SHEET LIVES
   Kept on its own so login.html and the app both read
   the same address. Change it here and nowhere else.
   Loads before 02-core.js, which used to declare it.
   ══════════════════════════════════════════════════ */

const API_URL = 'https://script.google.com/macros/s/AKfycbzlmSGjfVeiMwA9aWAvLIFf2Lo5P08dK9hQxXEN45c6XlYhpbc4THrE-Qp6YJKGuVuLCg/exec';

/* ══════════════════════════════════════════════════
   WHO THE INVOICES ARE FROM
   Everything printed on the invoice PDF and in the
   invoice email. Change it here and nowhere else.
   ══════════════════════════════════════════════════ */
const INVOICE_BUSINESS = {
  brand:      'ŠAKAL',
  legalName:  'SAKAL Pte Ltd',
  uen:        '201928720K',
  /* A company's GST registration number is normally its UEN. If IRAS gave
     you a different number (e.g. M2-1234567-8), put that here instead. */
  gstRegNo:   '201928720K',
  gstRate:    9,          // per cent
  pricesIncludeGst: true, // the price list and invoice lines already include GST
  address:    ['157A Jalan Besar', 'Singapore 208874'],
  email:      'suits@sakal.com.sg',
  phone:      '',         // e.g. '+65 6123 4567' — shown on the invoice if filled
  website:    'sakal.com.sg',

  /* The email. {client}, {no}, {total} and {balance} are filled in for you. */
  emailSubject: 'Tax Invoice {no} from ŠAKAL',
  emailMessage: 'Dear {client},\n\nThank you for choosing ŠAKAL. Please find your tax invoice {no} attached.\n\nTotal: S$ {total}\nBalance due: S$ {balance}\n\nIf you have any questions, simply reply to this email.\n\nWarm regards,\nŠAKAL'
};
