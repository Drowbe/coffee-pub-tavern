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
const FILES = [
  'public/gate-worklet.js', 'server/index.js', 'server/store.js', 'server/modules.js', 'server/module-build.js', 'server/auth.js',
  'public/room.js', 'public/view.js', 'public/admin.js', 'public/login.js', 'public/profile.js', 'public/brand.js',
  'public/roomconfig.js', 'public/register.js', 'public/hotkeys.js', 'public/module.js', 'public/module-host.js',
  'public/room-modules.js', 'public/sdk/tavern.js', 'server/module-data.js', 'server/module-links.js', 'server/module-hooks.js',
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
