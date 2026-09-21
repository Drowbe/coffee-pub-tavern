#!/usr/bin/env node
/*
 * check-syntax.mjs -- syntax-check the server and browser scripts.
 *
 * `node --check file.js` reads a .js file that uses import/export as a plain script and passes it without
 * parsing it as a module, so errors that only a module parse finds (a name declared twice, say) slipped
 * through. This checks any file that uses import or export from a temporary .mjs copy instead, where
 * `node --check` does parse it as a module, and checks the rest as they are.
 *
 *   node tools/check-syntax.mjs
 */
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-check-'));
let failed = 0;
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
