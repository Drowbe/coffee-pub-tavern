#!/usr/bin/env node
/*
 * check-module-window.mjs -- the module window's rules that can be checked mechanically (see
 * documentation/architecture/architecture-module-window.md, "Rules"). Today: every "..." in Tavern is the one
 * icon, Font Awesome's `ellipsis-vertical` -- the host's overflow buttons, a card's own menu, a day's, the call's
 * More. Not the horizontal `ellipsis`, and not a text glyph standing in for it. Drift here was found by hand once
 * (a vertical glyph on a poll, a horizontal icon everywhere else); this keeps it from coming back.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = [];
const walk = (dir, keep) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist' && name !== 'lib') walk(p, keep); } else if (keep(p)) files.push(p);
  }
};
walk(path.join(root, 'public'), (p) => /\.(js|html)$/.test(p) && !/[/\\](livekit|maplibre|pmtiles)/.test(p));
walk(path.join(root, 'modules'), (p) => /[/\\]src[/\\][^/\\]+\.(js|html)$/.test(p) && !/-lib-a-|maplibre/.test(p));

// A "..." drawn any way but the one icon: the horizontal Font Awesome icon (in a class, a data-icon, an icon name
// handed to the SDK), or a glyph standing in for the icon (the vertical or horizontal ellipsis character or entity).
const WRONG = [
  { re: /fa-ellipsis(?![-\w])/, why: 'the horizontal fa-ellipsis; use fa-ellipsis-vertical' },
  { re: /data-icon="ellipsis"/, why: 'data-icon="ellipsis" (horizontal); use ellipsis-vertical' },
  { re: /(icon|ui\.icon\(|wantIcon\(|menuIcon\()\s*[:(]?\s*['"]ellipsis['"]/, why: "the icon name 'ellipsis' (horizontal); use 'ellipsis-vertical'" },
  { re: /&#894[23];|&#x22e[ef];|[⋮⋯]/, why: 'an ellipsis character standing in for the icon; use the ellipsis-vertical icon' },
];

const problems = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { re, why } of WRONG) if (re.test(line)) problems.push(`${path.relative(root, file)}:${i + 1}: ${why}`);
  });
}
if (problems.length) {
  console.error(`check-module-window: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-module-window: OK (${files.length} files, the "..." icon)`);
