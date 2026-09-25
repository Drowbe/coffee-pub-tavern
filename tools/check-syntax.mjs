#!/usr/bin/env node
/*
 * check-syntax.mjs -- syntax-check the server and browser scripts.
 *
 * `node --check file.js` reads a .js file that uses import/export as a plain script and passes it without
 * parsing it as a module, so errors that only a module parse finds (a name declared twice, say) slipped
 * through. This checks any file that uses import or export from a temporary .mjs copy instead, where
 * `node --check` does parse it as a module, and checks the rest as they are. It also refuses an inline script in a
 * page whose own content security policy would block it.
 *
 *   node tools/check-syntax.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every script of ours: the server, the pages and the SDK, and each module's source (a module's scripts are
// wrapped in a function and hold a placeholder comment where the build inlines shared code, so they parse as they are).
const list = (dir, re = /\.js$/) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((n) => re.test(n)).map((n) => `${dir}/${n}`) : []);
const FILES = [
  ...list('server'), ...list('public'), ...list('public/sdk'),
  ...(fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')).flatMap((m) => list(`modules/${m}/src`)) : []),
];
// A raw control byte inside a module's source (a NUL in a regular expression, say) survives a plain syntax check but is turned
// into U+FFFD when the build inlines the script into the page, and the page dies. Write such characters as escapes.
const RAW = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
let rawBytes = 0;
for (const dir of fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')) : []) {
  for (const f of list(`modules/${dir}/src`, /\.(js|css|html)$/)) {
    if (RAW.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) { rawBytes += 1; console.error(`${f}: has a raw control character; write it as an escape (\\x00)`); }
  }
}
// A page whose content security policy allows scripts from this site only ("script-src 'self'", no 'unsafe-inline')
// never runs an inline <script>: the browser blocks it without a word on the page (#18, bad-link.html). Its script goes in a file.
let inline = 0;
for (const f of list('public', /\.html$/)) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  const scriptSrc = csp && /(?:^|;)\s*script-src([^;]*)/.exec(csp[1]);
  if (!scriptSrc || /'unsafe-inline'/.test(scriptSrc[1])) continue;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    // One the policy names by its hash (space.html's import map) is allowed, as long as the hash still matches.
    const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
    if (!/\bsrc=/.test(m[1]) && m[2].trim() && !scriptSrc[1].includes(hash)) {
      inline += 1;
      console.error(`${f}: an inline <script> its content security policy blocks; move it to a file and load it with src=`);
    }
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-check-'));
let failed = rawBytes + inline;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const source = fs.readFileSync(file, 'utf8');
  let target = file;
  if (/^\s*(import|export)\s/m.test(source)) {
    target = path.join(tmp, rel.replace(/[\\/]/g, '__').replace(/\.js$/, '.mjs'));
    fs.writeFileSync(target, source);
  }
  const run = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (run.status !== 0) {
    failed += 1;
    console.error(`${rel}:\n${run.stderr.replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rel)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) process.exit(1);
console.log(`check-syntax: OK (${FILES.length} files)`);
