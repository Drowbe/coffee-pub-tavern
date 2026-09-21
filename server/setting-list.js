// A `list` setting: rows that each have a label, an icon and a colour (a plan's marker types, say). Some rows may be fixed by the
// module (they must always be there and cannot be removed; their label, icon and colour can change). A new row arrives with no
// id and gets one made from its label. Shared by the manifest check (the default) and the value check (what an admin saves).
'use strict';

const ID_RE = /^[a-z][a-z0-9-]{0,29}$/;
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_ROWS = 20;

const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => oneLine(s, 30).toLowerCase().normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');

// Rows, cleaned: { id, label, icon, color }. Throws an Error with a message for what is wrong. `def` has `fixed` (ids) and
// `maxLength` (label length, up to 30).
function cleanRows(rows, def) {
  if (!Array.isArray(rows)) throw new Error('must be a list');
  if (rows.length > MAX_ROWS) throw new Error(`can have at most ${MAX_ROWS} rows`);
  const labelMax = Math.min(30, def.maxLength || 30);
  const out = [];
  const used = new Set((rows || []).map((r) => (r && typeof r.id === 'string' ? r.id : '')).filter(Boolean));
  for (const r of rows) {
    if (!r || typeof r !== 'object') throw new Error('has a row that is not a row');
    const label = oneLine(r.label, labelMax);
    if (!label) throw new Error('every row needs a label');
    if (typeof r.icon !== 'string' || !ICON_RE.test(r.icon)) throw new Error(`"${label}" needs an icon`);
    if (typeof r.color !== 'string' || !COLOR_RE.test(r.color)) throw new Error(`"${label}" needs a colour like #3b82f6`);
    let id = typeof r.id === 'string' ? r.id : '';
    if (id && !ID_RE.test(id)) throw new Error(`"${label}" has a bad id`);
    if (!id) {
      const base = slug(label) || 'item';
      id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, 26)}-${n}`;
      used.add(id);
    }
    if (out.some((x) => x.id === id)) throw new Error(`"${label}" repeats an id`);
    out.push({ id, label, icon: r.icon, color: r.color.toLowerCase() });
  }
  for (const f of def.fixed || []) if (!out.some((x) => x.id === f)) throw new Error(`the row "${f}" cannot be removed`);
  return out;
}

module.exports = { cleanRows, MAX_ROWS };
