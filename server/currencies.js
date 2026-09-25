// The currencies the server takes for its own currency (Manage > Settings, a trip's currency): the codes
// store.updateSettings accepts, so a picker never offers one the server refuses (GitHub #4). That is every code
// this Node knows (store.js's CURRENCIES, from Intl) plus the one already set, which updateSettings keeps even
// when it is not on that list (set by hand, or before the list was checked). Codes only, sorted; a page names
// them itself in the viewer's language (Intl.DisplayNames).
'use strict';

const { CURRENCIES } = require('./store');

function currencyCodes(current) {
  const codes = new Set(CURRENCIES);
  const have = String(current || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(have)) codes.add(have);
  return [...codes].sort();
}

module.exports = { currencyCodes };
