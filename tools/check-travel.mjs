#!/usr/bin/env node
/*
 * check-travel.mjs -- run the Travel module's model (modules/travel/src/travel-lib.js) on its own.
 * The library is written to be inlined into a module page, so it is loaded here as a function body with the two
 * date helpers a page gets from the SDK.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL(`../modules/travel/src/${name}`, import.meta.url), 'utf8');
const src = read('travel-lib.js') + '\n' + read('travel-lib-plan.js');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const names = ['createPlan', 'cleanTrip', 'cleanItem', 'tripDays', 'dayLabel', 'daysUntil', 'sortDay', 'itemsByDay', 'orderBetween', 'renumber', 'placeUntimed', 'nudge', 'gapMinutes', 'gapText', 'stayNights'];
const lib = new Function('ymd', 'parseYmd', `${src}\nreturn { ${names.join(', ')} };`)(ymd, parseYmd);

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('cleanItem needs a title, keeps good fields and drops bad ones', () => {
  assert.equal(lib.cleanItem({ kind: 'stop', title: '' }), null);
  const i = lib.cleanItem({ id: 'a', kind: 'stop', title: ' Museum ', date: '2026-10-03', time: '09:30', minutes: 90, category: 'nope', order: 5 });
  assert.equal(i.title, 'Museum');
  assert.equal(i.date, '2026-10-03');
  assert.equal(i.time, '09:30');
  assert.equal(i.category, 'do');
  assert.equal(lib.cleanItem({ id: 'b', title: 'x', date: '2026-02-30' }).date, null);
  assert.equal(lib.cleanItem({ id: 'b', title: 'x', time: '25:00' }).time, null);
  assert.equal(lib.cleanItem({ id: 'c', kind: 'stay', title: 'Hotel' }).category, 'stay');
  assert.equal(lib.cleanItem({ id: 'c', kind: 'journey', title: 'Train' }).category, 'travel');
});

test('a link item needs a pointer and may have no title', () => {
  assert.equal(lib.cleanItem({ id: 'l', kind: 'link' }), null);
  const l = lib.cleanItem({ id: 'l', kind: 'link', ref: { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: 'lobby' } });
  assert.deepEqual(l.ref, { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: 'lobby' });
});

test('a stay cannot check out before it checks in', () => {
  assert.equal(lib.cleanItem({ id: 's', kind: 'stay', title: 'Hotel', date: '2026-10-05', checkOut: '2026-10-03' }).checkOut, null);
  assert.equal(lib.stayNights(lib.cleanItem({ id: 's', kind: 'stay', title: 'Hotel', date: '2026-10-05', checkOut: '2026-10-08' })), 3);
});

test('tripDays runs from start to end, across a month, and is capped', () => {
  assert.deepEqual(lib.tripDays({ start: '2026-09-29', end: '2026-10-02' }), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(lib.tripDays({ start: '2026-10-02', end: '2026-10-01' }), []);
  assert.deepEqual(lib.tripDays({}), []);
  assert.equal(lib.tripDays({ start: '2026-01-01', end: '2027-12-31' }).length, 60);
});

test('dayLabel says which day of how many', () => {
  const days = lib.tripDays({ start: '2026-09-29', end: '2026-10-05' });
  assert.equal(lib.dayLabel('2026-10-01', days).position, 'Day 3 of 7');
});

test('daysUntil counts to the start, negative once it has begun', () => {
  assert.equal(lib.daysUntil({ start: '2026-10-01' }, '2026-09-20'), 11);
  assert.equal(lib.daysUntil({ start: '2026-10-01' }, '2026-10-03'), -2);
  assert.equal(lib.daysUntil({}, '2026-10-03'), null);
});

const it = (id, extra) => lib.cleanItem({ id, title: id, date: '2026-10-01', ...extra });

test('sortDay puts the untimed first in hand order, then the timed by time', () => {
  const sorted = lib.sortDay([it('late', { time: '18:00' }), it('b', { order: 2000 }), it('early', { time: '08:15' }), it('a', { order: 1000 })]);
  assert.deepEqual(sorted.map((i) => i.id), ['a', 'b', 'early', 'late']);
});

test('itemsByDay groups by day, keeps ideas apart and drops days outside the trip', () => {
  const days = ['2026-10-01', '2026-10-02'];
  const by = lib.itemsByDay([it('a'), it('b', { date: '2026-10-02' }), it('idea', { date: null }), it('out', { date: '2026-11-01' })], days);
  assert.deepEqual(by.get('2026-10-01').map((i) => i.id), ['a']);
  assert.deepEqual(by.get('2026-10-02').map((i) => i.id), ['b']);
  assert.deepEqual(by.get(null).map((i) => i.id), ['idea']);
  assert.equal([...by.values()].flat().some((i) => i.id === 'out'), false);
});

test('a linked item is placed by its card when it has no day of its own', () => {
  const l = lib.cleanItem({ id: 'l', kind: 'link', ref: { module: 'calendar', kind: 'event', id: 'e', scope: 'server' } });
  const by = lib.itemsByDay([l], ['2026-10-01', '2026-10-02'], (i) => i.date || '2026-10-02');
  assert.equal(by.get('2026-10-02').length, 1);
});

test('orderBetween finds a number, or says the day needs renumbering', () => {
  assert.equal(lib.orderBetween(undefined, undefined), 1000);
  assert.equal(lib.orderBetween(1000, undefined), 2000);
  assert.equal(lib.orderBetween(undefined, 1000), 0);
  assert.equal(lib.orderBetween(1000, 2000), 1500);
  assert.equal(lib.orderBetween(1, 1 + 1e-9), null);
});

test('placeUntimed puts an item between neighbours and renumbers when squeezed', () => {
  const a = it('a', { order: 1000 }); const b = it('b', { order: 2000 }); const m = it('m', { order: 9000, date: '2026-10-02' });
  assert.deepEqual(lib.placeUntimed([a, b], m, '2026-10-01', 1), { m: { date: '2026-10-01', order: 1500 } });
  assert.deepEqual(lib.placeUntimed([], m, '2026-10-01', 0), { m: { date: '2026-10-01', order: 1000 } });
  const c = it('c', { order: 1 }); const d = it('d', { order: 1 + 1e-9 });
  const changes = lib.placeUntimed([c, d], m, '2026-10-01', 1);
  assert.equal(changes.m.order, 2000);
  assert.equal(changes.d.order, 3000);
});

test('nudge swaps untimed neighbours and moves a timed item by half an hour', () => {
  const a = it('a', { order: 1000 }); const b = it('b', { order: 2000 }); const t = it('t', { time: '09:00' });
  assert.deepEqual(lib.nudge([a, b, t], b, -1), { b: { order: 1000 }, a: { order: 2000 } });
  assert.equal(lib.nudge([a, b, t], a, -1), null);
  assert.deepEqual(lib.nudge([a, b, t], t, 1), { t: { time: '09:30' } });
  assert.equal(lib.nudge([a, b, it('z', { time: '23:45' })], it('z', { time: '23:45' }), 1), null);
});

test('gaps are the minutes between the end of one timed item and the next start', () => {
  assert.equal(lib.gapMinutes(it('a', { time: '09:00', minutes: 60 }), it('b', { time: '10:45' })), 45);
  assert.equal(lib.gapMinutes(it('a', { time: '09:00', minutes: 120 }), it('b', { time: '10:45' })), null);
  assert.equal(lib.gapMinutes(it('a'), it('b', { time: '10:45' })), null);
  assert.equal(lib.gapText(45), '45 min');
  assert.equal(lib.gapText(120), '2 h');
  assert.equal(lib.gapText(135), '2 h 15 min');
});

// --- the plan, against a small stand-in for the SDK -------------------------------------------------------------

function fakeTavern({ cards = [], search = [] } = {}) {
  const store = new Map(); // key -> { value, version }
  const handlers = { change: [] };
  const provided = {};
  let clock = 0;
  const refKey = (r) => [r.module, r.kind, r.id, r.scope, r.room || ''].join('|');
  const t = {
    user: { key: 'u1', name: 'Ann' },
    util: { id: () => 'id' + (++clock), refKey, ymd, parseYmd },
    storage: {
      get: async (key) => (store.has(key) ? { key, ...store.get(key) } : null),
      list: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, ...v })),
      set: async (key, value, o = {}) => {
        const cur = store.get(key);
        if (o.version !== undefined && (!cur || cur.version !== o.version)) throw Object.assign(new Error('stale'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        store.set(key, { value, version });
        return { key, value, version };
      },
      delete: async (key) => { store.delete(key); },
    },
    on: (event, fn) => { (handlers[event] ||= []).push(fn); },
    refs: {
      resolve: async (refs) => refs.map((r) => cards.find((c) => refKey(c.ref) === refKey(r)) || { error: 'gone' }),
      search: async () => search,
      make: (kind, id) => ({ module: 'travel', kind, id, scope: 'room' }),
    },
    actions: { provide: (h) => Object.assign(provided, h) },
  };
  return { t, store, provided, push: (e) => handlers.change.forEach((fn) => fn(e)) };
}

const run = async () => {
  const f = fakeTavern();
  const plan = lib.createPlan(f.t);
  await plan.load();
  assert.equal(plan.trip, null);
  await plan.saveTrip({ title: 'Cabin', start: '2026-10-01', end: '2026-10-03' });
  assert.deepEqual(plan.days(), ['2026-10-01', '2026-10-02', '2026-10-03']);
  await assert.rejects(() => plan.addItem({ kind: 'stop', title: '' }));

  const a = await plan.addItem({ kind: 'stop', title: 'Hike', date: '2026-10-01' });
  const b = await plan.addItem({ kind: 'stop', title: 'Dinner', date: '2026-10-01' });
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Hike', 'Dinner']);
  n += 1;

  await plan.nudgeItem(b.id, -1);
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Dinner', 'Hike']);
  await plan.moveTo(a.id, '2026-10-02', 0);
  assert.deepEqual(plan.byDay().get('2026-10-02').map((i) => i.title), ['Hike']);
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Dinner']);
  n += 1;

  // two people: an edit to something changed meanwhile is refused and the newer copy is loaded
  await f.t.storage.set('item:' + a.id, { ...f.store.get('item:' + a.id).value, title: 'Long hike' }, {});
  await assert.rejects(() => plan.updateItem(a.id, { notes: 'x' }), (e) => e.conflict === true);
  assert.equal(plan.list().find((i) => i.id === a.id).title, 'Long hike');
  await plan.updateItem(a.id, { notes: 'x' });
  n += 1;

  // live changes from someone else
  f.push({ key: 'item:zz', value: { kind: 'note', title: 'Bring cash', date: '2026-10-03', order: 1000 }, version: 1 });
  assert.equal(plan.byDay().get('2026-10-03').length, 1);
  f.push({ key: 'item:zz', deleted: true });
  assert.equal(plan.byDay().get('2026-10-03').length, 0);
  n += 1;

  // what other modules may ask
  plan.provide();
  await f.provided.addStop({ title: 'Winning hotel', date: '2026-10-02' });
  assert.equal(plan.byDay().get('2026-10-02').some((i) => i.title === 'Winning hotel'), true);
  const ev = { ref: { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: 'lobby' }, module: { id: 'calendar' }, title: 'Train', when: '2026-10-03' };
  const g = fakeTavern({ cards: [ev], search: [ev, { ...ev, ref: { ...ev.ref, id: 'e2' }, when: '2026-12-25' }, { ...ev, ref: { ...ev.ref, id: 'e3' }, module: { id: 'travel' } }] });
  const plan2 = lib.createPlan(g.t);
  await plan2.load();
  await plan2.saveTrip({ start: '2026-10-01', end: '2026-10-03' });
  const sug = await plan2.suggest();
  assert.deepEqual(sug.map((c) => c.ref.id), ['e1']);
  plan2.provide();
  await g.provided.addToDay({ item: ev.ref, date: null });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(plan2.byDay().get('2026-10-03').length, 1); // placed by the linked item's own day
  assert.equal((await plan2.suggest()).length, 0); // and no longer suggested
  n += 1;
};
await run();

console.log(`check-travel: OK (${n} checks)`);
