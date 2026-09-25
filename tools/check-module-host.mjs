#!/usr/bin/env node
/*
 * check-module-host.mjs -- the pointer shape modules and the host agree on, run on its own.
 *
 * Since plan-names step 5c a module speaks the server's names directly: a pointer is
 * { module, kind, id, scope: 'space' | 'environment' | 'person', space? }, and nothing translates between an old and a
 * new shape. Two places check a pointer's shape before it goes anywhere: the page side (public/module-host.js,
 * REF_SHAPE and cleanPointer) and the SDK in the module (public/sdk/host.js, cleanRef). This slices those few lines out
 * of each and checks that they accept the one shape, keep only its own fields, and refuse the old one (scope 'room'
 * with `room`, scope 'server'): the hard break of decision 2.
 *
 *   node tools/check-module-host.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

function slice(file, startMark, endMark) {
  const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = src.indexOf(startMark);
  const end = src.indexOf(endMark, start);
  if (start === -1 || end === -1) {
    console.error(`check-module-host: could not find "${startMark}" ... "${endMark}" in ${file}`);
    process.exit(1);
  }
  return src.slice(start, end + endMark.length);
}

const hostSrc = slice('public/module-host.js', 'const REF_SHAPE', 'const cleanPointer = (r) => ({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.scope === \'space\' ? { space: r.space } : {}) });');
const { REF_SHAPE, cleanPointer } = new Function(`${hostSrc}\nreturn { REF_SHAPE, cleanPointer };`)();
const sdkSrc = slice('public/sdk/host.js', 'function cleanRef(ref) {', '\n  }\n');
const cleanRef = new Function(`${sdkSrc}\nreturn cleanRef;`)();

let failed = 0;
let n = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); }
};
const base = { module: 'todo', kind: 'task', id: 'abc' };
const inSpace = { ...base, scope: 'space', space: 'gq2zb7pq' };

test('a pointer in a space, the environment or a person is accepted by both sides', () => {
  for (const p of [inSpace, { ...base, scope: 'environment' }, { ...base, scope: 'person' }]) {
    assert.ok(REF_SHAPE(p), `module-host refused ${JSON.stringify(p)}`);
    assert.deepEqual(cleanRef(p), p);
    assert.deepEqual(cleanPointer(p), p);
  }
});
test('each side keeps only the pointer\'s own fields, and a place only for a space', () => {
  const extra = { ...inSpace, title: 'not part of a pointer', room: 'old' };
  assert.deepEqual(cleanRef(extra), inSpace);
  assert.deepEqual(cleanPointer(extra), inSpace);
  assert.deepEqual(cleanRef({ ...base, scope: 'environment', space: 'x' }), { ...base, scope: 'environment' });
  assert.deepEqual(cleanPointer({ ...base, scope: 'environment', space: 'x' }), { ...base, scope: 'environment' });
});
test('the old shape is refused, not translated', () => {
  for (const p of [{ ...base, scope: 'room', room: 'gq2zb7pq' }, { ...base, scope: 'server' }, { ...base, scope: 'rooms' }, { ...base, scope: 'room', space: 'gq2zb7pq' }]) {
    assert.equal(Boolean(REF_SHAPE(p)), false, `module-host accepted ${JSON.stringify(p)}`);
    assert.equal(cleanRef(p), null, `the SDK accepted ${JSON.stringify(p)}`);
  }
});
test('a space pointer needs its space, of a sane length', () => {
  for (const p of [{ ...base, scope: 'space' }, { ...base, scope: 'space', space: 7 }, { ...base, scope: 'space', space: 'x'.repeat(65) }]) {
    assert.equal(Boolean(REF_SHAPE(p)), false);
    assert.equal(cleanRef(p), null);
  }
});
test('nothing is left of the old translation (WIRE_SCOPE, toSdk, toWire)', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  for (const name of ['WIRE_SCOPE', 'SDK_SCOPE', 'toSdk', 'toWire', 'pointersIn']) assert.equal(src.includes(name), false, `${name} is still in module-host.js`);
});

if (failed) process.exit(1);
console.log(`check-module-host: OK (${n} groups)`);
