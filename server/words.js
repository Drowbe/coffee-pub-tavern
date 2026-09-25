// The words a person reads for each level and role (documentation/plans/plan-environment-templates.md, "The
// vocabulary"). The code names never change; only what a person reads does. Each key has a singular (`one`), a plural
// (`many`) and, when the usual "a"/"an" is wrong for it, its singular with its article (`a`, such as "an hour").
//
// Where a word comes from, in order: the owner's own (settings.words.<key>), else the environment's template's, else
// the default below. `host` and `admin` are the host's own words and always read their defaults: neither an owner nor a
// template can change them (decision 18). Resolved per request, so a change is live on the next one.
//
// The server's sentences that name a level or role go through word() (or fill(), for fixed text such as a
// permission's label), never a typed word: tools/check-names.mjs --words holds them to it.

const KEYS = ['host', 'environment', 'space', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
const FIXED = ['host', 'admin'];
const CHANGEABLE = KEYS.filter((k) => !FIXED.includes(k));

// Today's words. `a` is left out here: every default takes the usual article, worked out from its first letter.
const DEFAULTS = Object.freeze({
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

const MAX_LENGTH = 30;
// Plain text only: letters (any alphabet), with single spaces, hyphens and apostrophes between them.
const WORD_RE = /^\p{L}[\p{L}\p{M}]*(?:(?: |-|'|’)\p{L}[\p{L}\p{M}]*)*$/u;
const ARTICLE_RE = /^\p{L}{1,10}$/u; // the article itself: one word of up to ten letters

const tidy = (v) => String(v).trim().replace(/\s+/g, ' ');
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;

// One word as given ({ one, many, a? }), checked: { word } (tidied, `a` kept only when given) or { error }, one sentence.
function cleanWord(key, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `The word for ${key} must be its singular and plural, or null to use the default.` };
  const extra = Object.keys(raw).find((f) => !['one', 'many', 'a'].includes(f));
  if (extra) return { error: `The word for ${key} takes only one, many and a.` };
  if (typeof raw.one !== 'string' || typeof raw.many !== 'string' || !tidy(raw.one) || !tidy(raw.many)) return { error: `The word for ${key} needs both its singular and its plural.` };
  const one = tidy(raw.one);
  const many = tidy(raw.many);
  if (one.length > MAX_LENGTH || many.length > MAX_LENGTH) return { error: `The word for ${key} can be at most ${MAX_LENGTH} characters.` };
  if (!WORD_RE.test(one) || !WORD_RE.test(many)) return { error: `The word for ${key} can use only letters, spaces, hyphens and apostrophes.` };
  const word = { one, many };
  if (raw.a !== undefined && raw.a !== null && tidy(raw.a) !== '') {
    const a = typeof raw.a === 'string' ? tidy(raw.a) : '';
    const article = a.endsWith(` ${one}`) ? a.slice(0, -(one.length + 1)) : '';
    if (!ARTICLE_RE.test(article)) {
      return { error: `The word for ${key} with its article must be its singular with the article in front, such as "a ${one}".` };
    }
    word.a = a;
  }
  return { word };
}

// The owner's words after a change: `patch` is { <key>: { one, many, a? } | null }, null returning that key to the
// template's word or the default. Answers { words } (the whole new set, keys in vocabulary order; {} when none are the
// owner's own) or { error }, one sentence; on an error nothing is changed.
function applyPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'Words must be given by name, each with its singular and plural.' };
  const next = { ...ownOnly(current) };
  for (const [key, raw] of Object.entries(patch)) {
    if (FIXED.includes(key)) return { error: `The ${key} word is the host's own and can't be changed.` };
    if (!CHANGEABLE.includes(key)) return { error: `There is no word called ${key}; the words are ${CHANGEABLE.join(', ')}.` };
    if (raw === null) { delete next[key]; continue; }
    const { word, error } = cleanWord(key, raw);
    if (error) return { error };
    next[key] = word;
  }
  return { words: Object.fromEntries(CHANGEABLE.filter((k) => next[k]).map((k) => [k, next[k]])) };
}

// A stored set, keeping only the changeable keys whose words are still good (a hand-edited file reads as far as it can).
function ownOnly(set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return {};
  const out = {};
  for (const key of CHANGEABLE) {
    if (set[key] === undefined || set[key] === null) continue;
    const { word } = cleanWord(key, set[key]);
    if (word) out[key] = word;
  }
  return out;
}

// Every key's words, resolved: the owner's, else the template's, else the default; `host` and `admin` always the
// default. Each is { one, many, a }, `a` filled in with the usual article when the word did not give its own.
function resolve(ownerWords, templateWords) {
  const owner = ownOnly(ownerWords);
  const template = ownOnly(templateWords);
  const out = {};
  for (const key of KEYS) {
    const w = (!FIXED.includes(key) && (owner[key] || template[key])) || DEFAULTS[key];
    out[key] = { one: w.one, many: w.many, a: w.a || usualArticle(w.one) };
  }
  return out;
}

const DEFAULT_RESOLVED = resolve(null, null);

const capital = (text) => (text ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text);

// One key's word from a resolved set: the singular, `many` the plural, `a` the singular with its article; `cap` gives
// it a capital first letter. An unknown key is a mistake in the code, so it throws.
function format(resolved, key, { many = false, cap = false, a = false } = {}) {
  const w = (resolved && resolved[key]) || DEFAULT_RESOLVED[key];
  if (!w) throw new Error(`There is no word called ${key}.`);
  const text = a ? w.a : many ? w.many : w.one;
  return cap ? capital(text) : text;
}

// Whose words word() reads: set once by the server to the current request's environment (null outside one, which
// reads the defaults).
let current = () => null;
function useCurrent(fn) { current = typeof fn === 'function' ? fn : () => null; }

// The word for a level or role in the current environment's words: word('space'), word('space', { many: true, cap:
// true }), word('aside', { a: true }).
function word(key, options) {
  return format(current() || DEFAULT_RESOLVED, key, options);
}

// Fixed text (a permission's label, a built-in module's description) with its level and role words as placeholders
// in their default form: {space}, {spaces}, {Space}, {Spaces}, {a space}, {A space} ({an aside}: either article reads the
// word's own). Each is replaced by the current
// environment's word, in the same form; anything else in braces is left as it is.
const BY_DEFAULT = new Map(KEYS.flatMap((k) => [[DEFAULTS[k].one, { key: k, many: false }], [DEFAULTS[k].many, { key: k, many: true }]]));
const PLACEHOLDER = /\{((?:a|an|A|An) )?([A-Za-z]+)\}/g;
function fill(text, resolved) {
  const set = resolved || current() || DEFAULT_RESOLVED;
  return String(text).replace(PLACEHOLDER, (whole, article, name) => {
    const found = BY_DEFAULT.get(name.toLowerCase());
    if (!found || (article && found.many)) return whole;
    const cap = article ? article.charAt(0) === 'A' : name.charAt(0) !== name.charAt(0).toLowerCase();
    return format(set, found.key, { many: found.many, a: Boolean(article), cap });
  });
}

module.exports = { KEYS, FIXED, CHANGEABLE, DEFAULTS, MAX_LENGTH, cleanWord, applyPatch, ownOnly, resolve, format, word, fill, useCurrent };
