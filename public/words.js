// The words a person reads for each level and role, in this environment (plan-environment-templates.md, "The
// vocabulary"). The same API as the server's server/words.js, so both read alike:
//
//   word('space')                          "space"
//   word('space', { many: true, cap: true }) "Spaces"
//   word('aside', { a: true })             "an aside"  (the singular with its article; cap: true gives "An aside")
//   fill('Make {a space}')                 fixed text with {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space}
//                                          placeholders, each replaced by this environment's word in the same form
//
// In a page's markup:
//
//   <span data-word="space"></span>                          the word, filled in ("space")
//   <span data-word="space" data-word-form="many cap"></span> any of many, cap and a, space-separated ("Spaces")
//   <p data-fill>Each {space} has a {guest} link.</p>        every text in the element, and its title, placeholder,
//                                                            aria-label, alt and data-title, through fill()
//
// The words come from /api/branding's `words` (loadBranding() in brand.js calls setWords), and are kept in the browser
// so the next page reads them before its own fetch answers. Until then, and when a key is missing, the defaults below:
// today's words. The code names never change; only what a person reads does.

export const KEYS = ['host', 'environment', 'space', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
// The two the host keeps: neither an owner nor a template changes them.
export const FIXED = ['host', 'admin'];
export const CHANGEABLE = KEYS.filter((k) => !FIXED.includes(k));

export const DEFAULTS = Object.freeze({
  host: { one: 'host', many: 'hosts' },
  environment: { one: 'environment', many: 'environments' },
  space: { one: 'space', many: 'spaces' },
  aside: { one: 'aside', many: 'asides' },
  canvas: { one: 'canvas', many: 'canvases' },
  module: { one: 'module', many: 'modules' },
  object: { one: 'object', many: 'objects' },
  admin: { one: 'admin', many: 'admins' },
  owner: { one: 'owner', many: 'owners' },
  moderator: { one: 'moderator', many: 'moderators' },
  member: { one: 'member', many: 'members' },
  guest: { one: 'guest', many: 'guests' },
});

const STORED = 'app.words';
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
const capital = (text) => (text ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text);

// A set as the server sends it ({ <key>: { one, many, a } }), made whole: a key missing or malformed reads its default,
// and host and admin always do.
function resolve(set) {
  const out = {};
  for (const key of KEYS) {
    const w = set && typeof set === 'object' && !FIXED.includes(key) ? set[key] : null;
    const good = w && typeof w.one === 'string' && w.one && typeof w.many === 'string' && w.many;
    const one = good ? w.one : DEFAULTS[key].one;
    const many = good ? w.many : DEFAULTS[key].many;
    out[key] = { one, many, a: good && typeof w.a === 'string' && w.a ? w.a : usualArticle(one) };
  }
  return out;
}

let current = resolve(null);
try {
  const kept = JSON.parse(localStorage.getItem(STORED) || 'null');
  if (kept) current = resolve(kept);
} catch {
  // no storage, or nothing kept: the defaults
}

// The whole resolved set, for a page that hands it on (a module's frame gets it through its context).
export const words = () => current;

// This environment's words, from /api/branding. Kept for the next page, then every data-word and data-fill in the
// document is filled again. Answers whether anything changed.
export function setWords(set) {
  const next = resolve(set);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  try {
    const own = Object.fromEntries(CHANGEABLE.filter((k) => next[k].one !== DEFAULTS[k].one || next[k].many !== DEFAULTS[k].many || next[k].a !== usualArticle(DEFAULTS[k].one)).map((k) => [k, next[k]]));
    if (Object.keys(own).length) localStorage.setItem(STORED, JSON.stringify(own));
    else localStorage.removeItem(STORED);
  } catch {
    // no storage: the next page waits for its own fetch
  }
  if (typeof document !== 'undefined') applyWords(document);
  return changed;
}

// One key's word: the singular, `many` the plural, `a` the singular with its article; `cap` gives it a capital first
// letter. An unknown key is a mistake in the code, so it throws.
export function word(key, { many = false, cap = false, a = false } = {}) {
  const w = current[key];
  if (!w) throw new Error(`There is no word called ${key}.`);
  const text = a ? w.a : many ? w.many : w.one;
  return cap ? capital(text) : text;
}

// Fixed text with its level and role words as placeholders in their default form, each replaced by this environment's
// word in the same form: {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space} ({an aside}: either article reads the
// word's own). Anything else in braces is left as it is.
const BY_DEFAULT = new Map(KEYS.flatMap((k) => [[DEFAULTS[k].one, { key: k, many: false }], [DEFAULTS[k].many, { key: k, many: true }]]));
const PLACEHOLDER = /\{((?:a|an|A|An) )?([A-Za-z]+)\}/g;
export function fill(text) {
  return String(text).replace(PLACEHOLDER, (whole, article, name) => {
    const found = BY_DEFAULT.get(name.toLowerCase());
    if (!found || (article && found.many)) return whole;
    const cap = article ? article.charAt(0) === 'A' : name.charAt(0) !== name.charAt(0).toLowerCase();
    return word(found.key, { many: found.many, a: Boolean(article), cap });
  });
}

// --- the markup -------------------------------------------------------------------------------------------------------
const FILL_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-title'];
// What each filled text or attribute read before it was filled, so a second fill (new words) starts from the
// placeholders again. When the page's own code has since changed it, what it holds now is the text.
const TEXTS = new WeakMap();
const ATTRS = new WeakMap();

function fillText(node) {
  const seen = TEXTS.get(node);
  const source = seen && node.nodeValue === seen.shown ? seen.source : node.nodeValue;
  if (!source.includes('{')) return;
  const shown = fill(source);
  TEXTS.set(node, { source, shown });
  if (node.nodeValue !== shown) node.nodeValue = shown;
}

function fillAttrs(el) {
  let kept = ATTRS.get(el);
  for (const name of FILL_ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const now = el.getAttribute(name);
    const seen = kept && kept[name];
    const source = seen && now === seen.shown ? seen.source : now;
    if (!source.includes('{')) continue;
    const shown = fill(source);
    if (!kept) ATTRS.set(el, (kept = {}));
    kept[name] = { source, shown };
    if (now !== shown) el.setAttribute(name, shown);
  }
}

// Fill every data-word and data-fill in `root` (a document, an element, or a shadow root). A page calls it after it
// draws markup of its own with these attributes in it; loadBranding() does the whole document.
export function applyWords(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const all = (sel) => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  for (const el of all('[data-word]')) {
    const key = el.dataset.word;
    if (!current[key]) continue;
    const form = ` ${el.dataset.wordForm || ''} `;
    const text = word(key, { many: form.includes(' many '), cap: form.includes(' cap '), a: form.includes(' a ') });
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of all('[data-fill]')) {
    fillAttrs(el);
    for (const inner of el.querySelectorAll('*')) fillAttrs(inner);
    const walker = (el.ownerDocument || document).createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) fillText(n);
  }
}

// The page's own markup, as soon as this is loaded (before the fetch answers, from the words kept last time).
if (typeof document !== 'undefined') applyWords(document);
