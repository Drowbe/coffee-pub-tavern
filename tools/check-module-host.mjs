#!/usr/bin/env node
/*
 * check-module-host.mjs -- the pointer translation in public/module-host.js, run on its own.
 *
 * Until plan-names step 5c the server speaks of a space (a pointer's scope 'space' with `space`, or 'environment') and
 * modules still speak the SDK's old names (scope 'room' with `room`, or 'server'). module-host.js translates between
 * them (toWire, toSdk). A pointer can reach either direction in either shape (an old /modules/<id>#ref= link, a page
 * handing back what it was given), so each direction must accept both and always give its own, and never drop the
 * place. This slices those few lines out of the page's module and checks them.
 *
 *   node tools/check-module-host.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
const start = src.indexOf('const WIRE_SCOPE');
const endMark = 'const toSdk = (value) => pointersIn(value, false);';
const end = src.indexOf(endMark);
if (start === -1 || end === -1) {
  console.error('check-module-host: could not find the pointer translation (WIRE_SCOPE ... toSdk) in public/module-host.js');
  process.exit(1);
}
const { toWire, toSdk } = new Function(`${src.slice(start, end + endMark.length)}\nreturn { toWire, toSdk };`)();

let failed = 0;
let n = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); }
};
const base = { module: 'todo', kind: 'task', id: 'abc' };
const sdkSpace = { ...base, scope: 'room', room: 'gq2zb7pq' };
const wireSpace = { ...base, scope: 'space', space: 'gq2zb7pq' };

test('a space pointer in the SDK shape goes to the server shape, and back', () => {
  assert.deepEqual(toWire(sdkSpace), wireSpace);
  assert.deepEqual(toSdk(wireSpace), sdkSpace);
});
test('each direction keeps a pointer already in its own shape (an old #ref= link, a page handing back)', () => {
  assert.deepEqual(toSdk(sdkSpace), sdkSpace);
  assert.deepEqual(toWire(wireSpace), wireSpace);
});
test('the environment and a person carry no place, in either shape', () => {
  assert.deepEqual(toWire({ ...base, scope: 'server' }), { ...base, scope: 'environment' });
  assert.deepEqual(toSdk({ ...base, scope: 'environment' }), { ...base, scope: 'server' });
  assert.deepEqual(toSdk({ ...base, scope: 'server' }), { ...base, scope: 'server' });
  assert.deepEqual(toWire({ ...base, scope: 'person' }), { ...base, scope: 'person' });
  assert.deepEqual(toWire({ ...base, scope: 'environment', space: 'x' }), { ...base, scope: 'environment' });
});
test('pointers inside other values are translated; anything else is left as it is', () => {
  assert.deepEqual(toSdk({ ref: wireSpace, list: [wireSpace, 3], note: { a: 'b' } }), { ref: sdkSpace, list: [sdkSpace, 3], note: { a: 'b' } });
  assert.deepEqual(toWire({ ref: sdkSpace }), { ref: wireSpace });
  assert.equal(toSdk('text'), 'text');
  assert.deepEqual(toSdk({ module: 'x', title: 'no kind, not a pointer', scope: 'space', space: 'k' }), { module: 'x', title: 'no kind, not a pointer', scope: 'space', space: 'k' });
});
test('translating twice changes nothing more (both directions are idempotent)', () => {
  for (const p of [sdkSpace, wireSpace]) {
    assert.deepEqual(toSdk(toSdk(p)), toSdk(p));
    assert.deepEqual(toWire(toWire(p)), toWire(p));
  }
});

if (failed) process.exit(1);
console.log(`check-module-host: OK (${n} groups)`);
