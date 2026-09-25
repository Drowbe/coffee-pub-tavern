#!/usr/bin/env node
/*
 * check-nav.mjs -- the nav-bar registry's rules, run without a browser.
 *
 * public/nav-bar.js is what both nav bars draw from (documentation/plans/plan-nav.md, "Modules register into the
 * bars"). Its ordering (groups by groupOrder, tools by order, the bands), its visibility rule and the cleaning of a
 * module's registration are pure, so this runs them in node and fails when any of them drifts.
 *
 *   node tools/check-nav.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The page's file is plain ES module syntax under a .js name; node wants .mjs to load it without a warning, so it is
// imported from a temporary copy (the same way check-syntax.mjs parses the pages).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-check-'));
const copy = path.join(tmp, 'nav-bar.mjs');
fs.copyFileSync(path.join(ROOT, 'public/nav-bar.js'), copy);
const { arrange, isVisible, cleanModuleTools, bandOf, BANDS, DEFAULT_ORDER } = await import(pathToFileURL(copy).href);
fs.rmSync(tmp, { recursive: true, force: true });

let n = 0;
const test = (name, fn) => {
  try {
    fn();
    n += 1;
  } catch (err) {
    console.error(`check-nav: ${name}\n  ${err.message}`);
    process.exit(1);
  }
};
const ids = (groups) => groups.map((g) => g.map((t) => t.id));

test('the bands: 1-10 core, 11-50 secondary, 51-100 utility, 101-998 a module, 999 last', () => {
  assert.equal(bandOf(1), 'core');
  assert.equal(bandOf(10), 'core');
  assert.equal(bandOf(11), 'secondary');
  assert.equal(bandOf(50), 'secondary');
  assert.equal(bandOf(51), 'utility');
  assert.equal(bandOf(100), 'utility');
  assert.equal(bandOf(101), 'module');
  assert.equal(bandOf(998), 'module');
  assert.equal(bandOf(999), 'last');
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(1000), null);
  assert.equal(bandOf(DEFAULT_ORDER), 'module', 'a tool that names no order lands in the module band');
});

test('tools sort by order inside a group, ties by registration', () => {
  const groups = arrange([
    { id: 'c', order: 3, seq: 1 },
    { id: 'a', order: 1, seq: 2 },
    { id: 'b2', order: 2, seq: 4 },
    { id: 'b1', order: 2, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['a', 'b1', 'b2', 'c']]);
});

test('groups sort by groupOrder; a group that names none takes its first tool\'s order', () => {
  const groups = arrange([
    { id: 'leave', group: 'leave', groupOrder: 999, order: 999, seq: 1 },
    { id: 'mod-x', group: 'mod:own', order: 500, seq: 2 }, // no groupOrder: 500
    { id: 'snap', group: 'space', groupOrder: 1, order: 2, seq: 3 },
    { id: 'dock', group: 'space', order: 1, seq: 4 }, // shares the group's groupOrder
  ]);
  assert.deepEqual(ids(groups), [['dock', 'snap'], ['mod-x'], ['leave']]);
});

test('the smallest groupOrder any tool of a group names wins for the group', () => {
  const groups = arrange([
    { id: 'p', group: 'g1', groupOrder: 40, order: 1, seq: 1 },
    { id: 'q', group: 'g1', groupOrder: 5, order: 2, seq: 2 },
    { id: 'r', group: 'g2', groupOrder: 20, order: 1, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['p', 'q'], ['r']]);
});

test('the system stays ahead of a module without coordinating numbers', () => {
  const system = [
    { id: 'dock-all', group: 'space', groupOrder: 1, order: 1, seq: 1 },
    { id: 'fullscreen-toggle', group: 'space', order: 11, seq: 2 },
    { id: 'leave-room', group: 'leave', groupOrder: 999, order: 999, seq: 3 },
  ];
  const mod = cleanModuleTools('calendar', [
    { id: 'today', icon: 'calendar-day', label: 'Today', order: 1 }, // asks for 1, gets the band's floor
    { id: 'add', icon: 'plus', label: 'Add', order: 5000, groupOrder: 1 },
  ]);
  const groups = arrange([...system, ...mod.map((t, i) => ({ ...t, seq: 10 + i }))]);
  assert.deepEqual(ids(groups), [['dock-all', 'fullscreen-toggle'], ['calendar:today', 'calendar:add'], ['leave-room']]);
  assert.equal(mod[0].order, BANDS.module[0]);
  assert.equal(mod[1].order, BANDS.module[1]);
  assert.equal(mod[1].groupOrder, BANDS.module[0]);
});

test('visible: left out means shown; a boolean; a function; a throwing function counts as shown', () => {
  assert.equal(isVisible({}), true);
  assert.equal(isVisible({ visible: false }), false);
  assert.equal(isVisible({ visible: true }), true);
  assert.equal(isVisible({ visible: () => 0 }), false);
  assert.equal(isVisible({ visible: () => 'yes' }), true);
  assert.equal(isVisible({ visible: () => { throw new Error('bug'); } }), true);
});

test('hidden tools keep their place in the order, so showing one again moves nothing', () => {
  const groups = arrange([
    { id: 'a', order: 1, seq: 1 },
    { id: 'b', order: 2, visible: false, seq: 2 },
    { id: 'c', order: 3, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['a', 'b', 'c']]);
});

test('a module\'s tools are namespaced: ids and groups carry the module id, and the module band clamps orders', () => {
  const [t] = cleanModuleTools('todo', [{ id: 'mine', icon: 'list-check', label: 'My tasks', group: 'views', title: 'Only my tasks' }]);
  assert.equal(t.id, 'todo:mine');
  assert.equal(t.own, 'mine');
  assert.equal(t.group, 'todo:views');
  assert.equal(t.bar, 'secondary');
  assert.equal(t.zone, 'right');
  assert.equal(t.order, DEFAULT_ORDER);
  assert.equal(t.groupOrder, DEFAULT_ORDER);
  assert.equal(t.visible, true);
  assert.equal(t.title, 'Only my tasks');
  const [u] = cleanModuleTools('todo', [{ id: 'all', icon: 'list', label: 'All', zone: 'middle', order: 200, groupOrder: 150, toggleable: true, active: true, badge: 3, visible: false }]);
  assert.equal(u.zone, 'middle');
  assert.equal(u.order, 200);
  assert.equal(u.groupOrder, 150);
  assert.equal(u.toggleable, true);
  assert.equal(u.active, true);
  assert.equal(u.badge, 3);
  assert.equal(u.visible, false);
  assert.equal(u.group, 'todo:own');
});

test('a module cannot name another module\'s or the system\'s ids', () => {
  assert.throws(() => cleanModuleTools('todo', [{ id: 'calendar:today', icon: 'x', label: 'x' }]), /letters, digits and hyphens/);
  const [t] = cleanModuleTools('todo', [{ id: 'leave-room', icon: 'x', label: 'x' }]);
  assert.equal(t.id, 'todo:leave-room', 'the system\'s leave-room is untouched: the module\'s tool is its own');
});

test('a registration needs an id, an icon and a label, once each', () => {
  assert.throws(() => cleanModuleTools('m', [{ icon: 'x', label: 'x' }]), /needs an id/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', label: 'x' }]), /needs an icon/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x' }]), /needs a label/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x' }, { id: 'a', icon: 'y', label: 'y' }]), /twice/);
  assert.throws(() => cleanModuleTools('m', 'nope'), /list/);
  assert.throws(() => cleanModuleTools('m', Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, icon: 'x', label: 'x' }))), /at most 12/);
});

test('href: a path on this server or an https address, nothing else', () => {
  assert.equal(cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: '/modules/m' }])[0].href, '/modules/m');
  assert.equal(cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'https://example.org/' }])[0].href, 'https://example.org/');
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'javascript:alert(1)' }]), /href/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: '//evil.example/' }]), /href/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'http://example.org/' }]), /href/);
});

test('the primary bar: refused unless the owner allowed the module there and the tool is system-wide, and then only the right zone', () => {
  const tool = { id: 'a', icon: 'x', label: 'x', bar: 'primary' };
  assert.throws(() => cleanModuleTools('m', [tool]), (e) => /primary bar/.test(e.message) && e.status === 403);
  assert.throws(() => cleanModuleTools('m', [tool], { allowPrimary: true }), (e) => /system: true/.test(e.message) && e.status === 403);
  assert.throws(() => cleanModuleTools('m', [{ ...tool, system: true }]), (e) => e.status === 403);
  assert.throws(() => cleanModuleTools('m', [{ ...tool, system: true, zone: 'middle' }], { allowPrimary: true }), /right zone only/);
  const [ok] = cleanModuleTools('m', [{ ...tool, system: true }], { allowPrimary: true });
  assert.equal(ok.bar, 'primary');
  assert.equal(ok.zone, 'right');
  assert.equal(ok.system, true);
});

console.log(`check-nav: OK (${n} tests)`);
