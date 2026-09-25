// A template as a file (documentation/plans/plan-environment-templates.md, addendum 2, "Template files"):
// `<name>.magpie-template.json`, holding { magpieTemplate: 1, ...the template's fields }, its theme in the theme file's
// shape (server/theme-file.js). At most 64 KB. Reading one drops (and lists) the keys it doesn't know, at the top level
// and inside its theme, then checks what is left exactly as a bundled or host template is checked (server/templates.js).
'use strict';

const templates = require('./templates');
const themeFile = require('./theme-file');

const TEMPLATE_FILE_VERSION = 1;
const MAX_TEMPLATE_FILE_BYTES = 64 * 1024;
const NOT_A_TEMPLATE_FILE = "That isn't a Magpie template file.";
const NEWER = 'This template was made by a newer version of Magpie.';

class TemplateFileError extends Error {
  constructor(message, status = 400, problems = null) {
    super(message);
    this.status = status;
    if (problems) this.problems = problems;
  }
}

// The file for a template as the server keeps it (templates.cleanTemplate's shape, from any source).
function templateToFile(t) {
  const out = { magpieTemplate: TEMPLATE_FILE_VERSION };
  for (const key of templates.FIELDS) {
    if (key === 'theme' || key === 'reactions') continue;
    if (t[key] !== undefined && t[key] !== null) out[key] = t[key]; // a part the template doesn't have is left out
  }
  if (t.reactions) out.reactions = t.reactions;
  if (t.theme) {
    const { magpieTheme, ...theme } = themeFile.themeToFile(t.theme);
    out.theme = theme;
  }
  return out;
}

function templateFileName(name) {
  return themeFile.themeFileName(name).replace(/\.magpie-theme\.json$/, '.magpie-template.json');
}

// Checks a file (its text, or JSON already parsed) and answers { raw, dropped }: `raw` the template's own fields, valid
// by problemsOf. Refusals, in order: too big, not JSON, not an object, magpieTemplate missing or not a whole number ->
// NOT_A_TEMPLATE_FILE; a newer magpieTemplate -> NEWER; then what is left must be a valid template (the first problem
// is the error; `problems` lists them all). `bundled`: the bundled modules' ids.
function readTemplateFile(input, { bundled = [], byteLength = null } = {}) {
  let file = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    if (Buffer.byteLength(text) > MAX_TEMPLATE_FILE_BYTES) throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
    try { file = JSON.parse(text); } catch { throw new TemplateFileError(NOT_A_TEMPLATE_FILE); }
  } else if (byteLength !== null && byteLength > MAX_TEMPLATE_FILE_BYTES) {
    throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  const version = file.magpieTemplate;
  if (!Number.isInteger(version) || version < 1) throw new TemplateFileError(NOT_A_TEMPLATE_FILE);
  if (version > TEMPLATE_FILE_VERSION) throw new TemplateFileError(NEWER);
  const dropped = [];
  const raw = {};
  for (const [key, value] of Object.entries(file)) {
    if (key === 'magpieTemplate') continue;
    if (!templates.FIELDS.includes(key)) { dropped.push(key); continue; }
    raw[key] = value;
  }
  if (raw.theme && typeof raw.theme === 'object' && !Array.isArray(raw.theme)) {
    const known = ['name', 'author', 'light', 'dark'];
    for (const key of Object.keys(raw.theme)) if (!known.includes(key)) dropped.push(`theme.${key}`);
    raw.theme = Object.fromEntries(Object.entries(raw.theme).filter(([k]) => known.includes(k)));
    for (const mode of ['light', 'dark']) {
      const set = raw.theme[mode];
      if (!set || typeof set !== 'object') continue;
      for (const key of Object.keys(set)) if (!themeFile.SET_KEYS.includes(key)) dropped.push(`theme.${mode}.${key}`);
      raw.theme[mode] = Object.fromEntries(Object.entries(set).filter(([k]) => themeFile.SET_KEYS.includes(k)));
    }
  }
  const problems = templates.problemsOf(raw, { bundled });
  if (problems.length) throw new TemplateFileError(problems[0], 400, problems);
  return { raw, dropped };
}

module.exports = { TEMPLATE_FILE_VERSION, MAX_TEMPLATE_FILE_BYTES, NOT_A_TEMPLATE_FILE, NEWER, TemplateFileError, templateToFile, templateFileName, readTemplateFile };
