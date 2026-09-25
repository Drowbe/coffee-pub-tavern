// A theme as a file (documentation/plans/plan-themes.md, "The file"): `<name>.magpie-theme.json`, holding
// { magpieTheme: 1, name, author?, light, dark }, each set with every one of the sixteen stored keys (the seven base
// colors and the nine optional ones, null for Auto), or null for a set the theme doesn't have. Keys are the stored
// names, never CSS property names: server/theme-css.js stays the one place that maps a key to CSS, so a file can
// only ever carry colors.
//
// themeToFile() writes one; readThemeFile() checks one in the plan's order, each refusal a ThemeFileError with its
// sentence, and answers what to add plus the keys it left out. Adding it (a new id, "Name (2)" on a clash) is
// Store.importTheme's.
'use strict';

const { THEME_BASE, THEME_OPTIONAL, DEFAULT_THEME, cleanText, cleanAuthor } = require('./store');

const THEME_FILE_VERSION = 1; // the newest magpieTheme this server reads
const MAX_THEME_FILE_BYTES = 16 * 1024;
const SET_KEYS = [...THEME_BASE, ...THEME_OPTIONAL];
const TOP_KEYS = ['magpieTheme', 'name', 'author', 'light', 'dark'];
const MODES = ['light', 'dark'];

const NOT_A_THEME_FILE = "That isn't a Magpie theme file.";
const NEWER = 'This theme was made by a newer version of Magpie.';
const NO_COMPLETE_SET = 'This theme has no complete light or dark set: each needs all seven base colors.';

class ThemeFileError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Every key of a set, in the stored order, null for any the set leaves on Auto; null for no set at all.
const fullSet = (set) => (set ? Object.fromEntries(SET_KEYS.map((key) => [key, set[key] || null])) : null);

// The file for a stored theme ({ name, author?, light, dark }), or for Strong Coffee when `theme` is null -- its dark
// set written out (style.css's own palette, which the store keeps as null) rather than left empty (decision 6).
function themeToFile(theme) {
  const t = theme || DEFAULT_THEME;
  const author = cleanAuthor(t.author);
  return { magpieTheme: THEME_FILE_VERSION, name: t.name, ...(author ? { author } : {}), light: fullSet(t.light), dark: fullSet(t.dark) };
}

// The theme's name made safe for a file: lower-case letters, digits and hyphens, then .magpie-theme.json.
function themeFileName(name) {
  const safe = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${safe || 'theme'}.magpie-theme.json`;
}

// Checks a file, given as its text (or bytes) or as JSON already parsed, in the plan's order:
//   over 16 KB, not JSON, not an object; magpieTheme missing or not a whole number  -> NOT_A_THEME_FILE
//   magpieTheme above THEME_FILE_VERSION                                            -> NEWER
//   every unknown key dropped, at the top level and inside each set (named in `dropped`, "light.glow", "font")
//   each set through `sanitize` (Store#sanitizeTheme, the same check as a theme made in Manage): a set missing a
//   base color, or with one that isn't #rrggbb, is dropped whole ("dark"); an optional one that isn't a color goes
//   back to Auto ("light.card")
//   no complete set left                                                            -> NO_COMPLETE_SET
//   name cleaned to 40 characters ("Theme" when empty), author to 60 of plain text
// Answers { name, author, light, dark, dropped }; `byteLength`, when the caller knows the size of what was sent.
function readThemeFile(input, sanitize, { byteLength = null } = {}) {
  let file = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    if (Buffer.byteLength(text) > MAX_THEME_FILE_BYTES) throw new ThemeFileError(NOT_A_THEME_FILE);
    try { file = JSON.parse(text); } catch { throw new ThemeFileError(NOT_A_THEME_FILE); }
  } else if (byteLength !== null && byteLength > MAX_THEME_FILE_BYTES) {
    throw new ThemeFileError(NOT_A_THEME_FILE);
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new ThemeFileError(NOT_A_THEME_FILE);
  const version = file.magpieTheme;
  if (!Number.isInteger(version) || version < 1) throw new ThemeFileError(NOT_A_THEME_FILE);
  if (version > THEME_FILE_VERSION) throw new ThemeFileError(NEWER);

  const dropped = Object.keys(file).filter((key) => !TOP_KEYS.includes(key));
  const sets = {};
  for (const mode of MODES) {
    const given = file[mode];
    sets[mode] = null;
    if (given === undefined || given === null) continue; // a theme with only the other set
    if (typeof given !== 'object' || Array.isArray(given)) { dropped.push(mode); continue; }
    const known = {};
    for (const [key, value] of Object.entries(given)) {
      if (SET_KEYS.includes(key)) known[key] = value;
      else dropped.push(`${mode}.${key}`);
    }
    // One set at a time, as the light set of a theme with no other, so sanitize never guesses a mode for it.
    const clean = sanitize({ id: null, name: '', light: known })?.light || null;
    if (!clean) { dropped.push(mode); continue; }
    for (const key of THEME_OPTIONAL) if (known[key] !== undefined && known[key] !== null && clean[key] === null) dropped.push(`${mode}.${key}`);
    sets[mode] = clean;
  }
  if (!sets.light && !sets.dark) throw new ThemeFileError(NO_COMPLETE_SET);
  if (file.name !== undefined && typeof file.name !== 'string') dropped.push('name');
  if (file.author !== undefined && file.author !== null && typeof file.author !== 'string') dropped.push('author');
  const name = cleanText(typeof file.name === 'string' ? file.name : '', 40) || 'Theme';
  const author = cleanAuthor(file.author);
  return { name, ...(author ? { author } : {}), light: sets.light, dark: sets.dark, dropped };
}

module.exports = {
  THEME_FILE_VERSION, MAX_THEME_FILE_BYTES, SET_KEYS, NOT_A_THEME_FILE, NEWER, NO_COMPLETE_SET,
  ThemeFileError, themeToFile, themeFileName, readThemeFile,
};
