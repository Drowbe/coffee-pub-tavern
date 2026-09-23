#!/usr/bin/env node
/*
 * build-module.mjs -- build a the host module zip from a source folder.
 *
 *   node tools/build-module.mjs modules/calendar
 *
 * A module folder holds a module.json and src/<id>.html, src/<id>.css and src/<id>.js. The build inlines the
 * CSS and JS into the HTML (a module page loads nothing else; see documentation/api/api-module-sdk.md),
 * writes that page under each surface entry the manifest names, and zips module.json plus those pages into
 * modules/dist/<id>-<version>.zip, ready to upload on Manage > Modules. (A module in this repository does not
 * need uploading: the server offers to install or update it from Manage > Modules; see server/module-build.js.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { buildModule } = createRequire(import.meta.url)('../server/module-build.js');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(dir, 'module.json'))) {
  console.error('usage: node tools/build-module.mjs <module folder containing module.json>');
  process.exit(1);
}

const { manifest, fileCount, zip } = buildModule(dir);
const outDir = path.join(path.dirname(dir), 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${manifest.id}-${manifest.version}.zip`);
fs.writeFileSync(out, zip);
console.log(`built ${path.relative(process.cwd(), out)} (${fileCount} files, ${fs.statSync(out).size} bytes)`);
