#!/usr/bin/env node
/*
 * check-names.mjs -- the old names left in the code, level by level (documentation/plans/plan-names.md,
 * "tools/check-names.mjs"), and the Names migration run twice over an old-format data directory.
 *
 * Each level (environment, table, role, space, canvas, module, object, aside) is either `report` (its hits are
 * counted, never failing) or `enforce` (any hit outside the allow-list fails). Step 1 of the plan ships every level
 * as `report`; each later step switches its own levels to `enforce` in LEVELS below.
 *
 * Code mode reads identifiers, keys, routes, CSS classes, element ids and file names: comments and sentences (a
 * string with a space in it, an HTML text node or a title, placeholder, aria-label or alt) are left out. A string
 * with a space is still code when it is a class list or a selector (it is handed to className, classList,
 * querySelector(All), closest, matches or getElementById, or it has that shape). Words mode reads only the
 * sentences, for "room", "rooms" and "table" as words.
 *
 * The vocabulary rule (plan-environment-templates.md, "check-names --words"): a level or role word an owner or a
 * template can change (server/words.js's CHANGEABLE keys, singular or plural, any capital) typed into what a person
 * reads, instead of going through the helper: word() on the server, word(), fill(), data-word or data-fill on the
 * pages, host.util.word in a module, or a {space}-style placeholder. It reads every string and template piece on its
 * own (readAsWord): one with a space, a capital or punctuation beside the form is text; a form alone in lower case
 * ('space') is a key unless it is handed to a title, placeholder, aria-label, alt, text or label, joined to other text
 * with +, or written right before a template's ${. Class names and selectors are not read. Neither are strings handed
 * to a log call (the host operator's, in the host's words), with everything inside their ${}, nor strings or templates
 * about module.json (the manifest's code names). A {a spaces} or {a trip} placeholder, which fill() leaves as it is,
 * fails too. HTML text and the attributes a person reads are read as words. Allow-list entries for it use the level
 * "word". It also checks that every key a word() call or a data-word attribute names is in the vocabulary, with both
 * its forms. *
 * tools/check-names-allow.json: [{ file, level, pattern, line?, reason }]. `file` is a path from the repository's
 * root, where * matches within one folder and ** across folders. `level` is the level it allows (or "*" for every
 * level, only for a named file or folder, never "**"). `pattern` is a regular expression tested against the hit's
 * own token (the run of name characters around that one match), never the rest of its line, so an entry allows
 * only its own match; `line`, when given, is a regular expression the line must also match (context such as
 * `<table`). An entry without a reason fails, and so does one over "**" that would allow anything. Entries no hit
 * used are listed.
 *
 *   node tools/check-names.mjs                code and words reports, the allow-list, and the migration
 *   node tools/check-names.mjs --words        the words report and the vocabulary rule only
 *   node tools/check-names.mjs --migration    the migration check only
 *   node tools/check-names.mjs --list[=level] also list every hit (of one level), file:line and the token
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const listArg = args.find((a) => a === '--list' || a.startsWith('--list='));
const listLevel = listArg && listArg.includes('=') ? listArg.split('=')[1] : null;
const onlyWords = args.includes('--words');
const onlyMigration = args.includes('--migration');
const runCode = !onlyWords && !onlyMigration;
const runWords = onlyWords || !onlyMigration;
const runMigration = onlyMigration || (!onlyWords);

// The levels, top down, then the roles, then the rest of the plan's renames. `code` and `words` are each
// 'report' or 'enforce' (null: that mode has no pattern for this level). `step` is the plan's step that
// switches the level to enforce. `enforceIn`, when given, keeps an enforced level to those folders for now: a hit
// anywhere else is only reported, until the step that renames it there. (The space level used it through step 5:
// server/ and tools/ from 5a, public/ from 5b, and everywhere from 5c.)
const LEVELS = [
  { id: 'environment', step: '2', code: 'enforce', words: 'enforce', codePatterns: [/tenant/gi], wordPatterns: [/\btenants?\b/gi] },
  {
    id: 'table', step: '3', code: 'enforce', words: 'enforce',
    codePatterns: [/(?<![A-Za-z])table|(?<=[a-z])Table|TABLE/g],
    wordPatterns: [/\btables?\b/gi],
  },
  // The roles: `user` (now `member`) as a role value, the old role routes and names. `admin` is not searched for: it is
  // a real role (the server's admin, and the host admin's stand-in; plan-names decision 7, amended), so neither code
  // comparing with it nor a sentence saying it can be told from an old name by pattern. No words pattern, for the same
  // reason: "admin" in a sentence is mostly the server's admin now.
  {
    id: 'role', step: '4', code: 'enforce', words: null,
    codePatterns: [
      /\brole\s*[!=]==?\s*['"]user['"]/g, /['"]user['"]\s*[!=]==?\s*[\w.?]*\brole\b/g,
      /\brole:\s*['"]user['"]/g, /\bROLES\s*=\s*\[[^\]]*['"]user['"]/g, /\broles\.user\b/g,
      /\/api\/roles\/user\b/g, /\brequireAdmin\b/g, /\badminCount\b/g,
    ],
  },
  {
    id: 'space', step: '5', code: 'enforce', words: 'enforce',
    codePatterns: [/room/gi, /\bserverName\b/g, /\bscope\s*(:|[!=]==?)\s*['"]server['"]/g, /['"]server['"]\s*[!=]==?\s*[\w.?]*\bscope\b/g, /\bscope:\s*\[[^\]]*['"](room|server)['"]/g],
    wordPatterns: [/\brooms?\b/gi],
  },
  // Step 6: the canvas was the `stage`, and a module on it a `pane` or (in a manifest and the floating box's classes) a
  // `panel`. /pane/ covers panel too; "panel" meaning a panel of a page that is not a module (the .panel card and
  // the ids named after one) is allowed in tools/check-names-allow.json by meaning. A person never reads "pane".
  { id: 'canvas', step: '6', code: 'enforce', words: 'enforce', codePatterns: [/stage/gi], wordPatterns: [/\bstages?\b/gi] },
  { id: 'module', step: '6', code: 'enforce', words: 'enforce', codePatterns: [/pane/gi], wordPatterns: [/\bpanes?\b/gi] },
  // Step 7: an object's summary was its `card`, `host.objects` was `host.refs` (with `refKey`, the drag's REF_MIME and the
  // /api/refs routes), and the AI's `objects` its `items`: enforced everywhere. Menu and toolbar items and card-shaped
  // styles (the --bg-card token, a module's own card templates) are not objects; they are allowed by meaning.
  {
    id: 'object', step: '7', code: 'enforce', words: 'enforce',
    // In what a person reads: "item" and "card" for an object (a task, a note, a place). Menu items, a list's items and
    // card-shaped parts of a page are not objects; they are allowed by meaning in tools/check-names-allow.json.
    // Only where a person reads it (not the tools' own messages), and never as part of a class or property name.
    wordPatterns: [/(?<![\w-])(items?|cards?)(?![\w-])/gi], wordsIn: ['server/', 'public/', 'modules/'],
    codePatterns: [
      // The old names of the SDK's drag and open messages and the drag's data type, and the AI's old marker.
      /refsdrag/gi, /refopen/gi, /application\/x-host-ref\b/g, /\{\{card:/g,
      /\bhost\.refs\b/g, /\brefs\.(make|resolve|kinds|open|onOpen|setLinks|linksTo|linksFrom|search|drag|draggable|dropTarget|fillFor|offersFor|dropMenu|accepts|parse|trace|elementAt)\b/g,
      /\brefKey\b/g, /\bREF_MIME\b/g, /\/api\/refs\b/g, /\/refs\//g, /\bcards\b/g, /["']card["']\s*:|\bcard\s*:\s/g,
      // The AI's `items` (pointers it is asked about), in the object sense only: not menu or toolbar items.
      /\bask\(\s*\{[^}]*\bitems\b/g, /\bitems:\s*o\s*&&\s*o\.items\b/g, /\breq\.body\??\.items\b/g,
    ],
  },
  // Step 8: an aside stops being an `ephemeral` row among the spaces (addAsideRoom, pruneAsideRooms becoming
  // pruneAsides, the pages' asideRoom). The data topics before step 3 (pull-aside, recall, return-to-table) are kept
  // as a guard: step 3 removed them everywhere with no overlap, so any hit is one coming back.
  {
    id: 'aside', step: '8', code: 'report', words: null,
    codePatterns: [/ephemeral/gi, /\b(addAsideRoom|pruneAsideRooms|asideRoom)\b/g, /['"`](pull-aside|return-to-table|recall)['"`]/g],
  },
];

// What is scanned: the server, the pages and the SDK (not vendored files), each module's source and manifest, and
// the tools. The allow-list itself is the check's own input, not code.
const EXT = /\.(js|mjs|cjs|html|css|json)$/;
const SKIP = [
  /^public\/lib\//, /^public\/models\//, /^public\/maps-glyphs\//, /^tools\/\.wiki-build\//,
  /^modules\/maps\/src\/maps-lib-a-maplibre\./, /^modules\/maps\/src\/maps-lib-b-pmtiles\./,
  /^tools\/check-names-allow\.json$/, /(^|\/)node_modules\//,
];
function walk(rel, out = []) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP.some((re) => re.test(child) || re.test(`${child}/`))) continue;
    if (entry.isDirectory()) walk(child, out);
    else if (entry.isFile() && EXT.test(entry.name)) out.push(child);
  }
  return out;
}
function scannedFiles() {
  const modules = fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  return [
    ...walk('server'), ...walk('public'), ...walk('tools'),
    ...modules.flatMap((m) => [...walk(`modules/${m}/src`), ...(fs.existsSync(path.join(ROOT, 'modules', m, 'module.json')) ? [`modules/${m}/module.json`] : [])]),
  ];
}

// --- splitting a file into code and words --------------------------------------------------------------------
// Two copies of the text, the same length, with newlines kept (so a hit's line is its line in the file): `code`
// with comments and sentences blanked, `words` with everything but sentences blanked.
const blank = (s) => s.replace(/[^\n]/g, ' ');
const isSentence = (s) => /\S\s+\S/.test(s);
// A string handed to something that takes class names, ids or selectors, by what comes right before its quote.
const SELECTOR_CONTEXT = /(?:\.className\s*\+?=\s*|\bclass(?:Name)?\s*:\s*|\bclassList\.(?:add|remove|toggle|contains|replace)\(\s*(?:[^()]*,\s*)?|\.(?:querySelector(?:All)?|closest|matches|getElementById|getElementsByClassName)\(\s*|\bsetAttribute\(\s*['"](?:class|id)['"]\s*,\s*)$/;
// A string a person reads whatever its shape: an error's message, or what a JSON answer sends back.
const SENTENCE_CONTEXT = /(?:\berror\s*:\s*|\bthrow\s+new\s+\w*Error\(\s*|\bnew\s+\w*Error\(\s*|\.json\(\s*)$/;
// Or by its shape: a selector list ('.a, .b > #c'), or a class list (lower-case names, at least one hyphenated).
const SELECTOR_PART = /^(?:[>+~*]|[\w-]*(?:[.#][\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)+)$/;
const CLASS_PART = /^-?[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*-?$/;
function isNameList(body) {
  const parts = body.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (parts.every((p) => SELECTOR_PART.test(p) || CLASS_PART.test(p)) && parts.some((p) => /^[\w-]*[.#]/.test(p))) return true;
  return parts.every((p) => CLASS_PART.test(p)) && parts.some((p) => p.includes('-'));
}

// JavaScript (and JSON, which it reads the same way): strings, template literals (with ${} inside), regular
// expression literals and comments, by a small scanner rather than a full parser.
// `onString`, when given, hears every string and template piece as it is read, for the vocabulary rule: { at (its
// offset in the file, from `offset`), body, handed ('code', 'words' or null), before (up to 80 characters before its
// quote or backtick), after (up to 40 after its closing quote, or the ${ or backtick after the piece), template (a
// number for each template literal, shared by its pieces; null for a quoted string), first (the template's first
// piece), inside (the template whose ${} it is in, or null) }.
function splitJs(text, onString = null, offset = 0) {
  let code = '';
  let words = '';
  const emit = (s, kind) => {
    if (kind === 'code') { code += s; words += blank(s); } else if (kind === 'words') { code += blank(s); words += s; } else { code += blank(s); words += blank(s); }
  };
  let i = 0;
  let lastSignificant = '';
  const braces = []; // for each open ${ in a template: the brace depth inside it
  const templates = []; // for each open template: 'code' or 'words' by where it was handed, or null (by its shape)
  const templateInfo = []; // for each open template: { id, before, pieces } for onString
  let templateCount = 0;
  const codeContext = (at) => SELECTOR_CONTEXT.test(text.slice(Math.max(0, at - 80), at));
  const sentenceContext = (at) => SENTENCE_CONTEXT.test(text.slice(Math.max(0, at - 80), at));
  const handedTo = (at) => (sentenceContext(at) ? 'words' : codeContext(at) ? 'code' : null);
  // A string or template chunk with a space: code or words, by where it was handed first and its shape second.
  const kindOf = (body, handed) => {
    if (!isSentence(body)) return 'code';
    if (handed) return handed;
    return isNameList(body) ? 'code' : 'words';
  };
  const regexAllowed = () => !lastSignificant || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSignificant) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(lastSignificant);
  const readString = (quote, start) => {
    let j = start + 1;
    while (j < text.length && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, text.length);
  };
  // A template literal from `from` (just past a backtick or a closing }) to its end or its next ${.
  const readTemplate = (from) => {
    let j = from;
    while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
    return j;
  };
  const templateChunk = (from) => {
    const end = readTemplate(from);
    const body = text.slice(from, end);
    emit(body, kindOf(body, templates[templates.length - 1]));
    const info = templateInfo[templateInfo.length - 1];
    if (onString && info) {
      onString({ at: offset + from, body, handed: templates[templates.length - 1], before: info.before, after: text.slice(end, end + 40), template: info.id, first: info.pieces === 0, inside: info.inside });
      info.pieces += 1;
    }
    if (text[end] === '`') { emit('`', 'code'); i = end + 1; lastSignificant = '`'; templates.pop(); templateInfo.pop(); } else if (end < text.length) { emit('${', 'code'); i = end + 2; braces.push(0); lastSignificant = '{'; } else { i = end; templates.pop(); templateInfo.pop(); }
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      emit(text.slice(i, stop), 'none');
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      emit(text.slice(i, stop), 'none');
      i = stop;
    } else if (c === '"' || c === "'") {
      const stop = readString(c, i);
      const body = text.slice(i + 1, stop - 1);
      emit(c, 'code');
      emit(body, kindOf(body, handedTo(i)));
      if (onString) onString({ at: offset + i + 1, body, handed: handedTo(i), before: text.slice(Math.max(0, i - 80), i), after: text.slice(stop, stop + 40), template: null, first: true, inside: templateInfo.length ? templateInfo[templateInfo.length - 1].id : null });
      emit(text.slice(stop - 1, stop), 'code');
      i = stop;
      lastSignificant = c;
    } else if (c === '`') {
      templates.push(handedTo(i));
      templateInfo.push({ id: (templateCount += 1), before: text.slice(Math.max(0, i - 80), i), pieces: 0, inside: templateInfo.length ? templateInfo[templateInfo.length - 1].id : null });
      emit('`', 'code');
      templateChunk(i + 1);
    } else if (c === '}' && braces.length && braces[braces.length - 1] === 0) {
      braces.pop();
      emit('}', 'code');
      templateChunk(i + 1);
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        j += 1;
      }
      while (j + 1 < text.length && /[a-z]/.test(text[j + 1])) j += 1;
      emit(text.slice(i, j + 1), 'code');
      i = j + 1;
      lastSignificant = '/';
    } else {
      if (c === '{' && braces.length) braces[braces.length - 1] += 1;
      if (c === '}' && braces.length) braces[braces.length - 1] -= 1;
      emit(c, 'code');
      // The last word or mark before this point, for telling a regular expression from a division.
      if (!/\s/.test(c)) lastSignificant = (/[\w$]/.test(c) && /[\w$]/.test(text[i - 1] || '') ? lastSignificant + c : c).slice(-12);
      i += 1;
    }
  }
  return { code, words };
}

function splitCss(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  return { code, words: blank(text) };
}

// HTML: comments dropped; <script> and <style> read as JavaScript and CSS; a tag's own attributes are code except
// the ones a person reads; text between tags is words.
const READ_ATTRS = /\b(title|placeholder|aria-label|alt)\s*=\s*("[^"]*"|'[^']*')/gi;
function splitHtml(text, onString = null) {
  let code = '';
  let words = '';
  const add = (part) => { code += part.code; words += part.words; };
  const re = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[^>]*>/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const between = text.slice(last, m.index);
    add({ code: blank(between), words: between });
    const tag = m[0];
    if (tag.startsWith('<!--')) add({ code: blank(tag), words: blank(tag) });
    else if (/^<script\b/i.test(tag) || /^<style\b/i.test(tag)) {
      const open = tag.indexOf('>') + 1;
      const close = tag.lastIndexOf('</');
      add({ code: tag.slice(0, open), words: blank(tag.slice(0, open)) });
      add(/^<script\b/i.test(tag) ? splitJs(tag.slice(open, close), onString, m.index + open) : splitCss(tag.slice(open, close)));
      add({ code: tag.slice(close), words: blank(tag.slice(close)) });
    } else {
      let tagCode = tag;
      let tagWords = blank(tag);
      for (const a of tag.matchAll(READ_ATTRS)) {
        const at = a.index + a[0].length - a[2].length + 1;
        const len = a[2].length - 2;
        tagCode = tagCode.slice(0, at) + blank(tag.slice(at, at + len)) + tagCode.slice(at + len);
        tagWords = tagWords.slice(0, at) + tag.slice(at, at + len) + tagWords.slice(at + len);
      }
      add({ code: tagCode, words: tagWords });
    }
    last = m.index + tag.length;
  }
  const rest = text.slice(last);
  add({ code: blank(rest), words: rest });
  return { code, words };
}

function split(file, text, onString = null) {
  if (/\.html$/.test(file)) return splitHtml(text, onString);
  if (/\.css$/.test(file)) return splitCss(text);
  return splitJs(text, onString);
}

// --- the allow-list ------------------------------------------------------------------------------------------
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i += 1; if (glob[i + 1] === '/') i += 1; } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
// An entry would allow anything when its pattern matches names it cannot have meant.
const catchAll = (re) => ['', 'q', 'zzqx', 'anyName'].some((probe) => re.test(probe));
function validateAllow(raw) {
  const problems = [];
  if (!Array.isArray(raw)) return { entries: [], problems: ['tools/check-names-allow.json: must be a list of { file, level, pattern, line?, reason }'] };
  const levels = new Set([...LEVELS.map((l) => l.id), VOCABULARY_LEVEL]);
  const entries = [];
  raw.forEach((e, n) => {
    const where = `tools/check-names-allow.json entry ${n + 1}`;
    if (!e || typeof e !== 'object') return problems.push(`${where}: not an object`);
    const named = `${where} (${e.file} ${e.level} ${e.pattern})`;
    if (typeof e.file !== 'string' || !e.file.trim()) problems.push(`${where}: has no file`);
    if (typeof e.pattern !== 'string' || !e.pattern) problems.push(`${where}: has no pattern`);
    if (e.level !== '*' && !levels.has(e.level)) problems.push(`${named}: its level must be one of ${[...levels].join(', ')}, or "*"`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) problems.push(`${named}: has no reason; say why this old name stays`);
    let re = null;
    let lineRe = null;
    try { re = new RegExp(e.pattern); } catch (err) { problems.push(`${named}: its pattern is not a regular expression (${err.message})`); }
    if (e.line !== undefined) {
      try { lineRe = new RegExp(e.line); } catch (err) { problems.push(`${named}: its line is not a regular expression (${err.message})`); }
    }
    // Every level ("*"), or a pattern that matches anything, only for one exact file (or the old-format fixture's
    // folder, old on purpose): over a glob it would hide whatever else is in those files.
    const exact = typeof e.file === 'string' && !e.file.includes('*');
    const fixture = typeof e.file === 'string' && e.file.startsWith('tools/fixtures/');
    if (!exact && !fixture && (e.level === '*' || (re && catchAll(re) && !lineRe))) problems.push(`${named}: allows anything anywhere; name the level and the exact names it allows`);
    if (re && typeof e.file === 'string') entries.push({ ...e, fileRe: globToRe(e.file), re, lineRe, used: 0 });
  });
  return { entries, problems };
}
function loadAllow() {
  const file = path.join(ROOT, 'tools', 'check-names-allow.json');
  try {
    return validateAllow(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    return { entries: [], problems: [`tools/check-names-allow.json: could not read it (${err.message})`] };
  }
}

// --- scanning --------------------------------------------------------------------------------------------------
const TOKEN_CHAR = /[\w$\-./:]/;
function tokenAt(line, start, end) {
  let a = start;
  let b = end;
  while (a > 0 && TOKEN_CHAR.test(line[a - 1])) a -= 1;
  while (b < line.length && TOKEN_CHAR.test(line[b])) b += 1;
  return line.slice(a, b).replace(/^[./:-]+|[./:-]+$/g, '');
}

const emptyResults = () => new Map(LEVELS.map((l) => [l.id, { hits: [], allowed: 0 }]));
function scan(mode, files, allow) {
  const results = emptyResults();
  for (const file of files) scanText(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), mode, allow, results);
  return results;
}
// One file's text, its hits added to `results` (level id -> { hits, allowed }).
function scanText(file, text, mode, allow, results) {
  {
    const parts = split(file, text);
    if (parts.code.length !== text.length || parts.words.length !== text.length) {
      fail(`check-names: could not read ${file} line for line (the scanner lost its place); fix the scanner before trusting its counts`);
      return results;
    }
    const body = mode === 'code' ? parts.code : parts.words;
    const original = text.split('\n');
    const lines = body.split('\n');
    const fileAllow = allow.filter((e) => e.fileRe.test(file));
    for (const level of LEVELS) {
      const patterns = mode === 'code' ? level.codePatterns : level.wordPatterns;
      if (!patterns || !level[mode]) continue;
      if (mode === 'words' && level.wordsIn && !level.wordsIn.some((dir) => file.startsWith(dir))) continue;
      const bucket = results.get(level.id);
      const record = (lineNo, token, lineText) => {
        // An entry allows only its own level's hit, by that hit's own token (and its line, when it asks for one).
        const hit = fileAllow.find((e) => (e.level === '*' || e.level === level.id) && e.re.test(token) && (!e.lineRe || e.lineRe.test(lineText)));
        if (hit) { hit.used += 1; bucket.allowed += 1; } else bucket.hits.push({ file, line: lineNo, token });
      };
      // A file's own name, in code mode (room.html, check-room-layout.mjs before step 6).
      if (mode === 'code') {
        const base = path.basename(file);
        for (const re of patterns) {
          re.lastIndex = 0;
          if (re.test(base)) record(0, base, file);
          re.lastIndex = 0;
        }
      }
      lines.forEach((line, n) => {
        for (const re of patterns) {
          re.lastIndex = 0;
          for (const m of line.matchAll(re)) record(n + 1, tokenAt(line, m.index, m.index + m[0].length) || m[0], original[n] || '');
        }
      });
    }
  }
  return results;
}

let failed = 0;
const fail = (message) => { failed += 1; console.error(message); };

function report(mode, files, allow) {
  const results = scan(mode, files, allow);
  const rows = [];
  for (const level of LEVELS) {
    const state = level[mode];
    if (!state) continue;
    const { hits, allowed } = results.get(level.id);
    const fileCount = new Set(hits.map((h) => h.file)).size;
    const enforcedHere = (h) => (!level.enforceIn || level.enforceIn.some((dir) => h.file.startsWith(dir))) && !(level.waitingIn || []).includes(h.file);
    const failing = state === 'enforce' ? hits.filter(enforcedHere) : [];
    const where = level.enforceIn ? ` in ${level.enforceIn.join(' and ')}${level.waitingIn ? ` but ${level.waitingIn.length} tools` : ''}; ${hits.length - failing.length} elsewhere reported until step ${level.reportUntil}` : '';
    rows.push(`  ${level.id.padEnd(12)}${state.padEnd(8)}${String(hits.length).padStart(6)} in ${String(fileCount).padStart(3)} files  (${allowed} allowed; enforced from step ${level.step}${where})`);
    if (failing.length) fail(`check-names: ${mode} level "${level.id}" is enforced${level.enforceIn ? ` in ${level.enforceIn.join(' and ')}` : ''} and has ${failing.length} old name${failing.length === 1 ? '' : 's'} left (run with --list=${level.id})`);
    if (listArg && (!listLevel || listLevel === level.id)) {
      for (const h of hits) rows.push(`      ${h.file}:${h.line}  ${h.token}`);
    }
  }
  console.log(`check-names: ${mode}, ${files.length} files`);
  for (const r of rows) console.log(r);
}

// --- the vocabulary rule (plan-environment-templates.md, "check-names --words") -----------------------------------
// Where a typed level or role word fails: everywhere it is read, the server, the pages and the SDK (public/), and the
// bundled modules (converted in step 1). The host console and the product page keep the host's words, by the allow-list.
const VOCABULARY_LEVEL = 'word';
const VOCABULARY_ENFORCED = ['server/', 'public/', 'modules/'];
const VOCABULARY_SCOPE = ['server/', 'public/', 'modules/'];
const WORDS = require('../server/words.js');
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const vocabularyForms = () => WORDS.CHANGEABLE.flatMap((k) => [WORDS.DEFAULTS[k].one, WORDS.DEFAULTS[k].many]);
// A form as a word of its own: not part of a name (module.json, module-settings, spaceId), a path, or a {space}
// placeholder for fill().
const VOCABULARY_WORD = new RegExp(`(?<![\\w.\\-/{$])(?<!\\{[aA] )(?<!\\{[aA]n )(?:${vocabularyForms().map(escapeRe).join('|')})(?![\\w\\-/}]|\\.\\w)`, 'gi');
const MANY_FORMS = new Set(WORDS.CHANGEABLE.concat(WORDS.FIXED).map((k) => WORDS.DEFAULTS[k].many));
const ALL_FORMS = new Set(WORDS.KEYS.flatMap((k) => [WORDS.DEFAULTS[k].one, WORDS.DEFAULTS[k].many]));
// A placeholder with an article ({a space}): fill() fills it only for a singular form it knows.
const ARTICLE_PLACEHOLDER = /\{(?:a|an|A|An) ([A-Za-z]+)\}/g;
// A string handed to a log call (the host operator's, in the host's words): console.log('...') or log(`...`).
const LOG_CALL = /(?:\bconsole\.(?:log|warn|error|info|debug)|(?:^|[^\w.$])log)\(\s*$/;
// A string a person reads whatever its shape: assigned to a title, placeholder, aria-label, alt or text, or given as
// an object's label, title, text or placeholder.
const READ_CONTEXT = /(?:\.(?:title|placeholder|textContent|innerText|ariaLabel|alt|label)\s*=\s*|\bsetAttribute\(\s*['"](?:title|aria-label|placeholder|alt)['"]\s*,\s*|(?:^|[\s{,(])['"]?(?:title|placeholder|ariaLabel|aria-label|alt|text|label)['"]?\s*:\s*)$/;
// The keys a page, the SDK, a module or the server names: word('space'...), util.word('space'...), data-word="space".
const WORD_KEY_USE = /(?:\bword\(\s*|\bdata-word=\s*|\bdataset\.word\s*=\s*)(['"`])([^'"`]*)\1/g;

// Whether one form found in a string (or template piece) is a word a person reads, from the string's shape and where
// it was handed. A string that is only the form in lower case ('space', 'guests') is a key, unless it is handed to
// something a person reads or joined to other text with +; ids, CSS classes and keys never have a space, a capital or
// punctuation beside the form.
function readAsWord(piece, m) {
  const { body, before, after } = piece;
  const token = m[0];
  const next = body.slice(m.index + token.length);
  const prev = body.slice(0, m.index);
  if (piece.handed === 'code') return false; // a class name, id or selector
  if (token !== token.toLowerCase()) return true; // 'Spaces', 'SPACES', 'Space:'
  if (/\s/.test(body) && !isNameList(body)) return true; // a sentence, "Your ", " spaces", "Space: "
  if (/^[,;!?)]/.test(next) || /^:(\s|$)/.test(next) && next.length > 1 || /\($/.test(prev)) return true;
  if (body === token) {
    if (READ_CONTEXT.test(before)) return true; // el.title = 'owner'
    if (piece.template === null && (/['"`]\s*\+\s*$/.test(before) || /^\s*\+\s*['"`]/.test(after))) return true; // 'Delete ' + 'space'
    if (piece.template !== null && piece.first && after.startsWith('${')) return true; // `space${n === 1 ? '' : 's'}`
  }
  return false;
}

function vocabularyHits(file, text, allow) {
  const pieces = [];
  const parts = split(file, text, (piece) => pieces.push(piece));
  const original = text.split('\n');
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (at) => { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= at) lo = mid; else hi = mid - 1; } return lo + 1; };
  const fileAllow = allow.filter((e) => e.fileRe.test(file));
  const hits = [];
  let allowed = 0;
  const record = (at, token) => {
    const lineNo = lineOf(at);
    const lineText = original[lineNo - 1] || '';
    const hit = fileAllow.find((e) => (e.level === '*' || e.level === VOCABULARY_LEVEL) && e.re.test(token) && (!e.lineRe || e.lineRe.test(lineText)));
    if (hit) { hit.used += 1; allowed += 1; } else hits.push({ file, line: lineNo, token, at });
  };
  const placeholders = (body, at) => {
    for (const m of body.matchAll(ARTICLE_PLACEHOLDER)) {
      const name = m[1].toLowerCase();
      if (MANY_FORMS.has(name) || !ALL_FORMS.has(name)) record(at + m.index, m[0]); // {a spaces}, {a trip}: never filled
    }
  };
  // A template is skipped whole when it is handed to a log call or any piece of it is about module.json, and so is
  // everything inside its ${}.
  const skipTemplate = new Set();
  const parentOf = new Map();
  for (const piece of pieces) if (piece.template !== null) parentOf.set(piece.template, piece.inside);
  for (const piece of pieces) if (piece.template !== null && (LOG_CALL.test(piece.before) || piece.body.includes('module.json'))) skipTemplate.add(piece.template);
  const skippedWithin = (id) => { for (let t = id; t !== null && t !== undefined; t = parentOf.get(t)) if (skipTemplate.has(t)) return true; return false; };
  for (const piece of pieces) {
    if (skippedWithin(piece.template !== null ? piece.template : piece.inside)) continue;
    if (piece.template === null && (LOG_CALL.test(piece.before) || piece.body.includes('module.json'))) continue;
    for (const m of piece.body.matchAll(VOCABULARY_WORD)) if (readAsWord(piece, m)) record(piece.at + m.index, m[0]);
    placeholders(piece.body, piece.at);
  }
  // HTML: its text and the attributes a person reads (the words channel), outside the scripts' strings, read above.
  if (/\.html$/.test(file)) {
    const inString = new Uint8Array(text.length);
    for (const piece of pieces) inString.fill(1, piece.at, piece.at + piece.body.length);
    for (const m of parts.words.matchAll(VOCABULARY_WORD)) if (!inString[m.index]) record(m.index, m[0]);
    for (const m of parts.words.matchAll(ARTICLE_PLACEHOLDER)) if (!inString[m.index]) placeholders(m[0], m.index);
  }
  hits.sort((x, y) => x.at - y.at);
  const keys = [];
  parts.code.split('\n').forEach((line, n) => { for (const m of line.matchAll(WORD_KEY_USE)) keys.push({ line: n + 1, key: m[2] }); });
  return { hits, allowed, keys };
}

// A module's manifest: the text a person reads from it (server/modules.js's manifestTexts, the same fields the server
// fills), where every form is a word, never a key.
function manifestVocabularyHits(file, text, allow) {
  const { manifestTexts } = require('../server/modules.js');
  const fileAllow = allow.filter((e) => e.fileRe.test(file));
  const lines = text.split('\n');
  const hits = [];
  let allowed = 0;
  let manifest;
  try { manifest = JSON.parse(text); } catch (err) { return { hits: [{ file, line: 1, token: `not JSON (${err.message})` }], allowed, keys: [] }; }
  for (const [obj, key] of manifestTexts(manifest)) {
    const value = obj[key];
    const quoted = JSON.stringify(value).slice(1, -1);
    const lineNo = Math.max(1, lines.findIndex((l) => l.includes(quoted.slice(0, 60))) + 1);
    const record = (token) => {
      const hit = fileAllow.find((e) => (e.level === '*' || e.level === VOCABULARY_LEVEL) && e.re.test(token) && (!e.lineRe || e.lineRe.test(lines[lineNo - 1] || '')));
      if (hit) { hit.used += 1; allowed += 1; } else hits.push({ file, line: lineNo, token });
    };
    for (const m of value.matchAll(VOCABULARY_WORD)) record(m[0]);
    for (const m of value.matchAll(ARTICLE_PLACEHOLDER)) {
      const name = m[1].toLowerCase();
      if (MANY_FORMS.has(name) || !ALL_FORMS.has(name)) record(m[0]);
    }
  }
  return { hits, allowed, keys: [] };
}

function vocabularyReport(files, allow) {
  const inScope = files.filter((f) => VOCABULARY_SCOPE.some((d) => f.startsWith(d)) && (/\.(js|mjs|html)$/.test(f) || /^modules\/[^/]+\/module\.json$/.test(f)));
  const byFolder = new Map(VOCABULARY_SCOPE.map((d) => [d, { hits: [], allowed: 0 }]));
  const badKeys = [];
  for (const file of inScope) {
    const read = /module\.json$/.test(file) ? manifestVocabularyHits : vocabularyHits;
    const { hits, allowed, keys } = read(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), allow);
    const bucket = byFolder.get(VOCABULARY_SCOPE.find((d) => file.startsWith(d)));
    bucket.hits.push(...hits);
    bucket.allowed += allowed;
    for (const k of keys) if (!WORDS.KEYS.includes(k.key)) badKeys.push(`${file}:${k.line} names the word "${k.key}", which is not in the vocabulary (server/words.js: ${WORDS.KEYS.join(', ')})`);
  }
  console.log(`check-names: vocabulary, ${inScope.length} files`);
  for (const [dir, { hits, allowed }] of byFolder) {
    const enforced = VOCABULARY_ENFORCED.includes(dir);
    console.log(`  ${dir.padEnd(12)}${(enforced ? 'enforce' : 'report').padEnd(8)}${String(hits.length).padStart(6)} in ${String(new Set(hits.map((h) => h.file)).size).padStart(3)} files  (${allowed} allowed)`);
    if (listArg && (!listLevel || listLevel === VOCABULARY_LEVEL)) for (const h of hits) console.log(`      ${h.file}:${h.line}  ${h.token}`);
    if (enforced && hits.length) fail(`check-names: ${dir} has ${hits.length} level or role word${hits.length === 1 ? '' : 's'} typed into what a person reads; use word() (run with --words --list=${VOCABULARY_LEVEL})`);
  }
  for (const b of badKeys) fail(`check-names: ${b}`);
  for (const key of WORDS.KEYS) {
    const d = WORDS.DEFAULTS[key];
    if (!d || typeof d.one !== 'string' || !d.one || typeof d.many !== 'string' || !d.many) fail(`check-names: server/words.js: "${key}" has no default singular and plural`);
  }
}

// server/words.js itself, and the owner's words through a throwaway store.
function wordsCheck() {
  let n = 0;
  const test = (name, fn) => {
    try { fn(); n += 1; } catch (err) { fail(`check-names words: ${name}: ${err.message}`); }
  };
  const { Store } = require('../server/store.js');
  test('the vocabulary is the ten changeable keys and the two fixed ones, in the Names\' order', () => {
    assert.deepEqual(WORDS.KEYS, ['host', 'environment', 'space', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest']);
    assert.deepEqual(WORDS.FIXED, ['host', 'admin']);
    assert.equal(WORDS.CHANGEABLE.length, 10);
  });
  test('with nothing set, every key reads today\'s words, with the usual article', () => {
    const r = WORDS.resolve(null, null);
    assert.deepEqual(Object.keys(r), WORDS.KEYS);
    assert.deepEqual(r.space, { one: 'space', many: 'spaces', a: 'a space' });
    assert.deepEqual(r.aside, { one: 'aside', many: 'asides', a: 'an aside' });
    assert.deepEqual(r.canvas, { one: 'canvas', many: 'canvases', a: 'a canvas' });
    assert.equal(r.environment.a, 'an environment');
    assert.equal(r.owner.a, 'an owner');
    assert.equal(r.admin.a, 'an admin');
  });
  test('the owner\'s word, else the template\'s, else the default; host and admin always the default', () => {
    const r = WORDS.resolve({ space: { one: 'trip', many: 'trips' }, host: { one: 'boss', many: 'bosses' } }, { space: { one: 'journey', many: 'journeys' }, member: { one: 'traveller', many: 'travellers' }, admin: { one: 'chief', many: 'chiefs' } });
    assert.deepEqual(r.space, { one: 'trip', many: 'trips', a: 'a trip' });
    assert.deepEqual(r.member, { one: 'traveller', many: 'travellers', a: 'a traveller' });
    assert.equal(r.host.one, 'host');
    assert.equal(r.admin.one, 'admin');
    assert.equal(r.guest.one, 'guest');
    assert.equal(WORDS.resolve({ space: { one: '<b>', many: 'x' } }, null).space.one, 'space', 'a bad stored word reads the default');
    assert.equal(WORDS.resolve({ object: { one: 'hour', many: 'hours', a: 'an hour' } }, null).object.a, 'an hour');
  });
  test('format and fill give each form, with capitals from the helper', () => {
    const r = WORDS.resolve({ space: { one: 'trip', many: 'trips' }, aside: { one: 'huddle', many: 'huddles' } }, null);
    assert.equal(WORDS.format(r, 'space'), 'trip');
    assert.equal(WORDS.format(r, 'space', { many: true, cap: true }), 'Trips');
    assert.equal(WORDS.format(r, 'aside', { a: true }), 'a huddle');
    assert.equal(WORDS.format(r, 'aside', { a: true, cap: true }), 'A huddle');
    assert.throws(() => WORDS.format(r, 'room'), /no word called room/);
    assert.equal(WORDS.fill('{Spaces}: manage {a space}\'s {guest} link, {an aside}, {spaces} and {x}.', r), 'Trips: manage a trip\'s guest link, a huddle, trips and {x}.');
    assert.equal(WORDS.fill('In the {Space}; {A aside}', r), 'In the Trip; A huddle');
    assert.equal(WORDS.word('space', { many: true }), 'spaces', 'outside a request, the defaults');
  });
  test('a change is checked word by word, and host, admin, unknown keys and bad words are refused with a sentence', () => {
    const ok = WORDS.applyPatch({ member: { one: 'traveller', many: 'travellers' } }, { space: { one: '  trip ', many: 'trips', a: 'a trip' } });
    assert.deepEqual(ok, { words: { space: { one: 'trip', many: 'trips', a: 'a trip' }, member: { one: 'traveller', many: 'travellers' } } });
    assert.deepEqual(WORDS.applyPatch({ space: { one: 'trip', many: 'trips' } }, { space: null }), { words: {} });
    const refused = (patch) => WORDS.applyPatch({}, patch).error;
    assert.equal(refused({ host: { one: 'a', many: 'b' } }), "The host word is the host's own and can't be changed.");
    assert.equal(refused({ admin: null }), "The admin word is the host's own and can't be changed.");
    assert.match(refused({ room: { one: 'a', many: 'b' } }), /^There is no word called room; the words are environment, space, /);
    assert.equal(refused({ space: 'trip' }), 'The word for space must be its singular and plural, or null to use the default.');
    assert.equal(refused({ space: { one: 'trip' } }), 'The word for space needs both its singular and its plural.');
    assert.equal(refused({ space: { one: 'trip', many: 'trips', icon: 'x' } }), 'The word for space takes only one, many and a.');
    assert.equal(refused({ space: { one: 'x'.repeat(31), many: 'trips' } }), 'The word for space can be at most 30 characters.');
    for (const bad of ['<b>trip</b>', 'trip!', '1st', 'trip  -', '-trip', "trip's'", 'tr\u202eip', '\u2066trip\u2069', 'trip\u200f', 'tr\u061cip']) assert.equal(refused({ space: { one: bad, many: 'trips' } }), 'The word for space can use only letters, spaces, hyphens and apostrophes.', bad);
    assert.equal(refused({ space: { one: 'trip', many: 'trips', a: 'a journey' } }), 'The word for space with its article must be its singular with the article in front, such as "a trip".');
    assert.equal(refused([]), 'Words must be given by name, each with its singular and plural.');
    for (const good of ['base camp', 'Guild Hall', 'co-op', "people's hall", 'étape']) assert.ok(!refused({ space: { one: good, many: good } }), good);
  });
  test('the owner\'s words in a store: saved, cleared, and a refused word changes nothing, the other fields included', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-names-words-'));
    try {
      const store = new Store(dir);
      assert.equal('words' in store.settings, false, 'a new environment has no words of its own');
      assert.deepEqual(store.resolvedWords(), WORDS.resolve(null, null));
      store.updateSettings({ words: { space: { one: 'trip', many: 'trips', a: 'a trip' } } });
      assert.deepEqual(store.settings.words, { space: { one: 'trip', many: 'trips', a: 'a trip' } });
      const before = JSON.stringify(store.settings);
      for (const patch of [{ loginText: 'changed', words: { admin: { one: 'x', many: 'y' } } }, { words: { space: { one: '<i>', many: 'x' } }, environmentName: 'Changed' }]) {
        assert.throws(() => store.updateSettings(patch), (err) => err.status === 400);
        assert.equal(JSON.stringify(store.settings), before, JSON.stringify(patch));
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).settings.words.space.one, 'trip', 'kept on disk');
      store.updateSettings({ words: { space: null } });
      assert.equal('words' in store.settings, false, 'no words left: the key goes, as before any were set');
      store.templateWords = { space: { one: 'journey', many: 'journeys' } };
      assert.equal(store.resolvedWords().space.one, 'journey', 'the template\'s word, with the owner\'s cleared');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('the rule reads sentences and labels, not the helper, placeholders, log lines, module.json or names', () => {
    const text = [
      "res.status(404).json({ error: 'no such space' });",
      "res.status(404).json({ error: `no such ${word('space')}` });",
      "const label = 'Manage {a space}\\'s {guest} link in the {Space}';",
      "console.warn(`Module ${id} is not in this environment yet`);",
      "throw new ModuleError('module.json: scope must include environment or space');",
      "const k = 'spaceId'; const t = 'module-settings'; const u = '/api/spaces';",
      "tab.label = 'Spaces';",
      "const kind = 'guests';",
      "throw new StoreError('Owners only. Ask an owner.');",
      "const t = `${n} space${n === 1 ? '' : 's'}`; const u = `${n} ${word('space', { many: n !== 1 })}`;",
      "const id = `module-${key}`; const v = `${name}modules${x}`;",
    ].join('\n');
    const { hits, keys } = vocabularyHits('server/scratch.js', text, []);
    assert.deepEqual(hits.map((h) => `${h.line}:${h.token}`), ['1:space', '7:Spaces', '9:Owners', '9:owner', '10:space']);
    assert.deepEqual(keys.map((k) => k.key), ['space', 'space']);
    const html = '<p>Your <span data-word="space"></span> list</p><h2>Spaces</h2><button title="Add a guest">+</button>';
    const page = vocabularyHits('public/scratch.html', html, []);
    assert.deepEqual(page.hits.map((h) => h.token), ['Spaces', 'guest']);
    assert.deepEqual(page.keys.map((k) => k.key), ['space']);
  });
  test('the rule reads text however it is built: pieces, templates, capitals, punctuation, read attributes, placeholders', () => {
    const caught = [
      "const a = 'space: ' + name;",
      "const b = `space: ${n}`;",
      "const c = `${n} members`;",
      "const d = `Your ${n} spaces`;",
      "const e = `${name} space`;",
      "const f = 'Delete ' + 'space';",
      "const g = 'SPACES';",
      "const h = 'Space:';",
      "el.title = 'owner';",
      "el.setAttribute('aria-label', 'guest');",
      "const i = { label: 'member', key: 'member' };",
      "const j = fill('Make {a spaces} and {an trip}');",
      "console.log('fine'); res.json({ error: 'no such space' });",
      "const k = `space${n === 1 ? '' : 's'}`;",
      "const l = 'module' + ', ' + x;",
    ];
    const clean = [
      "const k = 'space'; if (scope === 'space') {}",
      "el.className = 'module-card'; const id = `module-${id}`; const u = '/api/spaces';",
      "const r = 'spaceId'; const ref = 'module:kind'; const t = `module:${kind}`;",
      "el.className = 'space active'; document.querySelector('.space .guest');",
      "const m = fill('Make {a space} or {an aside}, {Spaces}');",
      "console.log('no such space'); log(`the ${'owner'} space ${x}`);",
      "throw new Error(`module.json: scope must be \"space\" for ${key}, a ${'member'} space`);",
      "const v = `${name}modules${x}`; const w = `${word('space', { many: true })} ${n}`;",
    ];
    const got = vocabularyHits('server/scratch.js', [...caught, ...clean].join('\n'), []).hits.map((h) => `${h.line}:${h.token}`);
    assert.deepEqual(got, ['1:space', '2:space', '3:members', '4:spaces', '5:space', '6:space', '7:SPACES', '8:Space', '9:owner', '10:guest', '11:member', '12:{a spaces}', '12:{an trip}', '13:space', '14:space', '15:module']);
    const html = '<p>Spaces</p><b title="owner">x</b><script>const t = \'no such space\';</script><p data-fill>{a guests}</p>';
    assert.deepEqual(vocabularyHits('public/scratch.html', html, []).hits.map((h) => h.token), ['Spaces', 'owner', 'space', '{a guests}']);
  });
  test('a manifest\'s text a person reads: every form is a word; keys, ids, scopes and placeholders are not', () => {
    const manifest = JSON.stringify({
      id: 'demo', name: 'Space Demo', scope: ['space'], description: 'Notes for each space, shared with every {member}.',
      permissions: [{ key: 'space_edit', label: 'Edit the notes in {a space}' }, { key: 'x', label: 'Invite guests' }],
      settings: [{ key: 'spaceNote', label: 'Note', help: 'Shown to the moderator.', options: [{ value: 'module', label: 'Per {module}', help: 'One per {a modules}' }] }],
      surfaces: { widget: { title: 'Your spaces' } },
      events: { publishes: [{ name: 'space-done', label: 'A {space} finished' }] },
      refs: { produces: [{ kind: 'note', name: 'Object' }] },
    }, null, 2);
    assert.deepEqual(manifestVocabularyHits('modules/demo/module.json', manifest, []).hits.map((h) => h.token), ['space', 'spaces', 'guests', 'moderator', '{a modules}', 'Object']);
  });
  console.log(`check-names: words, ${n} groups OK`);
}

// --- the scanner and the allow-list, on text made up for the check ------------------------------------------------
function scannerCheck() {
  let n = 0;
  const test = (name, fn) => {
    try { fn(); n += 1; } catch (err) { fail(`check-names scanner: ${name}: ${err.message}`); }
  };
  const hitsOf = (file, text, mode, entries) => {
    const results = scanText(file, text, mode, entries, emptyResults());
    return Object.fromEntries([...results].map(([id, r]) => [id, r.hits.map((h) => `${h.line}:${h.token}`)]));
  };
  const { entries: realAllow, problems } = validateAllow(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'check-names-allow.json'), 'utf8')));

  test('"tenant" in a sentence a person reads is an environment hit; a config name or code is not a word hit', () => {
    const text = "say('This tenant is full.');\nthrow new Error('no such tenants here');\nconsole.warn('MIGRATE_TENANT_SLUG is now MIGRATE_ENVIRONMENT_SLUG; the old name goes.');\nconst tenantId = 1;\n";
    assert.deepEqual(hitsOf('server/scratch.js', text, 'words', []).environment, ['1:tenant', '2:tenants']);
  });

  test('an allow entry covers only its own level and its own match; the rest of the line still counts', () => {
    assert.deepEqual(problems, []);
    const text = "el.innerHTML = '<table>'; roomList.push(tenantId);\nicon.className = 'fa-table'; stagePane(roomId);\n";
    const hits = hitsOf('public/scratch.js', text, 'code', realAllow.map((e) => ({ ...e, used: 0 })));
    assert.deepEqual(hits.table, [], 'the HTML table and the icon are allowed');
    assert.deepEqual(hits.environment, ['1:tenantId']);
    assert.deepEqual(hits.space, ['1:roomList.push', '2:roomId']);
    assert.deepEqual(hits.canvas, ['2:stagePane']);
    assert.deepEqual(hits.module, ['2:stagePane']);
  });

  test('a "**" entry that would allow anything, one without a reason, and one without a known level all fail', () => {
    const bad = [
      { file: '**', level: '*', pattern: '^Room$', reason: 'x' },
      { file: '**', level: 'space', pattern: '.', reason: 'x' },
      { file: 'server/index.js', level: 'space', pattern: 'x', reason: '  ' },
      { file: 'server/index.js', level: 'rooms', pattern: 'x', reason: 'x' },
    ];
    const { problems: found } = validateAllow(bad);
    assert.equal(found.length, 4, found.join('\n'));
    assert.match(found[0], /allows anything anywhere/);
    assert.match(found[1], /allows anything anywhere/);
    assert.match(found[2], /has no reason/);
    assert.match(found[3], /level must be one of/);
    assert.deepEqual(validateAllow([{ file: 'tools/fixtures/names-v1/**', level: '*', pattern: '.', reason: 'a folder, named' }]).problems, []);
    assert.deepEqual(validateAllow([{ file: 'server/index.js', level: '*', pattern: '.', reason: 'one exact file' }]).problems, []);
    for (const glob of [{ file: 'server/**', level: '*', pattern: '.' }, { file: 'server/*.js', level: '*', pattern: '^x$' }, { file: 'public/**', level: 'space', pattern: '.' }]) {
      const { problems: p } = validateAllow([{ ...glob, reason: 'x' }]);
      assert.equal(p.length, 1, `${glob.file} ${glob.level} ${glob.pattern}`);
      assert.match(p[0], /allows anything anywhere/);
    }
  });

  test('an entry no hit uses keeps a count of 0, so the run lists it', () => {
    const { entries } = validateAllow([{ file: '**', level: 'space', pattern: '^neverUsedRoomName$', reason: 'x' }]);
    hitsOf('public/scratch.js', 'const roomId = 1;\n', 'code', entries);
    assert.equal(entries[0].used, 0);
  });

  test('class lists and selectors are read as code, sentences as words', () => {
    const text = [
      "panel.className = `module-panel native-panel ${def.id}-panel`;",
      "pane.el.querySelector('.chat-tools, .pane-tools');",
      "const sel = '.module-panel, .module-docked, .module';",
      "card.className = 'panel module-card';",
      "x.classList.add('stage-empty', 'is on');",
      "throw new Error('not at the table in this room');",
      "return res.status(400).json({ error: 'not in a pull-aside room' });",
      "throw new StoreError('module-panel room missing');",
    ].join('\n');
    const code = hitsOf('public/scratch.js', text, 'code', []);
    assert.deepEqual(code.module, ['1:panel.className', '1:module-panel', '1:native-panel', '1:panel', '2:pane.el.querySelector', '2:pane-tools', '3:module-panel', '4:panel']);
    assert.deepEqual(code.canvas, ['5:stage-empty']);
    assert.deepEqual(code.space, [], 'a sentence is not code, even shaped like a class list in an error');
    const words = hitsOf('public/scratch.js', text, 'words', []);
    assert.deepEqual(words.space, ['6:room', '7:room', '8:room']);
    assert.deepEqual(words.table, ['6:table']);
  });

  test("the AI's items are objects; a menu's items are not", () => {
    const text = "host.ai.ask({ task: 'ask', items: refs });\nhost.menu.show({ items: [] });\nconst list = req.body?.items;\n";
    assert.deepEqual(hitsOf('public/scratch.js', text, 'code', []).object.length, 2);
  });

  test('the old drag and open messages, the drag type and the AI marker are object hits in code', () => {
    const text = "call('refsDrag', {});\npost({ type: 'refOpen' });\nconst T = 'application/x-host-ref';\nconst m = '{{card:0}}';\ncall('objectsDrag', {});\n";
    assert.deepEqual(hitsOf('public/scratch.js', text, 'code', []).object, ['1:refsDrag', '2:refOpen', '3:application/x-host-ref', '4:{{card:0']);
  });

  test('"item" and "card" for an object in what a person reads, a manifest label too; not a class, a property or a tool\'s message', () => {
    const page = "toast('That item is gone.');\nel.innerHTML = `<button class=\"item today\">Open</button>`;\nstyle = 'align-items: center; background: var(--bg-card)';\nthrow new Error('no such card here');\n";
    // A class list inside a module's markup reads as text to the scanner; the allow-list's `class="item` entry covers it.
    assert.deepEqual(hitsOf('modules/demo/src/demo.js', page, 'words', realAllow.map((e) => ({ ...e, used: 0 }))).object, ['1:item', '4:card']);
    const manifest = '{\n  "permissions": [{ "key": "edit", "label": "Change the cards" }],\n  "actions": { "provides": [{ "name": "a", "label": "Link this item to it" }] }\n}\n';
    assert.deepEqual(hitsOf('modules/demo/module.json', manifest, 'words', []).object, ['2:cards', '3:item']);
    assert.deepEqual(hitsOf('tools/check-demo.mjs', "assert.ok(x, 'the item is kept');\n", 'words', []).object, [], 'a tool\'s own message is not read by anyone');
  });
  console.log(`check-names: scanner, ${n} groups OK`);
}

// --- call names (plan-names decision 14) ------------------------------------------------------------------------
function callNamesCheck() {
  const { callName, spaceIdOfCall } = require('../server/call-names.js');
  let n = 0;
  const test = (name, fn) => {
    try { fn(); n += 1; } catch (err) { fail(`check-names call names: ${name}: ${err.message}`); }
  };
  const known = new Set(['lobby', 'keep01', 'aside22']);
  const hasSpace = (id) => known.has(id);
  test('a space\'s call is its id, an aside\'s is aside-<id>; hosted, <slug>.<id>; nothing named table', () => {
    assert.equal(callName({ spaceId: 'lobby' }), 'lobby');
    assert.equal(callName({}), 'lobby', 'no space: the Lobby');
    assert.equal(callName({ spaceId: 'keep01' }), 'keep01');
    assert.equal(callName({ spaceId: 'aside22', aside: true }), 'aside-aside22');
    assert.equal(callName({ slug: 'acme', spaceId: 'lobby' }), 'acme.lobby');
    assert.equal(callName({ slug: 'acme', spaceId: 'keep01' }), 'acme.keep01');
    assert.equal(callName({ slug: 'acme-co', spaceId: 'aside22', aside: true }), 'acme-co.aside-aside22');
  });
  test('no slug and no space or aside id can hold the dot', () => {
    const { SEPARATOR } = require('../server/call-names.js');
    assert.equal(SEPARATOR, '.');
    const { HostRegistry: Registry } = require('../server/host-registry.js');
    const { Store } = require('../server/store.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-names-slug-'));
    try {
      const registry = new Registry(dir);
      assert.throws(() => registry.addEnvironment({ slug: 'acme.co', name: 'x' }), /letters, digits and hyphens/);
      fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ environments: [{ slug: 'acme.co', name: 'x' }, { slug: 'fine', name: 'y' }] }));
      assert.deepEqual(new Registry(dir).listEnvironments().map((e) => e.slug), ['fine'], 'a dotted slug in host.json is dropped on load');
      const store = new Store(path.join(dir, 'env'));
      assert.equal(store.sanitizeSpace({ id: 'ke.ep', name: 'x' }), null, 'a dotted space id is dropped');
      for (let i = 0; i < 20; i += 1) assert.match(store.addAside([], null).id, /^[a-z0-9]{4,16}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('each new name reads back to its space, on a single install and hosted', () => {
    for (const slug of [null, 'acme', 'acme-co', 'acme-aside', 'acme-table']) {
      for (const [spaceId, aside] of [['lobby', false], ['keep01', false], ['aside22', true]]) {
        assert.equal(spaceIdOfCall(callName({ slug, spaceId, aside }), { slug, hasSpace }), spaceId, `${slug} ${spaceId}`);
      }
    }
  });
  test('another environment\'s new names are never ours, whatever its slug starts with', () => {
    const slugs = () => ['acme', 'acme-aside', 'acme-table', 'acme-co', 'bravo'];
    for (const name of ['acme-aside.lobby', 'acme-aside.keep01', 'acme-table.lobby', 'acme-table.aside-aside22', 'acme-co.keep01', 'bravo.lobby', 'bravo.keep01']) {
      assert.equal(spaceIdOfCall(name, { slug: 'acme', hasSpace, slugs }), null, name);
    }
    assert.equal(spaceIdOfCall('acme.lobby', { slug: 'acme-aside', hasSpace, slugs }), null);
    assert.equal(spaceIdOfCall('acme.lobby', { hasSpace }), null, 'a single install never claims a hosted name');
    assert.equal(spaceIdOfCall('keep01', { slug: 'acme', hasSpace, slugs }), null, 'hosted: a bare name is not ours');
    assert.equal(spaceIdOfCall('acme.gone99', { slug: 'acme', hasSpace }), null, 'a space this environment does not have');
    assert.equal(spaceIdOfCall('acme.aside-', { slug: 'acme', hasSpace }), null);
    assert.equal(spaceIdOfCall('acme.lobby.x', { slug: 'acme', hasSpace: () => true }), null, 'never a second dot');
    assert.equal(spaceIdOfCall(undefined, { hasSpace }), null);
  });
  test('for one release, the old shapes read back, and only them', () => {
    const slugs = () => ['acme', 'acme-aside', 'acme-table', 'bravo'];
    assert.equal(spaceIdOfCall('table', { hasSpace }), 'lobby');
    assert.equal(spaceIdOfCall('table-keep01', { hasSpace }), 'keep01');
    assert.equal(spaceIdOfCall('table-aside22', { hasSpace }), 'aside22');
    assert.equal(spaceIdOfCall('table-lobby', { hasSpace }), null, 'the Lobby\'s old call was always the base itself');
    assert.equal(spaceIdOfCall('table-gone99', { hasSpace }), null);
    assert.equal(spaceIdOfCall('acme-table', { slug: 'acme', hasSpace, slugs }), 'lobby');
    assert.equal(spaceIdOfCall('acme-table-keep01', { slug: 'acme', hasSpace, slugs }), 'keep01');
    assert.equal(spaceIdOfCall('acme-table-lobby', { slug: 'acme', hasSpace, slugs }), null, 'QA\'s case: never the Lobby by -table-lobby');
    assert.equal(spaceIdOfCall('acme-table-table', { slug: 'acme', hasSpace: () => true, slugs }), null, 'environment acme-table\'s old Lobby: its slug is the longer match');
    assert.equal(spaceIdOfCall('acme-table-table-keep01', { slug: 'acme', hasSpace, slugs }), null, 'environment acme-table\'s old keep01');
    assert.equal(spaceIdOfCall('acme-table-table-keep01', { slug: 'acme-table', hasSpace, slugs }), 'keep01', 'and it is acme-table\'s');
    // The tie-break, written down: acme has a space whose id is table and acme-table is registered. acme-table-table
    // reads as acme's old table-<id> shape and as acme-table's old Lobby; the longer slug wins, so it is acme-table's.
    const withTable = (id) => id === 'table' || known.has(id);
    assert.equal(spaceIdOfCall('acme-table-table', { slug: 'acme', hasSpace: withTable, slugs }), null, 'not acme\'s space table');
    assert.equal(spaceIdOfCall('acme-table-table', { slug: 'acme-table', hasSpace, slugs }), 'lobby', 'acme-table\'s old Lobby');
    assert.equal(spaceIdOfCall('acme.table', { slug: 'acme', hasSpace: withTable, slugs }), 'table', 'acme\'s space table has its own new name');
    assert.equal(spaceIdOfCall('acme-aside-table', { slug: 'acme', hasSpace, slugs }), null, 'environment acme-aside\'s old Lobby');
    assert.equal(spaceIdOfCall('acme-aside-table', { slug: 'acme-aside', hasSpace, slugs }), 'lobby');
    assert.equal(spaceIdOfCall('bravo-table', { slug: 'acme', hasSpace, slugs }), null);
    assert.equal(spaceIdOfCall('table', { slug: 'acme', hasSpace, slugs }), null, 'hosted: an unprefixed old name is not ours');
    assert.equal(spaceIdOfCall('acme-table-keep01', { hasSpace }), null, 'a single install never reads a hosted old name');
  });
  test('an id this environment has comes before an old shape: a space whose id is table is that space', () => {
    const withTable = (id) => id === 'table' || known.has(id);
    assert.equal(spaceIdOfCall('table', { hasSpace: withTable }), 'table');
    assert.equal(spaceIdOfCall('acme.table', { slug: 'acme', hasSpace: withTable }), 'table');
    assert.equal(callName({ spaceId: 'table' }), 'table');
    assert.equal(spaceIdOfCall('acme-table', { slug: 'acme', hasSpace: withTable }), 'lobby', 'the old hosted Lobby is still the Lobby: the new name for space table is acme.table');
  });
  console.log(`check-names: call names, ${n} groups OK`);
}

// --- the migration ---------------------------------------------------------------------------------------------
function snapshot(dir, skip = () => false) {
  const out = {};
  const visit = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip(child)) continue;
      if (entry.isDirectory()) visit(child);
      else out[child] = fs.readFileSync(path.join(dir, child), 'utf8');
    }
  };
  visit('');
  return out;
}

function migrationCheck() {
  const names = require('../server/migrate-names.js');
  const { Store } = require('../server/store.js');
  const { HostRegistry } = require('../server/host-registry.js');
  const fixture = path.join(ROOT, 'tools', 'fixtures', 'names-v1');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-names-'));
  const quiet = () => {};
  let n = 0;
  const test = (name, fn) => {
    try { fn(); n += 1; } catch (err) { fail(`check-names --migration: ${name}: ${err.message}`); }
  };
  let copies = 0;
  // The fixture's root is an old-format environment; host/ beside it is an old-format hosted DATA_DIR.
  const HOST_FIXTURE = 'host';
  const notHost = (rel) => rel === HOST_FIXTURE || rel.startsWith(`${HOST_FIXTURE}/`);
  const copyFixture = () => {
    const dir = path.join(base, `env-${copies += 1}`);
    fs.cpSync(fixture, dir, { recursive: true, filter: (src) => !notHost(path.relative(fixture, src).split(path.sep).join('/')) });
    return dir;
  };
  const copyHostFixture = () => {
    const dir = path.join(base, `host-${copies += 1}`);
    fs.cpSync(path.join(fixture, HOST_FIXTURE), dir, { recursive: true });
    return dir;
  };
  const original = snapshot(fixture, notHost);
  const originalHost = snapshot(path.join(fixture, HOST_FIXTURE));
  // Runs fn with fs.renameSync failing (EACCES) for the renames `fails(from, to)` picks.
  const withFailingRename = (fails, fn) => {
    const real = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (fails(String(from), String(to))) throw Object.assign(new Error(`EACCES: permission denied, rename '${from}' -> '${to}'`), { code: 'EACCES' });
      return real(from, to);
    };
    try { return fn(); } finally { fs.renameSync = real; }
  };
  const MODULE_FILE = 'modules/todo/data/room-keep01.json';

  try {
    test('the fixture is an old-format directory at version 1', () => {
      assert.equal(JSON.parse(original['app.json']).version, 1);
      assert.equal(JSON.parse(original['app.json']).migrations, undefined);
      assert.ok(original[MODULE_FILE], 'the fixture has a module data file');
    });

    test('this server\'s own parts, run twice: every part recorded once and nothing else changed', () => {
      const dir = copyFixture();
      const first = names.migrateEnvironment(dir, { log: quiet });
      const afterFirst = snapshot(dir);
      const second = names.migrateEnvironment(dir, { log: quiet });
      assert.deepEqual(second, [], 'the second run runs nothing');
      assert.deepEqual(snapshot(dir), afterFirst, 'the second run changes nothing');
      const record = JSON.parse(afterFirst['app.json']);
      assert.deepEqual(names.recordedParts(record), names.ENVIRONMENT_PARTS.map((p) => p.id), 'every part recorded, in order');
      assert.deepEqual(first, names.ENVIRONMENT_PARTS.map((p) => p.id));
      if (!names.ENVIRONMENT_PARTS.length) {
        // No parts yet (step 1): the directory is exactly the fixture, with no version change, no record and no copy.
        assert.deepEqual(afterFirst, original);
      } else {
        assert.equal(record.version, names.NAMES_VERSION);
        for (const id of first) assert.ok(fs.existsSync(path.join(dir, names.ENVIRONMENT_COPY_DIR, id, 'app.json')), `pre-names/${id}/app.json`);
      }
    });

    // The frame itself, driven by a part made up for this check (the real parts arrive with the plan's later
    // steps): it rewrites the module data file and moves one folder.
    const framePart = {
      id: 'names-frame-check',
      files: () => [MODULE_FILE],
      run(ctx) {
        const data = ctx.read(MODULE_FILE);
        if (!data.checked) ctx.write(MODULE_FILE, { ...data, checked: true });
        ctx.move('frame-check-from', 'frame-check-to');
      },
    };

    test('a part runs once: version 2, one record, the originals in pre-names/<part>/, a second run changes nothing', () => {
      const dir = copyFixture();
      fs.mkdirSync(path.join(dir, 'frame-check-from'));
      fs.writeFileSync(path.join(dir, 'frame-check-from', 'a.txt'), 'a');
      assert.deepEqual(names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), ['names-frame-check']);
      const afterFirst = snapshot(dir);
      const record = JSON.parse(afterFirst['app.json']);
      assert.equal(record.version, 2);
      assert.equal(record.migrations.length, 1);
      assert.equal(record.migrations[0].id, 'names-frame-check');
      assert.ok(!Number.isNaN(Date.parse(record.migrations[0].at)));
      assert.deepEqual(record.migrations[0].moved, [{ from: 'frame-check-from', to: 'frame-check-to' }]);
      assert.equal(JSON.parse(afterFirst[MODULE_FILE]).checked, true);
      assert.equal(afterFirst['frame-check-to/a.txt'], 'a');
      assert.equal(afterFirst['pre-names/names-frame-check/app.json'], original['app.json'], 'app.json copied before it was written');
      assert.equal(afterFirst[`pre-names/names-frame-check/${MODULE_FILE}`], original[MODULE_FILE], 'the module file copied before it was written');
      const { version, migrations, ...rest } = record;
      const { version: v1, ...originalRest } = JSON.parse(original['app.json']);
      assert.deepEqual(rest, originalRest, 'nothing else in app.json changed');

      assert.deepEqual(names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), [], 'a recorded part never runs again');
      assert.deepEqual(snapshot(dir), afterFirst, 'the second run changes nothing, and pre-names/ is made once');
    });

    test('Store keeps the version and the record through its own load and save', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { parts: [framePart], log: quiet });
      const store = new Store(dir);
      store.save();
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
      assert.equal(record.version, 2);
      assert.deepEqual(names.recordedParts(record), ['names-frame-check']);
      const plain = copyFixture();
      new Store(plain).save();
      const untouched = JSON.parse(fs.readFileSync(path.join(plain, 'app.json'), 'utf8'));
      assert.equal(untouched.version, 1, 'a directory the migration has not touched stays at version 1');
      assert.equal('migrations' in untouched, false, 'and gains no record');
    });

    test('a part that fails stops with the file named, and the originals are untouched', () => {
      const dir = copyFixture();
      const broken = {
        id: 'names-frame-check',
        files: () => [MODULE_FILE],
        run(ctx) {
          ctx.write(MODULE_FILE, { half: 'done' });
          throw Object.assign(new Error('this value is not a shape the part knows'), { file: path.join(dir, MODULE_FILE) });
        },
      };
      assert.throws(() => names.migrateEnvironment(dir, { parts: [broken], log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, MODULE_FILE) && err.message.includes(MODULE_FILE));
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names')), original, 'nothing outside pre-names/ changed, and nothing is recorded');
      // The next start, with the part fixed, keeps the copy of the true originals.
      names.migrateEnvironment(dir, { parts: [framePart], log: quiet });
      assert.equal(fs.readFileSync(path.join(dir, 'pre-names/names-frame-check', MODULE_FILE), 'utf8'), original[MODULE_FILE]);
    });

    test('an unreadable app.json is refused whether or not a part is due, naming the file, with nothing changed', () => {
      const dir = copyFixture();
      fs.writeFileSync(path.join(dir, 'app.json'), '{ not json');
      const unreadable = (err) => err instanceof names.MigrationError && err.reason === 'unreadable' && err.file === path.join(dir, 'app.json')
        && err.message.endsWith('Fix or restore this file, then start again.');
      assert.throws(() => names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), unreadable, 'a part due');
      assert.throws(() => names.migrateEnvironment(dir, { parts: [], log: quiet }), unreadable, 'no part due');
      assert.equal(names.refusalSentence(new names.MigrationError('x', 'y', 'unreadable')), names.REFUSED_UNREADABLE);
      assert.equal(names.REFUSED_UNREADABLE, "This environment's data could not be read. The host admin has been told.");
      assert.deepEqual(snapshot(dir), { ...original, 'app.json': '{ not json' }, 'nothing written, no copy made');
      for (const text of ['', 'null x', '\u0000']) {
        fs.writeFileSync(path.join(dir, 'app.json'), text);
        assert.throws(() => names.migrateEnvironment(dir, { log: quiet }), unreadable, JSON.stringify(text));
      }
      // Valid JSON that is not an object is no environment's data: refused the same way, never reset (decision 23).
      for (const [text, what] of [['[]', 'a list'], ['null', 'null'], ['42', 'a number'], ['"x"', 'a string'], ['true', 'a boolean']]) {
        const shaped = copyFixture();
        fs.writeFileSync(path.join(shaped, 'app.json'), text);
        const notData = (err) => err instanceof names.MigrationError && err.reason === 'unreadable' && err.file === path.join(shaped, 'app.json')
          && err.message === `${path.join(shaped, 'app.json')} is not an environment's data (it holds ${what}, not an object), so this environment will not be opened: nothing was changed. Fix or restore this file, then start again.`;
        assert.throws(() => names.migrateEnvironment(shaped, { log: quiet }), notData, text);
        assert.throws(() => names.migrateEnvironment(shaped, { parts: [], log: quiet }), notData, `${text}, no part due`);
        assert.throws(() => new Store(shaped), /is not an environment's data .*Fix or restore this file, then start again\./, `${text}: Store too`);
        assert.equal(fs.readFileSync(path.join(shaped, 'app.json'), 'utf8'), text, `${text}: untouched`);
        assert.ok(!fs.existsSync(path.join(shaped, 'pre-names')), `${text}: no copy, nothing recorded`);
        const legacyShaped = copyFixture();
        fs.rmSync(path.join(legacyShaped, 'app.json'));
        fs.writeFileSync(path.join(legacyShaped, 'tavern.json'), text);
        assert.throws(() => names.migrateEnvironment(legacyShaped, { log: quiet }), (err) => err.reason === 'unreadable' && err.file === path.join(legacyShaped, 'tavern.json'), `tavern.json ${text}`);
        assert.equal(fs.readFileSync(path.join(legacyShaped, 'tavern.json'), 'utf8'), text);
      }
      const legacy = copyFixture();
      fs.rmSync(path.join(legacy, 'app.json'));
      fs.writeFileSync(path.join(legacy, 'tavern.json'), '{ not json');
      assert.throws(() => names.migrateEnvironment(legacy, { log: quiet }), (err) => err.reason === 'unreadable' && err.file === path.join(legacy, 'tavern.json'), 'the older tavern.json, while app.json is missing');
      assert.throws(() => new Store(dir), /is not valid JSON .*Fix or restore this file, then start again\./, 'Store refuses it too, and never writes over it');
      assert.equal(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'), '\u0000');
      const fresh = path.join(base, 'fresh-unreadable-check');
      assert.deepEqual(names.migrateEnvironment(fresh, { log: quiet }), names.ENVIRONMENT_PARTS.map((p) => p.id), 'a missing app.json is a new environment');
      assert.ok(new Store(fresh).spaces.length > 0);
    });

    test('a new directory records its parts as run, moving nothing', () => {
      const dir = path.join(base, 'fresh');
      assert.deepEqual(names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), ['names-frame-check']);
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
      assert.equal(record.version, 2);
      assert.deepEqual(record.migrations.map((m) => [m.id, m.moved]), [['names-frame-check', []]]);
      assert.equal(fs.existsSync(path.join(dir, 'pre-names')), false);
      const store = new Store(dir);
      assert.equal(store.spaces.length > 0, true, 'Store still builds a whole app.json around the record');
      assert.deepEqual(names.recordedParts(JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'))), ['names-frame-check']);
      const empty = path.join(base, 'fresh-no-parts');
      assert.deepEqual(names.migrateEnvironment(empty, { log: quiet }), names.ENVIRONMENT_PARTS.map((p) => p.id));
      assert.equal(fs.existsSync(empty), names.ENVIRONMENT_PARTS.length > 0, 'with no parts, a new directory is not touched at all');
    });

    test('the host: recorded in host.json once, the copy in pre-names-host/, and HostRegistry keeps the record', () => {
      const dir = path.join(base, 'host');
      fs.mkdirSync(dir);
      new HostRegistry(dir).addEnvironment({ slug: 'acme', name: 'Acme' });
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), names.HOST_PARTS.map((p) => p.id));
      const before = snapshot(dir);
      const hostPart = { id: 'names-frame-check', files: () => [], run() {} };
      const parts = [...names.HOST_PARTS, hostPart];
      assert.deepEqual(names.migrateHost(dir, { parts, log: quiet }), ['names-frame-check']);
      const afterFirst = snapshot(dir);
      assert.equal(afterFirst['pre-names-host/names-frame-check/host.json'], before['host.json']);
      assert.equal('version' in JSON.parse(afterFirst['host.json']), false, 'host.json has no version');
      assert.deepEqual(names.migrateHost(dir, { parts, log: quiet }), []);
      assert.deepEqual(snapshot(dir), afterFirst);
      const registry = new HostRegistry(dir);
      assert.deepEqual(names.recordedParts(JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8'))), [...names.HOST_PARTS.map((p) => p.id), 'names-frame-check']);
      assert.equal(registry.listEnvironments().length, 1);
    });

    // --- names-environment, the host's part (plan-names step 2) ---
    const hostJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8'));
    const oldHost = JSON.parse(originalHost['host.json']);
    const noteOf = (dir) => path.join(dir, names.HOST_COPY_DIR, 'names-environment.moved.json');
    const BOTH_MOVES = [{ from: 'tenants', to: 'environments' }, { from: 'tenants-deleted', to: 'environments-deleted' }];

    test('names-environment is the host\'s first part', () => {
      assert.deepEqual(names.HOST_PARTS.map((p) => p.id), ['names-environment']);
    });

    test('names-environment on an old-format host: the folders move, host.json\'s key is renamed in place, recorded once, the copy kept', () => {
      const dir = copyHostFixture();
      assert.ok(originalHost['tenants/acme/app.json'] && originalHost['tenants-deleted/gone-1767225600000/app.json'] && Array.isArray(oldHost.tenants), 'the fixture is an old-format host');
      const logged = [];
      assert.deepEqual(names.migrateHost(dir, { log: (m) => logged.push(m) }), ['names-environment']);
      const after = snapshot(dir);
      assert.equal(after['environments/acme/app.json'], originalHost['tenants/acme/app.json']);
      assert.equal(after['environments/acme/modules/todo/data/room-lobby.json'], originalHost['tenants/acme/modules/todo/data/room-lobby.json']);
      assert.equal(after['environments-deleted/gone-1767225600000/app.json'], originalHost['tenants-deleted/gone-1767225600000/app.json']);
      assert.ok(!fs.existsSync(path.join(dir, 'tenants')) && !fs.existsSync(path.join(dir, 'tenants-deleted')), 'the old folders are gone');
      const host = hostJson(dir);
      assert.deepEqual(Object.keys(host), [...Object.keys(oldHost).map((k) => (k === 'tenants' ? 'environments' : k)), 'migrations'], 'the key renamed where it was, the record last');
      assert.deepEqual(host.environments, oldHost.tenants, 'every environment kept as it was');
      const { environments, migrations, ...rest } = host;
      const { tenants, ...oldRest } = oldHost;
      assert.deepEqual(rest, oldRest, 'nothing else in host.json changed');
      assert.equal(migrations.length, 1);
      assert.equal(migrations[0].id, 'names-environment');
      assert.deepEqual(migrations[0].moved, BOTH_MOVES);
      assert.equal(after['pre-names-host/names-environment/host.json'], originalHost['host.json'], 'the original host.json copied first');
      assert.ok(!fs.existsSync(noteOf(dir)), 'no note left once recorded');
      assert.ok(!Object.keys(after).some((rel) => rel.endsWith('.names-tmp')), 'no staged file left');
      assert.equal(logged.length, 1, 'one line in the log');
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), after, 'and changes nothing');
      const registry = new HostRegistry(dir);
      assert.deepEqual(registry.listEnvironments().map((e) => e.slug), ['acme', 'bravo']);
      assert.deepEqual(names.recordedParts(hostJson(dir)), ['names-environment'], 'HostRegistry keeps the record through its save');
      assert.equal('tenants' in hostJson(dir), false);
    });

    test('names-environment on a new host: nothing to move, recorded as run, no copy', () => {
      const dir = path.join(base, 'host-fresh');
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment']);
      assert.deepEqual(hostJson(dir).migrations.map((m) => [m.id, m.moved]), [['names-environment', []]]);
      assert.equal(fs.existsSync(path.join(dir, names.HOST_COPY_DIR)), false);
      const registry = new HostRegistry(dir);
      registry.addEnvironment({ slug: 'acme', name: 'Acme' });
      assert.deepEqual(names.recordedParts(hostJson(dir)), ['names-environment']);
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), []);
    });

    test('names-environment on a host already in the new shape: recorded, nothing else changed', () => {
      const dir = path.join(base, 'host-by-hand');
      fs.mkdirSync(path.join(dir, 'environments', 'acme'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'environments', 'acme', 'app.json'), '{}');
      const registry = new HostRegistry(dir);
      registry.addEnvironment({ slug: 'acme', name: 'Acme' });
      const before = hostJson(dir);
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment']);
      const { migrations, ...rest } = hostJson(dir);
      assert.deepEqual(rest, before);
      assert.deepEqual(migrations.map((m) => [m.id, m.moved]), [['names-environment', []]]);
      assert.equal(fs.readFileSync(path.join(dir, 'environments', 'acme', 'app.json'), 'utf8'), '{}');
    });

    test('names-environment before the pre-environment move: a single install\'s data dir gains only host.json\'s record', () => {
      const dir = copyFixture();
      const before = snapshot(dir);
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment']);
      const after = snapshot(dir);
      assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), 'host.json'].sort(), 'only host.json is new');
      for (const rel of Object.keys(before)) assert.equal(after[rel], before[rel], `${rel} untouched`);
      assert.deepEqual(names.recordedParts(hostJson(dir)), ['names-environment']);
    });

    test('names-environment: a host.json recording a part this server does not know is still refused, and nothing moves', () => {
      const dir = copyHostFixture();
      fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ ...oldHost, migrations: [{ id: 'names-environment', at: '', moved: [] }, { id: 'names-from-the-future', at: '', moved: [] }] }));
      const before = snapshot(dir);
      assert.throws(() => names.migrateHost(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.reason === 'newer' && err.file === path.join(dir, 'host.json') && err.message.includes('names-from-the-future'));
      assert.deepEqual(snapshot(dir), before);
    });

    test('names-environment: an environments/ folder already beside tenants/ stops the part, naming it, with nothing changed', () => {
      const dir = copyHostFixture();
      fs.mkdirSync(path.join(dir, 'environments'));
      const before = snapshot(dir);
      assert.throws(() => names.migrateHost(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.reason === 'failed' && err.file === path.join(dir, 'environments'));
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith(names.HOST_COPY_DIR)), before, 'every live file where it was, nothing recorded');
      assert.ok(fs.existsSync(path.join(dir, 'tenants', 'acme', 'app.json')));
    });

    test('names-environment: host.json listing different environments under both keys stops the part, naming host.json', () => {
      const dir = copyHostFixture();
      fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ ...oldHost, environments: [{ slug: 'other', name: 'Other' }] }));
      const before = snapshot(dir);
      assert.throws(() => names.migrateHost(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'host.json')
        && /both "tenants" and "environments", and they differ, so it cannot tell which to keep\. Nothing was changed: remove the out-of-date key from /.test(err.message)
        && err.message.endsWith(`start again (a copy of the file as it was is in ${path.join(dir, names.HOST_COPY_DIR, 'names-environment')}).`)
        && fs.existsSync(path.join(dir, names.HOST_COPY_DIR, 'names-environment', 'host.json')));
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith(names.HOST_COPY_DIR)), before);
      const same = copyHostFixture();
      fs.writeFileSync(path.join(same, 'host.json'), JSON.stringify({ ...oldHost, environments: [] }));
      names.migrateHost(same, { log: quiet });
      assert.deepEqual(hostJson(same).environments, oldHost.tenants, 'an empty "environments" beside "tenants" takes the old list');
    });

    test('names-environment: an unreadable host.json stops the start, naming it', () => {
      const dir = copyHostFixture();
      fs.writeFileSync(path.join(dir, 'host.json'), '{ not json');
      assert.throws(() => names.migrateHost(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'host.json'));
      assert.ok(fs.existsSync(path.join(dir, 'tenants', 'acme')), 'nothing moved');
    });

    test('a part that fails after its folders moved runs again, and its record lists the first attempt\'s moves too', () => {
      const dir = copyHostFixture();
      const hostFile = path.join(dir, 'host.json');
      assert.throws(
        () => withFailingRename((from, to) => from === `${hostFile}.names-tmp` && to === hostFile, () => names.migrateHost(dir, { log: quiet })),
        (err) => err instanceof names.MigrationError && err.file === hostFile && err.message.endsWith(`The originals are in ${path.join(dir, names.HOST_COPY_DIR, 'names-environment')}.`),
      );
      assert.ok(fs.existsSync(path.join(dir, 'environments', 'acme')), 'the folders moved before the write failed');
      assert.equal(fs.readFileSync(hostFile, 'utf8'), originalHost['host.json'], 'host.json not rewritten, nothing recorded');
      assert.deepEqual(JSON.parse(fs.readFileSync(noteOf(dir), 'utf8')), BOTH_MOVES, 'the moves noted beside the copy');
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment'], 'the next start runs it again');
      assert.deepEqual(hostJson(dir).migrations[0].moved, BOTH_MOVES, 'every folder the part moved, from both attempts');
      assert.deepEqual(hostJson(dir).environments, oldHost.tenants);
      assert.equal(snapshot(dir)['pre-names-host/names-environment/host.json'], originalHost['host.json'], 'the first attempt\'s copy of the true original kept');
      assert.ok(!fs.existsSync(noteOf(dir)), 'the note goes once recorded');
    });

    test('a start killed part-way through the host\'s folder moves: the next start\'s record lists every folder moved', () => {
      // A real SIGKILL of a child process running the migration, at three points: just before the first move, just
      // after it, and just before the second (tenants/ moved, tenants-deleted/ not yet).
      const script = `
        const fs = require('fs');
        const real = fs.renameSync;
        const { point, target } = JSON.parse(process.env.KILL);
        fs.renameSync = (from, to) => {
          if (point === 'before' && from === target) process.kill(process.pid, 'SIGKILL');
          real(from, to);
          if (point === 'after' && from === target) process.kill(process.pid, 'SIGKILL');
        };
        require(process.env.MIGRATE).migrateHost(process.env.DIR, { log() {} });
      `;
      for (const [point, which] of [['before', 'tenants'], ['after', 'tenants'], ['before', 'tenants-deleted']]) {
        const dir = copyHostFixture();
        const run = spawnSync(process.execPath, ['-e', script], {
          env: { PATH: process.env.PATH, KILL: JSON.stringify({ point, target: path.join(dir, which) }), MIGRATE: path.join(ROOT, 'server', 'migrate-names.js'), DIR: dir },
          encoding: 'utf8',
        });
        const where = `killed ${point} moving ${which}`;
        assert.equal(run.signal, 'SIGKILL', `${where}: the child was killed (${run.stderr})`);
        assert.equal(fs.readFileSync(path.join(dir, 'host.json'), 'utf8'), originalHost['host.json'], `${where}: host.json not rewritten, nothing recorded`);
        assert.equal(fs.existsSync(path.join(dir, 'environments')), !(point === 'before' && which === 'tenants'), `${where}: tenants/ moved or not, as expected`);
        assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment'], `${where}: the next start runs the part again`);
        assert.deepEqual(hostJson(dir).migrations[0].moved, BOTH_MOVES, `${where}: every folder moved, once each`);
        assert.deepEqual(hostJson(dir).environments, oldHost.tenants);
        assert.ok(fs.existsSync(path.join(dir, 'environments', 'acme', 'app.json')) && fs.existsSync(path.join(dir, 'environments-deleted', 'gone-1767225600000', 'app.json')));
        assert.ok(!fs.existsSync(noteOf(dir)), `${where}: the note goes once recorded`);
      }
    });

    test('a note naming a move that never happened, or was put back, is not recorded as moved', () => {
      const dir = copyHostFixture();
      fs.mkdirSync(path.join(dir, names.HOST_COPY_DIR), { recursive: true });
      fs.writeFileSync(noteOf(dir), JSON.stringify([{ from: 'tenants', to: 'environments' }, { from: 'nowhere', to: 'somewhere' }]));
      fs.rmSync(path.join(dir, 'tenants-deleted'), { recursive: true });
      names.migrateHost(dir, { log: quiet });
      assert.deepEqual(hostJson(dir).migrations[0].moved, [{ from: 'tenants', to: 'environments' }], 'only the move this attempt made; the note\'s other entry never happened');
    });

    test('a folder move that fails and cannot be put back names the folder left moved, and does not say nothing changed', () => {
      const dir = copyHostFixture();
      const tenants = path.join(dir, 'tenants');
      const environments = path.join(dir, 'environments');
      let err = null;
      try {
        withFailingRename((from, to) => from === path.join(dir, 'tenants-deleted') || (from === environments && to === tenants), () => names.migrateHost(dir, { log: quiet }));
      } catch (e) { err = e; }
      assert.ok(err instanceof names.MigrationError, 'a MigrationError');
      assert.equal(err.file, path.join(dir, 'tenants-deleted'));
      assert.ok(!err.message.includes('Nothing was changed'), err.message);
      assert.ok(err.message.includes(`${environments} (was ${tenants})`), `names the folder left moved: ${err.message}`);
      assert.ok(fs.existsSync(path.join(environments, 'acme')) && fs.existsSync(path.join(dir, 'tenants-deleted')));
      assert.equal(fs.readFileSync(path.join(dir, 'host.json'), 'utf8'), originalHost['host.json'], 'host.json not rewritten');
      assert.deepEqual(names.migrateHost(dir, { log: quiet }), ['names-environment'], 'the next start finishes it');
      assert.deepEqual(hostJson(dir).migrations[0].moved, BOTH_MOVES, 'and records both moves');
      // A move that fails and is put back still says nothing was changed.
      const clean = copyHostFixture();
      let plain = null;
      try {
        withFailingRename((from) => from === path.join(clean, 'tenants-deleted'), () => names.migrateHost(clean, { log: quiet }));
      } catch (e) { plain = e; }
      assert.ok(plain instanceof names.MigrationError && plain.message.endsWith('Nothing was changed.'), plain && plain.message);
      assert.ok(fs.existsSync(path.join(clean, 'tenants', 'acme')) && !fs.existsSync(path.join(clean, 'environments')), 'put back');
    });

    test('the log line for an environment skipped at startup is two whole sentences', () => {
      const logged = [];
      const opts = { hosted: true, log: (m) => logged.push(m), stop: () => {} };
      names.refusedAtStartup(new names.MigrationError('The names migration part "x" stopped at /d/app.json: this value is not a shape the part knows', '/d/app.json'), opts);
      names.refusedAtStartup(new names.MigrationError('/d/app.json records the migration part "y", which this version of Magpie does not know: so it will not be opened here.', '/d/app.json', 'newer'), opts);
      assert.ok(logged[0].includes('the part knows. This environment is skipped'), logged[0]);
      assert.ok(logged[1].includes('opened here. This environment is skipped') && !logged[1].includes('..'), logged[1]);
    });

    test('a move whose target is taken stops the part before any live file changes', () => {
      const dir = copyFixture();
      fs.mkdirSync(path.join(dir, 'frame-check-from'));
      fs.mkdirSync(path.join(dir, 'frame-check-to'));
      const before = snapshot(dir);
      assert.throws(() => names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'frame-check-to'));
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names')), before, 'every live file untouched, nothing recorded, no temporary file left');
      assert.ok(fs.existsSync(path.join(dir, 'frame-check-from')));
    });

    test('a folder move failing on a read-only parent: a MigrationError, no live JSON changed, no .names-tmp left', () => {
      const dir = copyFixture();
      fs.mkdirSync(path.join(dir, 'frame-check-from'));
      fs.mkdirSync(path.join(dir, 'locked'));
      const locked = { id: 'names-frame-check', files: () => [MODULE_FILE], run(ctx) { ctx.write(MODULE_FILE, { changed: true }); ctx.move('frame-check-from', 'locked/frame-check-to'); } };
      const before = snapshot(dir);
      fs.chmodSync(path.join(dir, 'locked'), 0o555);
      try {
        assert.throws(() => names.migrateEnvironment(dir, { parts: [locked], log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'frame-check-from') && err.reason === 'failed');
      } finally {
        fs.chmodSync(path.join(dir, 'locked'), 0o755);
      }
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names')), before, 'app.json and the module file untouched, nothing recorded');
      assert.ok(!Object.keys(snapshot(dir)).some((rel) => rel.endsWith('.names-tmp')), 'no staged file left');
    });

    test('whatever goes wrong inside a migration leaves it as a MigrationError, so a start can refuse it', () => {
      const dir = copyFixture();
      const typo = { id: 'names-frame-check', files: () => [MODULE_FILE], run(ctx) { ctx.read(MODULE_FILE).nothing.here; } };
      assert.throws(() => names.migrateEnvironment(dir, { parts: [typo], log: quiet }), names.MigrationError);
      const badList = { id: 'names-frame-check', files: () => { throw new TypeError('no list'); }, run() {} };
      assert.throws(() => names.migrateEnvironment(dir, { parts: [badList], log: quiet }), names.MigrationError);
      fs.writeFileSync(path.join(dir, 'host.json'), '{}');
      assert.throws(() => names.migrateHost(dir, { parts: [badList], log: quiet }), names.MigrationError);
      const plain = names.asMigrationError(new Error('EACCES'), '/x');
      assert.ok(plain instanceof names.MigrationError && plain.file === '/x' && plain.reason === 'failed');
    });

    test('what a person asking for a refused environment is told, exactly', () => {
      assert.equal(names.REFUSED_NEWER, "This environment's data is from a newer version of Magpie.");
      assert.equal(names.REFUSED_FAILED, "This environment's data could not be updated. The host admin has been told.");
      const dir = copyFixture();
      const file = path.join(dir, 'app.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original['app.json']), migrations: [{ id: 'names-from-the-future' }] }));
      let err = null;
      try { names.migrateEnvironment(dir, { log: quiet }); } catch (e) { err = e; }
      assert.equal(err && err.reason, 'newer');
      assert.equal(names.refusalSentence(err), names.REFUSED_NEWER);
      assert.equal(names.refusalSentence(new names.MigrationError('x', file)), names.REFUSED_FAILED);
    });

    test('a part writing a file its files() did not list is refused, and nothing is written', () => {
      const dir = copyFixture();
      const sneaky = { id: 'names-frame-check', files: () => [MODULE_FILE], run(ctx) { ctx.write(MODULE_FILE, {}); ctx.write('chat.json', { spaces: {} }); } };
      assert.throws(() => names.migrateEnvironment(dir, { parts: [sneaky], log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'chat.json') && /did not list/.test(err.message));
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names')), original);
      const spelled = { id: 'names-frame-check', files: () => ['./modules//todo/data/room-keep01.json'], run(ctx) { ctx.write(MODULE_FILE, { same: 'file' }); } };
      names.migrateEnvironment(dir, { parts: [spelled], log: quiet });
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, MODULE_FILE), 'utf8')), { same: 'file' }, 'the same file however it is spelled');
    });

    test('the tavern.json -> app.json rename failing is a MigrationError naming the file', () => {
      const dir = copyFixture();
      fs.renameSync(path.join(dir, 'app.json'), path.join(dir, 'tavern.json'));
      fs.chmodSync(dir, 0o555);
      try {
        assert.throws(() => names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(dir, 'tavern.json'));
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      names.migrateEnvironment(dir, { parts: [framePart], log: quiet });
      assert.ok(fs.existsSync(path.join(dir, 'app.json')) && !fs.existsSync(path.join(dir, 'tavern.json')), 'and works once it can');
    });

    test('a start on data recording a part this server does not know is refused, naming the file and the part', () => {
      const newer = (dir, name) => {
        const file = path.join(dir, name);
        const record = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({ ...record, version: 2, migrations: [{ id: 'names-from-the-future', at: '', moved: [] }] }));
        return file;
      };
      const dir = copyFixture();
      const file = newer(dir, 'app.json');
      const before = snapshot(dir);
      assert.throws(() => names.migrateEnvironment(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.file === file && err.message.includes('names-from-the-future') && err.message.includes(file));
      assert.throws(() => names.migrateEnvironment(dir, { parts: [framePart], log: quiet }), names.MigrationError);
      assert.deepEqual(snapshot(dir), before, 'nothing touched');
      const legacy = copyFixture();
      newer(legacy, 'app.json');
      fs.renameSync(path.join(legacy, 'app.json'), path.join(legacy, 'tavern.json'));
      assert.throws(() => names.migrateEnvironment(legacy, { log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(legacy, 'tavern.json'));
      const host = path.join(base, 'host-newer');
      fs.mkdirSync(host);
      new HostRegistry(host);
      newer(host, 'host.json');
      assert.throws(() => names.migrateHost(host, { log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(host, 'host.json'));
      const broken = copyFixture();
      fs.writeFileSync(path.join(broken, 'app.json'), '{ not json');
      assert.throws(() => names.migrateEnvironment(broken, { parts: [], log: quiet }), (err) => err.reason === 'unreadable', 'a broken app.json is refused even with no part due');
    });

    test('refused at startup: a single environment stops, a hosted environment is skipped and the start goes on', () => {
      const err = new names.MigrationError('/data/app.json records the migration part "names-from-the-future", ...', '/data/app.json');
      const logged = [];
      const stops = [];
      const opts = (hosted) => ({ hosted, log: (m) => logged.push(m), stop: (code) => stops.push(code) });
      assert.equal(names.refusedAtStartup(err, opts(false)), false);
      assert.deepEqual(stops, [1], 'single environment: exit 1');
      assert.equal(logged[0], err.message);
      assert.equal(names.refusedAtStartup(err, opts(true)), true);
      assert.deepEqual(stops, [1], 'hosted: no exit');
      assert.ok(logged[1].startsWith(err.message) && logged[1].includes('503'), 'hosted: the file named, and what happens now');
      assert.throws(() => names.refusedAtStartup(new Error('something else'), opts(true)), /something else/, 'any other error is not swallowed');
    });

    test('restore refuses a newer backup however its app.json or tavern.json is named or repeated', () => {
      const oldApp = Buffer.from(original['app.json']);
      const newApp = Buffer.from(JSON.stringify({ version: 2, migrations: [{ id: 'names-from-the-future' }] }));
      const refuse = (entries) => names.backupRefusal(entries);
      assert.equal(refuse([['app.json', oldApp]]), null);
      assert.equal(refuse([['app.json', newApp]]), names.NEWER_BACKUP);
      assert.equal(refuse([['./app.json', newApp]]), names.NEWER_BACKUP);
      assert.equal(refuse([['/app.json', newApp]]), names.NEWER_BACKUP);
      assert.equal(refuse([['app.json', oldApp], ['app.json', newApp]]), names.NEWER_BACKUP, 'the last entry is what lands');
      assert.equal(refuse([['app.json', newApp], ['./app.json', oldApp]]), null, 'an older copy landing last is what is restored');
      assert.equal(refuse([['tavern.json', newApp]]), names.NEWER_BACKUP);
      assert.equal(refuse([['modules/x/app.json', newApp]]), null, 'only the environment\'s own record counts');
    });

    test('restore refuses a backup whose data cannot be read: app.json, or tavern.json when there is no app.json', () => {
      const oldApp = Buffer.from(original['app.json']);
      const refuse = (entries) => names.backupRefusal(entries);
      assert.equal(names.UNREADABLE_BACKUP, "This backup's data can't be read, so nothing was restored.");
      for (const bad of ['{ not json', '[]', 'null', '42', '"text"', '']) {
        assert.equal(refuse([['app.json', Buffer.from(bad)]]), names.UNREADABLE_BACKUP, `app.json ${JSON.stringify(bad)}`);
        assert.equal(refuse([['tavern.json', Buffer.from(bad)]]), names.UNREADABLE_BACKUP, `tavern.json alone ${JSON.stringify(bad)}`);
      }
      assert.equal(refuse([['app.json', oldApp], ['./app.json', Buffer.from('{ not json')]]), names.UNREADABLE_BACKUP, 'the last entry is what lands');
      assert.equal(refuse([['app.json', Buffer.from('{ not json')], ['app.json', oldApp]]), null, 'a good copy landing last is what is restored');
      assert.equal(refuse([['app.json', oldApp], ['tavern.json', Buffer.from('{ not json')]]), null, 'tavern.json is not read beside an app.json');
      assert.equal(refuse([['modules/x/data/a.json', Buffer.from('{ not json')]]), null, 'only the environment\'s own data counts');
      assert.equal(refuse([['images/a.png', Buffer.from('x')]]), null, 'a backup with no app.json starts fresh, as a new environment does');
      assert.equal(refuse([['app.json', Buffer.from('{}')]]), null, 'an empty object is data');
    });

    // --- names-table, the first environment part (plan-names step 3) ---
    const appOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    const withoutTable = (settings) => Object.fromEntries(Object.entries(settings).filter(([k]) => k !== 'tableName' && k !== 'room'));
    // The names-table tests run that part alone, so what they compare is only its own change.
    const TABLE_ONLY = names.ENVIRONMENT_PARTS.filter((p) => p.id === 'names-table');
    // The parts up to step 4's, for the tests that read the data by its names before names-spaces.
    const UP_TO_ROLES = names.ENVIRONMENT_PARTS.slice(0, 2);
    // settings with settings.roles' `user` key named `member`, in the same place.
    const renamedRoles = (settings) => (settings.roles ? { ...settings, roles: Object.fromEntries(Object.entries(settings.roles).map(([k, v]) => [k === 'user' ? 'member' : k, v])) } : settings);

    test('names-table is the first environment part', () => {
      assert.deepEqual(names.ENVIRONMENT_PARTS.map((p) => p.id)[0], 'names-table');
    });

    test('names-table on an old-format environment: tableName and room gone, nothing else changed, version 2, recorded once, the copy kept', () => {
      const dir = copyFixture();
      const old = JSON.parse(original['app.json']);
      assert.ok('tableName' in old.settings && 'room' in old.settings, 'the fixture has both old settings');
      const logged = [];
      assert.deepEqual(names.migrateEnvironment(dir, { parts: TABLE_ONLY, log: (m) => logged.push(m) }), ['names-table']);
      const after = snapshot(dir);
      const app = appOf(dir);
      assert.equal(app.version, 2);
      assert.deepEqual(app.settings, withoutTable(old.settings), 'only the two keys removed');
      assert.deepEqual(Object.keys(app.settings), Object.keys(old.settings).filter((k) => k !== 'tableName' && k !== 'room'), 'the rest keep their order');
      const { version, migrations, settings, rooms, ...rest } = app;
      const { version: v1, settings: s1, rooms: r1, ...oldRest } = old;
      assert.deepEqual(rest, oldRest, 'nothing else in app.json changed');
      assert.equal(r1[0].description, 'Everyone at the table.', 'the fixture\'s Lobby has the old seeded description');
      assert.deepEqual(rooms, r1.map((r) => (r.id === 'lobby' ? { ...r, description: 'Where everyone meets.' } : r)), 'only the Lobby\'s seeded description replaced');
      assert.deepEqual(Object.keys(app).slice(0, Object.keys(old).length), Object.keys(old), 'app.json\'s own keys keep their order, the record after');
      assert.deepEqual(migrations.filter((m) => m.id === 'names-table').map((m) => m.moved), [[]], 'recorded once, moving no folder');
      assert.equal(after['pre-names/names-table/app.json'], original['app.json'], 'the original app.json copied first');
      for (const rel of Object.keys(original)) if (rel !== 'app.json') assert.equal(after[rel], original[rel], `${rel} untouched`);
      assert.ok(logged.some((m) => m.includes('"names-table"')), 'one line in the log');
      assert.deepEqual(names.migrateEnvironment(dir, { parts: TABLE_ONLY, log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), after, 'and changes nothing');
    });

    test('names-table after Store: Store neither brings the old settings back nor knows them, and keeps the record', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const store = new Store(dir);
      assert.equal('tableName' in store.settings || 'room' in store.settings, false, 'no default fills them in');
      store.updateSettings({ tableName: 'Back again', room: 'table' });
      store.save();
      const app = appOf(dir);
      assert.equal('tableName' in app.settings || 'room' in app.settings, false, 'settings no longer take them');
      assert.equal(app.version, 2);
      assert.ok(names.recordedParts(app).includes('names-table'));
    });

    test('names-table on settings with only one of the two, or neither: removes what is there, records either way', () => {
      const one = copyFixture();
      const old = JSON.parse(original['app.json']);
      const { room, ...onlyName } = old.settings;
      fs.writeFileSync(path.join(one, 'app.json'), JSON.stringify({ ...old, settings: { ...onlyName, tableName: 'The Mess Hall' } }));
      names.migrateEnvironment(one, { parts: TABLE_ONLY, log: quiet });
      assert.deepEqual(appOf(one).settings, withoutTable(old.settings));
      const none = copyFixture();
      const already = { ...old, settings: withoutTable(old.settings), rooms: old.rooms.map((r) => (r.id === 'lobby' ? { ...r, description: 'Where everyone meets.' } : r)) };
      fs.writeFileSync(path.join(none, 'app.json'), JSON.stringify(already));
      names.migrateEnvironment(none, { parts: TABLE_ONLY, log: quiet });
      const { version, migrations, ...rest } = appOf(none);
      const { version: v1, ...alreadyRest } = already;
      assert.deepEqual(rest, alreadyRest, 'data already in the new shape is left as it is');
      assert.equal(version, 2);
      assert.ok(names.recordedParts({ migrations }).includes('names-table'));
      const noSettings = copyFixture();
      const { settings, ...bare } = old;
      fs.writeFileSync(path.join(noSettings, 'app.json'), JSON.stringify(bare));
      names.migrateEnvironment(noSettings, { parts: TABLE_ONLY, log: quiet });
      assert.equal('settings' in appOf(noSettings), false, 'an app.json with no settings gains none');
    });

    test('names-table: the Lobby\'s description is replaced only when it is exactly the old seed', () => {
      const old = JSON.parse(original['app.json']);
      for (const [had, expected] of [
        ['Everyone at the table.', 'Where everyone meets.'],
        ['Everyone at the table, and the dog.', 'Everyone at the table, and the dog.'],
        ['everyone at the table.', 'everyone at the table.'],
        ['', ''],
      ]) {
        const dir = copyFixture();
        fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ ...old, rooms: old.rooms.map((r) => (r.id === 'lobby' ? { ...r, description: had } : r)) }));
        names.migrateEnvironment(dir, { parts: TABLE_ONLY, log: quiet });
        const rooms = appOf(dir).rooms;
        assert.equal(rooms.find((r) => r.id === 'lobby').description, expected, JSON.stringify(had));
        assert.deepEqual(rooms.filter((r) => r.id !== 'lobby'), old.rooms.filter((r) => r.id !== 'lobby'), 'other spaces untouched');
      }
      const keep = copyFixture();
      fs.writeFileSync(path.join(keep, 'app.json'), JSON.stringify({ ...old, rooms: old.rooms.map((r) => (r.id === 'keep01' ? { ...r, description: 'Everyone at the table.' } : r)) }));
      names.migrateEnvironment(keep, { parts: TABLE_ONLY, log: quiet });
      assert.equal(appOf(keep).rooms.find((r) => r.id === 'keep01').description, 'Everyone at the table.', 'another space with the same words is someone\'s own');
    });

    test('names-table on an install not started since app.json was tavern.json: renamed, then migrated', () => {
      const dir = copyFixture();
      fs.renameSync(path.join(dir, 'app.json'), path.join(dir, 'tavern.json'));
      names.migrateEnvironment(dir, { parts: TABLE_ONLY, log: quiet });
      assert.ok(!fs.existsSync(path.join(dir, 'tavern.json')));
      assert.deepEqual(appOf(dir).settings, withoutTable(JSON.parse(original['app.json']).settings));
    });

    test('names-table on a new environment: recorded as run, moving nothing, no copy, and Store builds it without the old settings', () => {
      const dir = path.join(base, 'fresh-table');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), names.ENVIRONMENT_PARTS.map((p) => p.id));
      assert.deepEqual(appOf(dir).migrations.map((m) => [m.id, m.moved]), names.ENVIRONMENT_PARTS.map((p) => [p.id, []]));
      assert.equal(fs.existsSync(path.join(dir, 'pre-names')), false);
      const store = new Store(dir);
      store.save();
      const app = appOf(dir);
      assert.equal('tableName' in app.settings || 'room' in app.settings, false);
      assert.equal(app.version, 2);
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), [], 'the next start runs nothing');
    });

    test('names-table on a hosted directory: after the host\'s part, each environment migrates on its own, the deleted ones are not touched', () => {
      const dir = copyHostFixture();
      names.migrateHost(dir, { log: quiet });
      const envs = JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8')).environments.map((e) => e.slug);
      assert.deepEqual(envs, ['acme', 'bravo']);
      for (const slug of envs) {
        const envDir = path.join(dir, 'environments', slug);
        const before = JSON.parse(originalHost[`tenants/${slug}/app.json`]);
        assert.deepEqual(names.migrateEnvironment(envDir, { parts: UP_TO_ROLES, log: quiet }), UP_TO_ROLES.map((p) => p.id), slug);
        const app = appOf(envDir);
        assert.deepEqual(app.settings, renamedRoles(withoutTable(before.settings)), `${slug}: only the old settings removed, and the role keys renamed`);
        assert.equal(app.version, 2);
        assert.equal(fs.readFileSync(path.join(envDir, 'pre-names', 'names-table', 'app.json'), 'utf8'), originalHost[`tenants/${slug}/app.json`], `${slug}: its own copy`);
        const after = snapshot(envDir);
        assert.deepEqual(names.migrateEnvironment(envDir, { parts: UP_TO_ROLES, log: quiet }), [], `${slug}: the second start runs nothing`);
        assert.deepEqual(snapshot(envDir), after);
      }
      assert.equal(fs.readFileSync(path.join(dir, 'environments-deleted', 'gone-1767225600000', 'app.json'), 'utf8'), originalHost['tenants-deleted/gone-1767225600000/app.json'], 'a deleted environment is not built, so not migrated');
      assert.ok(!fs.existsSync(path.join(dir, 'pre-names')), 'no environment copy at the host\'s level');
    });

    // --- names-roles, the role values (plan-names step 4) ---
    const ROLES_ONLY = names.ENVIRONMENT_PARTS.filter((p) => p.id === 'names-roles');
    const ALL_PARTS = names.ENVIRONMENT_PARTS.map((p) => p.id);

    test('names-roles is the second environment part, after names-table', () => {
      assert.deepEqual(names.ENVIRONMENT_PARTS.map((p) => p.id).slice(0, 2), ['names-table', 'names-roles']);
    });

    test('names-roles on an old-format environment: admin is owner, user is member, the stand-in is admin, settings.roles.user is member, recorded once, the copy kept', () => {
      const dir = copyFixture();
      const old = JSON.parse(original['app.json']);
      assert.deepEqual(old.users.map((u) => [u.key, u.role, Boolean(u.hostAdmin)]), [['ownerkey01', 'admin', false], ['memberkey1', 'user', false], ['hostkey001', 'user', true]], 'the fixture has an owner, a member and a stand-in someone demoted');
      assert.ok('user' in old.settings.roles, 'the fixture has custom member permissions under the old key');
      const logged = [];
      assert.deepEqual(names.migrateEnvironment(dir, { parts: UP_TO_ROLES, log: (m) => logged.push(m) }), ['names-table', 'names-roles']);
      const afterTable = JSON.parse(fs.readFileSync(path.join(dir, 'pre-names', 'names-roles', 'app.json'), 'utf8'));
      assert.deepEqual(names.recordedParts(afterTable), ['names-table'], 'the copy is app.json as names-table left it');
      const app = appOf(dir);
      assert.deepEqual(app.users.map((u) => [u.key, u.role]), [['ownerkey01', 'owner'], ['memberkey1', 'member'], ['hostkey001', 'admin']]);
      assert.deepEqual(app.users.map(({ role, ...u }) => u), old.users.map(({ role, ...u }) => u), 'nothing else on an account changed');
      assert.deepEqual(app.settings.roles, { moderator: old.settings.roles.moderator, member: old.settings.roles.user, guest: old.settings.roles.guest });
      assert.deepEqual(Object.keys(app.settings.roles), ['moderator', 'member', 'guest'], 'the key keeps its place');
      assert.deepEqual(app.invites, old.invites.map((i) => ({ ...i, role: 'member' })), 'an invite\'s role, where one is stored, renamed too');
      const { version, migrations, settings, users, invites, rooms, ...rest } = app;
      const { version: v1, settings: s1, users: u1, invites: i1, rooms: r1, ...oldRest } = old;
      assert.deepEqual(rest, oldRest, 'nothing else in app.json changed');
      assert.deepEqual(migrations.map((m) => [m.id, m.moved]), [['names-table', []], ['names-roles', []]]);
      assert.ok(logged.some((m) => m.includes('"names-roles"')), 'one line in the log');
      const after = snapshot(dir);
      assert.deepEqual(names.migrateEnvironment(dir, { parts: UP_TO_ROLES, log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), after, 'and changes nothing');
    });

    test('names-roles, run alone again over its own result, writes nothing: the part is idempotent by shape', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const app = appOf(dir);
      fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ ...app, migrations: app.migrations.filter((m) => m.id !== 'names-roles') }));
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), ['names-roles'], 'only names-roles is due');
      const again = appOf(dir);
      assert.deepEqual({ ...again, migrations: [] }, { ...app, migrations: [] }, 'the same data, recorded again');
    });

    test('names-roles: an owner, member or stand-in already in the new shape, and no settings.roles, are left as they are', () => {
      const dir = copyFixture();
      const old = JSON.parse(original['app.json']);
      const { roles, ...noRoles } = old.settings;
      const already = { ...old, settings: noRoles, invites: [], users: [{ ...old.users[0], role: 'owner' }, { ...old.users[1], role: 'member' }, { ...old.users[2], role: 'admin' }] };
      fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(already));
      names.migrateEnvironment(dir, { parts: ROLES_ONLY, log: quiet });
      const { version, migrations, ...rest } = appOf(dir);
      const { version: v1, ...alreadyRest } = already;
      assert.deepEqual(rest, alreadyRest);
      assert.equal('roles' in rest.settings, false, 'no settings.roles is made');
    });

    test('names-roles: settings.roles with both user and member refuses when they differ, and keeps one when they agree', () => {
      const old = JSON.parse(original['app.json']);
      const differ = copyFixture();
      const differing = { ...old, settings: { ...old.settings, roles: { user: { chat: true }, member: { chat: false } } } };
      fs.writeFileSync(path.join(differ, 'app.json'), JSON.stringify(differing));
      const before = snapshot(differ);
      assert.throws(() => names.migrateEnvironment(differ, { parts: ROLES_ONLY, log: quiet }), (err) => err instanceof names.MigrationError && /both "user" and "member"/.test(err.message) && err.file === path.join(differ, 'app.json'));
      assert.deepEqual(snapshot(differ, (rel) => rel.startsWith('pre-names')), before, 'nothing changed, nothing recorded');
      const agree = copyFixture();
      fs.writeFileSync(path.join(agree, 'app.json'), JSON.stringify({ ...old, settings: { ...old.settings, roles: { user: { chat: true }, member: { chat: true } } } }));
      names.migrateEnvironment(agree, { parts: ROLES_ONLY, log: quiet });
      assert.deepEqual(appOf(agree).settings.roles, { member: { chat: true } });
    });

    test('names-roles after Store: the roles read by their new names, the custom member permissions kept, the record kept', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const store = new Store(dir);
      assert.deepEqual(store.users.map((u) => u.role), ['owner', 'member', 'admin']);
      assert.equal(store.roleSet('member').startAside, true, 'the member override (was settings.roles.user) applies');
      assert.equal(store.roleSet('member').chat, false);
      assert.equal(store.spacePermissions('memberkey1', null).startAside, true, 'and to a member');
      assert.equal(store.spacePermissions('memberkey1', 'keep01').canKick, true, 'the moderator grant in The Keep still gives the Moderator column');
      assert.equal(store.spacePermissions('memberkey1', null).canKick, false, 'but only there');
      assert.ok(Object.values(store.spacePermissions('ownerkey01', null)).every(Boolean), 'the owner has every permission');
      assert.ok(Object.values(store.spacePermissions('hostkey001', null)).every(Boolean), 'and the stand-in');
      assert.deepEqual(Object.keys(store.roles()), ['owner', 'moderator', 'member', 'guest']);
      assert.equal(store.ownerCount(), 1, 'the stand-in is not an owner');
      store.save();
      const app = appOf(dir);
      assert.deepEqual(names.recordedParts(app), ALL_PARTS);
      assert.deepEqual(app.users.map((u) => u.role), ['owner', 'member', 'admin']);
    });

    test('names-roles on a new environment: recorded as run, moving nothing, no copy', () => {
      const dir = path.join(base, 'fresh-roles');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), ALL_PARTS);
      assert.deepEqual(appOf(dir).migrations.map((m) => [m.id, m.moved]), ALL_PARTS.map((id) => [id, []]));
      assert.equal(fs.existsSync(path.join(dir, 'pre-names')), false);
    });

    test('names-roles on a hosted environment: the owner, the member and the host admin\'s stand-in', () => {
      const dir = copyHostFixture();
      names.migrateHost(dir, { log: quiet });
      const envDir = path.join(dir, 'environments', 'acme');
      names.migrateEnvironment(envDir, { log: quiet });
      const app = appOf(envDir);
      assert.deepEqual(app.users.map((u) => [u.login, u.role, Boolean(u.hostAdmin)]), [['owner', 'owner', false], ['pat', 'member', false], ['boss', 'admin', true]]);
      assert.deepEqual(app.settings.roles, { member: { startAside: true }, guest: { react: false } });
      assert.ok(fs.existsSync(path.join(envDir, 'pre-names', 'names-roles', 'app.json')));
    });

    // --- names-spaces, a space and the environment's scope (plan-names step 5a) ---
    const SPACES_ONLY = names.ENVIRONMENT_PARTS.filter((p) => p.id === 'names-spaces');
    const jsonOf = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
    const oldJson = (rel) => JSON.parse(original[rel]);
    const SPACE_MOVES = [
      { from: 'images/rooms', to: 'images/spaces' },
      { from: 'images/memberkey1/rooms', to: 'images/memberkey1/spaces' },
      { from: 'modules/calendar/data/room-lobby.json', to: 'modules/calendar/data/space-lobby.json' },
      { from: 'modules/research/uploads/room-keep01', to: 'modules/research/uploads/space-keep01' },
      { from: 'modules/research/uploads/server', to: 'modules/research/uploads/environment' },
      { from: 'modules/todo/data/room-keep01.json', to: 'modules/todo/data/space-keep01.json' },
      { from: 'modules/todo/data/server.json', to: 'modules/todo/data/environment.json' },
      { from: 'modules/travel/data/server.json', to: 'modules/travel/data/environment.json' },
    ];
    // The parts up to and including names-spaces, for the tests that look at that part's own change.
    const UP_TO_SPACES = names.ENVIRONMENT_PARTS.slice(0, 3);
    const sortMoves = (list) => [...list].sort((a, b) => a.from.localeCompare(b.from));

    test('names-spaces is the third environment part, after names-roles', () => {
      assert.deepEqual(names.ENVIRONMENT_PARTS.map((p) => p.id).slice(0, 3), ['names-table', 'names-roles', 'names-spaces']);
    });

    test('names-spaces on an old-format environment: every key, file and folder renamed in place, nothing else changed, recorded once, the copies kept', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { parts: UP_TO_ROLES, log: quiet });
      const before = snapshot(dir);
      const beforeApp = appOf(dir);
      const logged = [];
      assert.deepEqual(names.migrateEnvironment(dir, { parts: UP_TO_SPACES, log: (m) => logged.push(m) }), ['names-spaces']);
      const app = appOf(dir);
      // app.json: each key renamed where it stood.
      assert.deepEqual(Object.keys(app), Object.keys(beforeApp).map((k) => (k === 'rooms' ? 'spaces' : k)), 'spaces where rooms was');
      assert.deepEqual(app.spaces, beforeApp.rooms, 'every space, the aside among them, as it was');
      assert.deepEqual(app.users.map((u) => Object.keys(u)), beforeApp.users.map((u) => Object.keys(u).map((k) => (k === 'rooms' ? 'spaces' : k))));
      assert.deepEqual(app.users.map((u) => u.spaces), beforeApp.users.map((u) => u.rooms), 'each member\'s space settings, as they were');
      assert.deepEqual(app.invites.map((i) => i.spaces), beforeApp.invites.map((i) => i.rooms));
      assert.deepEqual(Object.keys(app.settings), Object.keys(beforeApp.settings).map((k) => (k === 'serverName' ? 'environmentName' : k)));
      assert.equal(app.settings.environmentName, 'Fixture Table');
      assert.deepEqual(app.migrations.map((m) => m.id), UP_TO_SPACES.map((p) => p.id));
      assert.deepEqual(sortMoves(app.migrations[2].moved), sortMoves(SPACE_MOVES), 'every folder and file it moved, recorded');
      // The rest of the environment.
      assert.deepEqual(jsonOf(dir, 'chat.json'), { spaces: oldJson('chat.json').rooms });
      const registry = jsonOf(dir, 'modules/registry.json');
      assert.deepEqual([registry.modules.todo.allSpaces, registry.modules.todo.spaces, registry.modules.calendar.allSpaces], [false, ['keep01'], true]);
      assert.equal('rooms' in registry.modules.todo || 'allRooms' in registry.modules.calendar, false);
      assert.deepEqual(jsonOf(dir, 'modules/settings.json'), { environment: oldJson('modules/settings.json').server, spaces: oldJson('modules/settings.json').rooms, people: oldJson('modules/settings.json').people });
      assert.deepEqual(jsonOf(dir, 'modules/links.json').map((l) => [l.from, l.to]), [
        [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'keep01' }, { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' }],
        [{ module: 'todo', kind: 'task', id: 't2', scope: 'environment' }, { module: 'calendar', kind: 'event', id: 'e2', scope: 'environment' }],
      ]);
      const bus = jsonOf(dir, 'modules/bus.json');
      assert.deepEqual([bus.events[0].scopeKey, bus.events[0].ref], ['space:lobby', { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' }]);
      assert.deepEqual([bus.actions[0].scopeKey, bus.actions[0].input.about.scope, bus.actions[0].input.title, bus.actions[0].result.ref.scope], ['environment', 'environment', 'x', 'environment']);
      assert.deepEqual(jsonOf(dir, 'modules/schedules.json').map((s) => [s.id, s.scopeKey, s.spaceId, s.notify.to, 'roomId' in s]), [
        ['todo|space:keep01|remind', 'space:keep01', 'keep01', 'space', false],
        ['calendar|environment|weekly', 'environment', null, 'environment', false],
      ]);
      assert.deepEqual(jsonOf(dir, 'modules/notifications.json').memberkey1.map((n) => [n.scope, n.spaceId, 'roomId' in n]), [['space', 'keep01', false], ['environment', null, false]]);
      assert.deepEqual(jsonOf(dir, 'modules/activity.json').map((a) => a.scope), ['space:keep01', 'environment', null]);
      // Moved, byte for byte: pictures, a module's own data (its values are its own until names-objects), uploads.
      const after = snapshot(dir);
      for (const [from, to] of [
        ['images/rooms/keep01.png', 'images/spaces/keep01.png'],
        ['images/memberkey1/rooms/keep01/player-fixture.png', 'images/memberkey1/spaces/keep01/player-fixture.png'],
        ['modules/todo/data/room-keep01.json', 'modules/todo/data/space-keep01.json'],
        ['modules/todo/data/server.json', 'modules/todo/data/environment.json'],
        ['modules/travel/data/server.json', 'modules/travel/data/environment.json'],
        ['modules/calendar/data/room-lobby.json', 'modules/calendar/data/space-lobby.json'],
        ['modules/research/uploads/room-keep01/0123456789abcdef01234567.json', 'modules/research/uploads/space-keep01/0123456789abcdef01234567.json'],
        ['modules/research/uploads/server/.keep', 'modules/research/uploads/environment/.keep'],
      ]) {
        assert.equal(after[to], before[from], `${from} is at ${to}`);
        assert.equal(after[from], undefined, `${from} is gone`);
      }
      assert.equal(after['modules/todo/data/person-memberkey1.json'], before['modules/todo/data/person-memberkey1.json'], 'a person\'s data stays where it was');
      assert.equal(after['images/memberkey1/profile-fixture.png'], before['images/memberkey1/profile-fixture.png']);
      // The copies: every JSON file it rewrote, as it was before this part.
      for (const rel of ['app.json', 'chat.json', 'modules/registry.json', 'modules/settings.json', 'modules/links.json', 'modules/bus.json', 'modules/schedules.json', 'modules/notifications.json', 'modules/activity.json']) {
        assert.equal(after[`pre-names/names-spaces/${rel}`], before[rel], `pre-names/names-spaces/${rel}`);
      }
      assert.ok(logged.some((m) => m.includes('"names-spaces"') && m.includes('(moved 8)')), logged.join('\n'));
      assert.deepEqual(names.migrateEnvironment(dir, { parts: UP_TO_SPACES, log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), after, 'and changes nothing');
    });

    test('names-spaces, then the services: every space, member\'s space settings, picture, chat, module data, setting, upload and link is found under its new name', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const store = new Store(dir);
      assert.deepEqual(store.spaces.map((r) => r.id), ['lobby', 'keep01', 'aside1']);
      assert.equal(store.spaceById('keep01').hasImage, true, 'the space\'s picture');
      assert.ok(store.spaceImagePath('keep01').endsWith(path.join('images', 'spaces', 'keep01.png')));
      assert.equal(store.usesSpaceImages('memberkey1', 'keep01'), true);
      assert.ok(store.effectiveImage('memberkey1', 'player', 'keep01').file.endsWith(path.join('images', 'memberkey1', 'spaces', 'keep01', 'player-fixture.png')), 'a member\'s picture in a space');
      assert.equal(store.spacePermissions('memberkey1', 'keep01').canKick, true, 'the moderator grant in The Keep');
      assert.equal(store.settings.environmentName, 'Fixture Table');
      assert.deepEqual(store.invites.length, 0, 'the fixture invite has no token, so none is live (unchanged)');
      store.save();
      assert.equal('rooms' in appOf(dir), false, 'Store writes the new names only');
      const { ChatHistory } = require('../server/chat-history.js');
      assert.equal(new ChatHistory(dir).spaces.keep01[0].text, 'Hello from the Keep', 'the chat read back (the fixture\'s messages are older than the window list() keeps)');
      const modulesDir = path.join(dir, 'modules');
      const { ModuleData } = require('../server/module-data.js');
      const data = new ModuleData(modulesDir);
      assert.equal(data.get('todo', 'environment', 'list:shared').value.title, 'Everyone\'s list');
      assert.equal(data.get('todo', 'space:keep01', 'list:main').value.title, 'Before the session');
      assert.equal(data.get('todo', 'person:memberkey1', 'list:mine').value.title, 'Mine');
      const { ModuleSettings } = require('../server/module-settings.js');
      const settings = new ModuleSettings(modulesDir);
      const manifest = { id: 'calendar', settings: [{ key: 'weekStart', scope: 'environment', type: 'text', default: 'sunday' }, { key: 'showDone', scope: 'space', type: 'boolean', default: true }] };
      assert.equal(settings.values(manifest, 'environment', {}).weekStart, 'monday');
      assert.equal(settings.values({ ...manifest, id: 'todo' }, 'space', { spaceId: 'keep01' }).showDone, false);
      const { ModuleUploads } = require('../server/module-uploads.js');
      assert.deepEqual(new ModuleUploads(modulesDir).list('research', 'space:keep01').map((f) => f.name), ['harbour.jpg']);
      const { ModuleLinks } = require('../server/module-links.js');
      assert.deepEqual(new ModuleLinks(modulesDir).to({ module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' }), [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'keep01' }]);
      const { ModuleManager } = require('../server/modules.js');
      const reg = new ModuleManager(dir).registry.modules;
      assert.deepEqual([reg.todo.spaces, reg.calendar.allSpaces], [['keep01'], true]);
    });

    test('names-spaces, run alone again over its own result, writes and moves nothing: the part is idempotent by shape', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const app = appOf(dir);
      fs.writeFileSync(path.join(dir, 'app.json'), `${JSON.stringify({ ...app, migrations: app.migrations.filter((m) => m.id !== 'names-spaces') }, null, 2)}\n`);
      const before = snapshot(dir, (rel) => rel.startsWith('pre-names') || rel === 'app.json');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), ['names-spaces']);
      const again = appOf(dir);
      assert.deepEqual(again.migrations.find((m) => m.id === 'names-spaces').moved, [], 'nothing left to move');
      assert.deepEqual({ ...again, migrations: [] }, { ...app, migrations: [] }, 'the same data');
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names') || rel === 'app.json'), before, 'no other file written');
    });

    test('names-spaces refuses a key under both its old and new names that differ, and a move onto something already there, with nothing changed', () => {
      const old = JSON.parse(original['app.json']);
      const differ = copyFixture();
      names.migrateEnvironment(differ, { parts: UP_TO_ROLES, log: quiet });
      fs.writeFileSync(path.join(differ, 'app.json'), JSON.stringify({ ...appOf(differ), spaces: [{ id: 'other1', name: 'Other' }] }));
      const before = snapshot(differ, (rel) => rel.startsWith('pre-names'));
      assert.throws(() => names.migrateEnvironment(differ, { log: quiet }), (err) => err instanceof names.MigrationError && /both "rooms" and "spaces"/.test(err.message) && err.file === path.join(differ, 'app.json'));
      assert.deepEqual(snapshot(differ, (rel) => rel.startsWith('pre-names')), before, 'nothing changed, nothing recorded');
      const agree = copyFixture();
      fs.writeFileSync(path.join(agree, 'app.json'), JSON.stringify({ ...old, spaces: [] }));
      names.migrateEnvironment(agree, { log: quiet });
      assert.deepEqual(appOf(agree).spaces.map((r) => r.id), ['lobby', 'keep01', 'aside1'], 'an empty new key gives way to the old one');
      const clash = copyFixture();
      fs.writeFileSync(path.join(clash, 'modules', 'todo', 'data', 'environment.json'), '{}');
      const clashBefore = snapshot(clash);
      const both = path.join(clash, 'modules', 'todo', 'data');
      assert.throws(() => names.migrateEnvironment(clash, { parts: SPACES_ONLY, log: quiet }), (err) => err instanceof names.MigrationError && err.file === path.join(both, 'environment.json')
        && err.message === `The names migration part "names-spaces" stopped at ${path.join(both, 'environment.json')}: ${path.join(both, 'server.json')} and ${path.join(both, 'environment.json')} are both there, so it cannot tell which to keep. Nothing was changed: remove the out-of-date one and start again (a copy of the JSON files as they were is in ${path.join(clash, 'pre-names', 'names-spaces')}).`);
      assert.deepEqual(snapshot(clash, (rel) => rel.startsWith('pre-names')), clashBefore, 'no folder moved, no file written');
    });

    // --- names-pointers, the pointers inside a module's own data (plan-names decision 12, done in step 5c) ---
    test('names-pointers is the fourth environment part, after names-spaces', () => {
      assert.deepEqual(names.ENVIRONMENT_PARTS.map((p) => p.id).slice(0, 4), ['names-table', 'names-roles', 'names-spaces', 'names-pointers']);
    });

    test('names-pointers rewrites every old pointer in a module\'s own data, by shape, at any depth, and nothing else', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { parts: UP_TO_SPACES, log: quiet });
      const before = snapshot(dir);
      const logged = [];
      assert.deepEqual(names.migrateEnvironment(dir, { log: (m) => logged.push(m) }), ['names-pointers', 'names-objects']);
      const after = snapshot(dir);
      // To-do's links: a space's and the environment's, inside a list inside a value.
      const todo = jsonOf(dir, 'modules/todo/data/space-keep01.json');
      assert.deepEqual(todo['list:main'].value.tasks.map((t) => t.link), [
        { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'keep01' },
        { module: 'calendar', kind: 'event', id: 'e2', scope: 'environment' },
      ]);
      const oldTodo = JSON.parse(before['modules/todo/data/space-keep01.json']);
      assert.deepEqual({ ...todo['list:main'], value: { ...todo['list:main'].value, tasks: [] } }, { ...oldTodo['list:main'], value: { ...oldTodo['list:main'].value, tasks: [] } }, 'the envelope and the rest of the value as they were');
      // The Planner's trip: nested in objects and arrays of arrays; a pointer's own extra key kept in its place.
      const trip = jsonOf(dir, 'modules/travel/data/environment.json')['trip:t1'].value;
      const oldTrip = JSON.parse(before['modules/travel/data/environment.json'])['trip:t1'].value;
      assert.deepEqual(trip.legs[0].about, { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby', title: 'Session' });
      assert.deepEqual(Object.keys(trip.legs[0].about), ['module', 'kind', 'id', 'scope', 'space', 'title']);
      assert.deepEqual(trip.legs[0].stops, [[{ module: 'todo', kind: 'task', id: 't2', scope: 'environment' }]]);
      // Not a pointer's exact shape, or already new: left exactly as they were.
      for (const key of ['own', 'half', 'noRoom', 'mine', 'already']) assert.deepEqual(trip.legs[1][key], oldTrip.legs[1][key], key);
      assert.equal(trip.title, oldTrip.title);
      // Files with no old pointer, and one that is not valid JSON, untouched and not copied.
      for (const rel of ['modules/calendar/data/space-lobby.json', 'modules/todo/data/environment.json', 'modules/todo/data/person-memberkey1.json', 'modules/polls/data/person-memberkey1.json']) {
        assert.equal(after[rel], before[rel], rel);
        assert.equal(after[`pre-names/names-pointers/${rel}`], undefined, `no copy of ${rel}`);
      }
      // The copies: each file it rewrote, as it was.
      for (const rel of ['modules/todo/data/space-keep01.json', 'modules/travel/data/environment.json']) assert.equal(after[`pre-names/names-pointers/${rel}`], before[rel], rel);
      const record = appOf(dir).migrations.find((m) => m.id === 'names-pointers');
      assert.deepEqual(record.moved, []);
      assert.ok(logged.some((m) => m.includes('"names-pointers"')), logged.join('\n'));
      // Read back as the module sees it.
      const { ModuleData } = require('../server/module-data.js');
      assert.deepEqual(new ModuleData(path.join(dir, 'modules')).get('todo', 'space:keep01', 'list:main').value.tasks[0].link.scope, 'space');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), after, 'and changes nothing');
    });

    test('names-pointers rewrites old pointers a module published in a bus event\'s data after names-spaces, by shape, and copies the bus record', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { parts: UP_TO_SPACES, log: quiet });
      // As a Polls "closed" event published between steps 5a and 5c left it: the host's own fields new, the data old.
      const bus = jsonOf(dir, 'modules/bus.json');
      const pick = { module: 'travel', kind: 'plan', id: 'i1', scope: 'room', room: 'keep01' };
      const own = { scope: 'room', label: 'not a pointer' };
      bus.events.push({ id: 4, at: 1767225600000, module: 'polls', name: 'closed', ref: { module: 'polls', kind: 'poll', id: 'p1', scope: 'space', space: 'keep01' }, data: { pick, all: [pick, { module: 'calendar', kind: 'event', id: 'e2', scope: 'server' }], own }, scopeKey: 'space:keep01', by: 'ownerkey01' });
      fs.writeFileSync(path.join(dir, 'modules', 'bus.json'), JSON.stringify(bus));
      const before = fs.readFileSync(path.join(dir, 'modules', 'bus.json'), 'utf8');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), ['names-pointers', 'names-objects']);
      const after = jsonOf(dir, 'modules/bus.json');
      const e = after.events.find((x) => x.id === 4);
      assert.deepEqual(e.data.pick, { module: 'travel', kind: 'plan', id: 'i1', scope: 'space', space: 'keep01' });
      assert.deepEqual(e.data.all.map((x) => [x.scope, x.space ?? null]), [['space', 'keep01'], ['environment', null]]);
      assert.deepEqual(e.data.own, own, 'a module\'s own object with a scope key is left alone');
      assert.deepEqual({ ...after, events: after.events.filter((x) => x.id !== 4) }, { ...bus, events: bus.events.filter((x) => x.id !== 4) }, 'everything else in the record as it was');
      assert.equal(fs.readFileSync(path.join(dir, 'pre-names', 'names-pointers', 'modules', 'bus.json'), 'utf8'), before, 'the copy');
    });

    test('names-pointers, run alone again over its own result, writes nothing: the part is idempotent by shape', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const app = appOf(dir);
      fs.writeFileSync(path.join(dir, 'app.json'), `${JSON.stringify({ ...app, migrations: app.migrations.filter((m) => m.id !== 'names-pointers') }, null, 2)}\n`);
      const before = snapshot(dir, (rel) => rel.startsWith('pre-names') || rel === 'app.json');
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), ['names-pointers']);
      assert.deepEqual(snapshot(dir, (rel) => rel.startsWith('pre-names') || rel === 'app.json'), before, 'no other file written');
    });

    // --- names-objects (plan-names step 7): nothing the host stores carries step 7's names, so it is recorded, moving nothing ---
    const UP_TO_POINTERS = names.ENVIRONMENT_PARTS.slice(0, 4);
    test('names-objects is the fifth environment part, after names-pointers', () => {
      assert.deepEqual(names.ENVIRONMENT_PARTS.map((p) => p.id).slice(0, 5), ['names-table', 'names-roles', 'names-spaces', 'names-pointers', 'names-objects']);
    });

    test('names-objects is recorded and copies the record, and changes nothing else: a module\'s own card and item keys, links, the bus and installed manifests stay', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { parts: UP_TO_POINTERS, log: quiet });
      // What a module keeps in its own words (the Planner's item: keys, a stored "card"), a link and an installed manifest in the
      // old names: none of it is the host's to rename.
      const own = path.join(dir, 'modules', 'travel', 'data', 'space-lobby.json');
      fs.mkdirSync(path.dirname(own), { recursive: true });
      fs.writeFileSync(own, JSON.stringify({ 'item:i1': { value: { title: 'Ferry', card: { title: 'Ferry' }, cards: [] }, version: 1 } }));
      const manifest = path.join(dir, 'modules', 'notes', 'versions', '1.0.0', 'module.json');
      fs.mkdirSync(path.dirname(manifest), { recursive: true });
      fs.writeFileSync(manifest, JSON.stringify({ id: 'notes', refs: { produces: [{ kind: 'note', key: 'note:{id}', card: { title: 'title' } }] } }));
      fs.writeFileSync(path.join(dir, 'modules', 'links.json'), JSON.stringify([{ from: { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'lobby' }, to: { module: 'travel', kind: 'item', id: 'i1', scope: 'space', space: 'lobby' }, by: 'ownerkey01', at: 1 }]));
      const recordBefore = fs.readFileSync(path.join(dir, 'app.json'), 'utf8');
      const before = snapshot(dir, (rel) => rel === 'app.json');
      const logged = [];
      assert.deepEqual(names.migrateEnvironment(dir, { log: (m) => logged.push(m) }), ['names-objects']);
      const after = snapshot(dir, (rel) => rel === 'app.json' || rel.startsWith('pre-names/names-objects'));
      assert.deepEqual(after, before, 'nothing but the record written');
      assert.equal(fs.readFileSync(path.join(dir, 'pre-names', 'names-objects', 'app.json'), 'utf8'), recordBefore, 'the record copied first');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'pre-names', 'names-objects')), ['app.json'], 'and nothing else copied');
      const app = appOf(dir);
      assert.deepEqual(app.migrations.map((m) => m.id), ALL_PARTS);
      assert.deepEqual(app.migrations.find((m) => m.id === 'names-objects').moved, []);
      assert.ok(logged.some((m) => m.includes('"names-objects"')), logged.join('\n'));
      const settled = snapshot(dir);
      assert.deepEqual(names.migrateEnvironment(dir, { log: quiet }), [], 'the second start runs nothing');
      assert.deepEqual(snapshot(dir), settled, 'and changes nothing');
    });

    test('names-objects: a build from before step 7 refuses data that records it', () => {
      assert.deepEqual(names.unknownParts({ version: 2, migrations: ALL_PARTS.map((id) => ({ id })) }, UP_TO_POINTERS), ['names-objects']);
    });

    test('names-spaces on a hosted environment: its module data and the rest take the new names', () => {
      const dir = copyHostFixture();
      names.migrateHost(dir, { log: quiet });
      const envDir = path.join(dir, 'environments', 'acme');
      assert.deepEqual(names.migrateEnvironment(envDir, { log: quiet }), ALL_PARTS);
      assert.equal(fs.readFileSync(path.join(envDir, 'modules', 'todo', 'data', 'space-lobby.json'), 'utf8'), originalHost['tenants/acme/modules/todo/data/room-lobby.json']);
      const app = appOf(envDir);
      assert.ok(Array.isArray(app.spaces) && !('rooms' in app) && app.settings.environmentName === 'Acme Adventures');
    });

    test('the Studio alias, step 5a: serverName, rooms, activeRoom and users[].online.room beside the new names, for a bearer request only', () => {
      const alias = require('../server/studio-alias.js');
      const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
      const bearer = req({ authorization: 'Bearer good' });
      const cookie = req({ cookie: 'session=x' });
      const spaces = [{ id: 'lobby', name: 'Lobby', isLobby: true }, { id: 'aside1', name: 'Aside', ephemeral: true, private: true, members: ['k'] }];
      const status = { environmentName: 'Acme', users: [{ key: 'k', role: 'owner', online: { key: 'k', space: 'aside1', micOn: true, cameraOn: false } }, { key: 'm', role: 'member', online: null }], spaces, activeSpace: 'lobby' };
      const sent = alias.status(bearer, status, { signedIn: { key: 'k' }, environmentName: 'Acme' });
      assert.deepEqual([sent.serverName, sent.rooms, sent.activeRoom], ['Acme', spaces, 'lobby']);
      assert.deepEqual([sent.environmentName, sent.spaces, sent.activeSpace], ['Acme', spaces, 'lobby'], 'the new names too');
      assert.deepEqual(sent.users.map((u) => [u.role, u.online && u.online.room, u.online && u.online.space]), [['admin', 'aside1', 'aside1'], ['user', null, null]]);
      assert.equal(alias.me(bearer, { environmentName: 'Acme' }, { signedIn: { key: 'k' }, role: 'owner', environmentName: 'Acme' }).serverName, 'Acme');
      assert.equal(alias.status(cookie, status, { signedIn: { key: 'k' }, environmentName: 'Acme' }), status, 'the pages\' cookie request: exactly the answer');
    });

    test('the Store takes only owner and member by hand, lets an environment have no owner, and never changes an admin\'s role or sign-in', () => {
      const dir = copyFixture();
      names.migrateEnvironment(dir, { log: quiet });
      const store = new Store(dir);
      assert.throws(() => store.addUser({ login: 'x1', role: 'admin' }), /role must be owner or member/);
      assert.throws(() => store.addUser({ login: 'x2', role: 'user' }), /role must be owner or member/);
      assert.equal(store.addUser({ login: 'x3' }).role, 'member', 'no role given: a member');
      assert.throws(() => store.updateUser('memberkey1', { role: 'admin' }), /role must be owner or member/);
      assert.throws(() => store.updateUser('hostkey001', { role: 'member' }), /host admin's, so its role/);
      assert.throws(() => store.updateUser('hostkey001', { linkToken: 'x'.repeat(24) }), /host console/);
      assert.equal(store.updateUser('ownerkey01', { role: 'member' }).role, 'member', 'the only owner steps down');
      assert.equal(store.ownerCount(), 0, 'no owner is fine');
      assert.equal(store.removeUser('ownerkey01').key, 'ownerkey01', 'and an owner or member can be removed');
      // The server's admin on a single-environment install (setServerAdmin, from ADMIN_LOGIN and ADMIN_PASSWORD).
      const gm = store.setServerAdmin(store.addUser({ login: 'gm', passwordHash: 'h1' }).key);
      assert.deepEqual([gm.role, gm.hostAdmin, store.ownerCount(), store.serverAdmins().map((u) => u.login)], ['admin', false, 0, ['gm']], 'the admin is not an owner');
      assert.ok(Object.values(store.spacePermissions(gm.key, null)).every(Boolean), 'and has every permission');
      assert.throws(() => store.updateUser(gm.key, { role: 'owner' }), /server's admin, so its role/);
      for (const patch of [{ passwordHash: 'h2' }, { login: 'other' }, { linkToken: 'y'.repeat(24) }]) assert.throws(() => store.updateUser(gm.key, patch), /ADMIN_LOGIN and ADMIN_PASSWORD/, JSON.stringify(patch));
      assert.equal(store.updateUser(gm.key, { login: 'gm', displayName: 'Game Master' }).displayName, 'Game Master', 'its name, and the same login, are fine');
      assert.throws(() => store.removeUser(gm.key), /server's admin, so it can't be removed/);
      assert.throws(() => store.setServerAdmin('hostkey001'), /host admin's/);
      assert.equal(new Store(dir).userByLogin('gm').role, 'admin', 'kept as admin when read back');
      assert.throws(() => store.setRolePermissions('owner', { chat: false }), /every permission/);
      assert.throws(() => store.setRolePermissions('user', { chat: false }), (err) => err.status === 404 && /no such role/.test(err.message));
      assert.equal(store.setRolePermissions('member', { chat: true }).member.chat, true);
    });

    test('names-table: an app.json that is not valid JSON stops the start, naming it, with nothing changed', () => {
      const dir = copyFixture();
      fs.writeFileSync(path.join(dir, 'app.json'), '{ not json');
      assert.throws(() => names.migrateEnvironment(dir, { log: quiet }), (err) => err instanceof names.MigrationError && err.reason === 'unreadable' && err.file === path.join(dir, 'app.json'));
      assert.equal(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'), '{ not json');
    });

    test('the Studio alias answers only a request its bearer token signed in, and never sees the account', () => {
      const alias = require('../server/studio-alias.js');
      const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
      let seen = null;
      const entry = (_answer, ctx) => { seen = ctx; return { oldName: true }; };
      alias.ME.push(entry);
      alias.STATUS.push(entry);
      try {
        const answer = { a: 1 };
        assert.deepEqual(alias.me(req({ authorization: 'Bearer good' }), answer, { signedIn: { passwordHash: 'x' }, role: 'admin', environmentName: 'Ours' }), { a: 1, tableName: 'Ours', serverName: 'Ours', oldName: true });
        assert.deepEqual(seen, { role: 'admin', environmentName: 'Ours' }, 'the entry gets what it was given, not the account');
        assert.equal(alias.status(req({ authorization: 'Bearer junk' }), answer, { signedIn: null }), answer, 'a bearer header that signed nobody in (the stream key let it in)');
        assert.equal(alias.me(req({ cookie: 'session=x' }), answer, { signedIn: { key: 'k' } }), answer, 'the pages\' cookie');
      } finally {
        alias.ME.pop();
        alias.STATUS.pop();
      }
      assert.equal(alias.me(req({ authorization: 'Bearer good' }), { a: 1 }, { signedIn: {} }).oldName, undefined, 'an entry taken out is gone');
    });

    // --- What Studio reads, entry by entry (plan-names, "What Studio reads") ---
    test('the Studio alias, step 3: tableName is the environment\'s name, on /api/me and /api/status, for a bearer request only', () => {
      const alias = require('../server/studio-alias.js');
      const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
      const bearer = req({ authorization: 'Bearer good' });
      const cookie = req({ cookie: 'session=x' });
      const context = { signedIn: { key: 'k' }, role: 'admin', hostAdmin: false, environmentName: 'Acme Adventures' };
      assert.deepEqual(alias.me(bearer, { environmentName: 'Acme Adventures' }, context), { environmentName: 'Acme Adventures', tableName: 'Acme Adventures', serverName: 'Acme Adventures' });
      assert.deepEqual(alias.status(bearer, { users: [] }, { signedIn: { key: 'k' }, environmentName: 'Acme Adventures' }), { users: [], tableName: 'Acme Adventures', serverName: 'Acme Adventures' });
      const answer = { environmentName: 'Acme Adventures' };
      assert.equal(alias.me(cookie, answer, context), answer, 'the pages\' cookie request: exactly the answer, no tableName');
      assert.equal(alias.status(cookie, answer, context), answer);
    });

    test('a record naming a part this server does not know is from a newer Magpie', () => {
      assert.deepEqual(names.unknownParts({ version: 2, migrations: [{ id: 'names-from-the-future', at: '', moved: [] }] }), ['names-from-the-future']);
      assert.deepEqual(names.unknownParts({ version: 1 }), []);
      assert.deepEqual(names.unknownParts(null), []);
      assert.deepEqual(names.unknownParts({ migrations: names.ENVIRONMENT_PARTS.map((p) => ({ id: p.id })) }), []);
    });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  console.log(`check-names: migration, ${n} groups OK (${names.ENVIRONMENT_PARTS.length} environment parts, ${names.HOST_PARTS.length} host parts)`);
}

// --- calls to routes the server no longer answers ---------------------------------------------------------------
// Whatever level a folder is at, a page or module that still calls a settings route by an old scope gets 404 from step
// 5a on ("no such kind of setting"), so any such call fails here: /api/module-settings/server|room and
// /api/modules/<id>/settings/server|room. The pages' own `server`/`room` words that are mapped before the call (module-
// settings.js's wireScope) are not calls and are not matched.
const OLD_SETTINGS_ROUTE = /\/api\/module-settings\/(server|room)\b|\/settings\/(server|room)\b/g;
function oldRouteCheck(files) {
  let n = 0;
  for (const file of files.filter((f) => /^(public|modules)\//.test(f) && /\.(js|mjs|html)$/.test(f))) {
    const { code } = split(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(OLD_SETTINGS_ROUTE)) { n += 1; fail(`check-names: ${file}:${i + 1} calls ${m[0]}, which the server answers with 404 since plan-names step 5a: use environment or space`); }
    });
  }
  // The pattern itself, on made-up lines: the old calls are caught, the new ones and a mapped scope are not.
  const probe = (text) => [...text.matchAll(OLD_SETTINGS_ROUTE)].length;
  if (probe("api('GET', '/api/module-settings/server')") !== 1 || probe('api(\'PUT\', `/api/modules/${id}/settings/room`)') !== 1
    || probe("api('GET', '/api/module-settings/environment')") !== 0 || probe('api(\'PUT\', `/api/modules/${id}/settings/${wireScope}`)') !== 0) fail('check-names: the old settings route pattern does not match as it should');
  console.log(`check-names: old settings routes, ${n} call${n === 1 ? '' : 's'} left`);
}

// --- run ---------------------------------------------------------------------------------------------------------
const { entries: allow, problems } = loadAllow();
for (const p of problems) fail(`check-names: ${p}`);
if (runCode || runWords) {
  const files = scannedFiles();
  if (runCode) { report('code', files, allow); scannerCheck(); callNamesCheck(); oldRouteCheck(files); }
  if (runWords) { report('words', files, allow); vocabularyReport(files, allow); wordsCheck(); }
  if (runCode && runWords) {
    for (const e of allow.filter((x) => !x.used)) console.log(`  allow-list entry used by no hit: ${e.file} ${e.level} ${e.pattern}`);
  }
}
if (runMigration) migrationCheck();
if (failed) {
  console.error(`check-names: ${failed} problem${failed === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`check-names: OK (${LEVELS.filter((l) => l.code === 'enforce').length} of ${LEVELS.length} levels enforced)`);
