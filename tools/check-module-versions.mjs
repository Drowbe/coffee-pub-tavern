#!/usr/bin/env node
/*
 * check-module-versions.mjs -- a bundled module that changed must have a new version.
 *
 * A server that already has a module installed keeps the copy it stored, and offers an update only when the bundled version
 * is newer, so a change to a module's module.json or src/ that keeps the version never reaches an installed copy. This keeps
 * a fingerprint of each bundled module beside its version (tools/module-versions.json) and fails when the fingerprint changed
 * and the version did not.
 *
 *   node tools/check-module-versions.mjs            check
 *   node tools/check-module-versions.mjs --update   record the current modules (after bumping their versions)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'tools', 'module-versions.json');
const dir = path.join(ROOT, 'modules');

// Documentation in src/ (CONTRACT.md) is not part of what ships, so editing it needs no new version.
const fingerprint = (id) => {
  const h = crypto.createHash('sha256');
  const base = path.join(dir, id);
  const files = ['module.json', ...fs.readdirSync(path.join(base, 'src')).filter((f) => !f.endsWith('.md')).sort().map((f) => `src/${f}`)];
  for (const f of files) h.update(f).update('\0').update(fs.readFileSync(path.join(base, f)));
  return h.digest('hex').slice(0, 16);
};
const current = {};
for (const id of fs.readdirSync(dir).sort()) {
  const manifest = path.join(dir, id, 'module.json');
  if (!fs.existsSync(manifest) || !fs.existsSync(path.join(dir, id, 'src'))) continue;
  current[id] = { version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version, hash: fingerprint(id) };
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`check-module-versions: recorded ${Object.keys(current).length} modules`);
  process.exit(0);
}
const known = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
let failed = 0;
for (const [id, now] of Object.entries(current)) {
  const was = known[id];
  if (was && was.hash !== now.hash && was.version === now.version) {
    failed += 1;
    console.error(`${id}: changed but still version ${now.version}; bump its version in modules/${id}/module.json, then run node tools/check-module-versions.mjs --update`);
  } else if (!was || was.hash !== now.hash) {
    failed += 1;
    console.error(`${id}: version ${now.version} is new or bumped; run node tools/check-module-versions.mjs --update to record it`);
  }
}
if (failed) process.exit(1);
console.log(`check-module-versions: OK (${Object.keys(current).length} modules)`);
