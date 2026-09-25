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
const names = ['bookings', 'balances', 'cardWhen', 'TRIP_KEY', 'createPlan', 'cleanTrip', 'cleanItem', 'tripDays', 'dayLabel', 'daysUntil', 'sortDay', 'itemsByDay', 'orderBetween', 'renumber', 'placeUntimed', 'nudge', 'gapMinutes', 'gapText', 'stayNights', 'MODES', 'STOP_TYPES', 'STAY_TYPES', 'TRAVEL_MODES', 'jointOrder', 'lineOf', 'joints', 'sortLine', 'placeFields', 'tripBounds', 'tileOf', 'fromTile', 'cardOf', 'TILES', 'LEG_ICONS', 'JOURNEY_TILES', 'KICKERS', 'BADGES', 'splitMinutes', 'joinMinutes'];
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

test('a card says when in a day, a moment or milliseconds', () => {
  assert.deepEqual(lib.cardWhen({ when: '2026-10-03' }), { day: '2026-10-03', time: '' });
  const d = new Date(2026, 9, 3, 18, 30);
  assert.deepEqual(lib.cardWhen({ when: d.toISOString() }), { day: '2026-10-03', time: '18:30' });
  assert.deepEqual(lib.cardWhen({ when: d.getTime() }), { day: '2026-10-03', time: '18:30' });
  assert.deepEqual(lib.cardWhen({ when: new Date(2026, 9, 3, 0, 0).getTime() }), { day: '2026-10-03', time: '' }); // local midnight: no time of day
  assert.deepEqual(lib.cardWhen({ when: d.toISOString(), allDay: true }), { day: '2026-10-03', time: '' });
  assert.equal(lib.cardWhen({}), null);
  assert.equal(lib.cardWhen({ when: 'soon' }), null);
});

test('bookings are stays and journeys by date and time', () => {
  const list = [it('a', { kind: 'stop', date: '2026-10-01' }), it('s', { kind: 'stay', date: '2026-10-02' }), it('j2', { kind: 'journey', date: '2026-10-01', time: '18:00' }), it('j1', { kind: 'journey', date: '2026-10-01', time: '08:00' })];
  assert.deepEqual(lib.bookings(list).map((i) => i.id), ['j1', 'j2', 's']);
});

test('balances share a cost among its owners (or everyone) and settle in the fewest payments', () => {
  const people = ['a', 'b', 'c'];
  const dinner = it('d', { cost: 90, paidBy: 'a' }); // shared by all three: 30 each
  const taxi = it('t', { cost: 20, paidBy: 'b', owners: ['b', 'c'] }); // 10 each
  const r = lib.balances([dinner, taxi, it('free')], people);
  assert.equal(r.total, 110);
  assert.deepEqual(r.net, { a: 60, b: -20, c: -40 });
  assert.deepEqual(r.payments.map((p) => [p.from, p.to, p.amount]), [['c', 'a', 40], ['b', 'a', 20]]);
  // odd cents are handed out, not lost
  const odd = lib.balances([it('o', { cost: 10, paidBy: 'a' })], people);
  assert.equal(Math.round((odd.share.a + odd.share.b + odd.share.c) * 100), 1000);
  assert.equal(lib.balances([it('x', { cost: 5 })], people).total, 0); // no payer: not counted
});

test('a trip has an optional three-letter currency, an item an optional cost', () => {
  assert.equal(lib.cleanTrip({ start: '2026-10-01', currency: 'eur' }).currency, 'EUR');
  assert.equal(lib.cleanTrip({ start: '2026-10-01', currency: 'euros' }).currency, '');
  assert.equal(it('c', { cost: 12.345 }).cost, 12.35);
  assert.equal(it('c', { cost: -3 }).cost, null);
});

// --- the plan, against a small stand-in for the SDK -------------------------------------------------------------

function fakeHost({ cards = [], search = [] } = {}) {
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
  const f = fakeHost();
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

  // a pointer with a card time sorts by it
  const evc = { ref: { module: 'calendar', kind: 'event', id: 'ev9', scope: 'room', room: 'lobby' }, module: { id: 'calendar' }, title: 'Dinner', when: new Date(2026, 9, 1, 20, 0).toISOString() };
  const h = fakeHost({ cards: [evc] });
  const plan3 = lib.createPlan(h.t);
  await plan3.load();
  await plan3.saveTrip({ start: '2026-10-01', end: '2026-10-02' });
  await plan3.addItem({ kind: 'stop', title: 'Lunch', date: '2026-10-01', time: '13:00' });
  await plan3.addItem({ kind: 'stop', title: 'Museum', date: '2026-10-01', time: '15:00' });
  await plan3.addLink(evc.ref, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plan3.byDay().get('2026-10-01').map((i) => i.title || 'link'), ['Lunch', 'Museum', 'link']);
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
  // acceptSuggestion: a recognised kind becomes the right sort of item; anything else (or none) is a plain stop
  await assert.rejects(() => f.provided.acceptSuggestion({ title: '' }));
  await f.provided.acceptSuggestion({ title: 'LIS to FAO', kind: 'flight', date: '2026-10-01', content: 'window seat', place: 'Lisbon airport' });
  const flight = plan.list().find((i) => i.title === 'LIS to FAO');
  assert.equal(flight.kind, 'journey');
  assert.equal(flight.mode, 'flight');
  assert.equal(flight.category, 'travel');
  assert.equal(flight.notes, 'window seat');
  assert.equal(flight.place, 'Lisbon airport');
  await f.provided.acceptSuggestion({ title: 'Seaside Inn', kind: 'hotel', date: '2026-10-01' });
  const stay = plan.list().find((i) => i.title === 'Seaside Inn');
  assert.equal(stay.kind, 'stay');
  assert.equal(stay.type, 'hotel');
  await f.provided.acceptSuggestion({ title: 'The old town', kind: 'sight', date: '2026-10-01' });
  const sight = plan.list().find((i) => i.title === 'The old town');
  assert.equal(sight.kind, 'stop');
  assert.equal(sight.type, 'sight');
  await f.provided.acceptSuggestion({ title: 'A surprise' });
  const plain = plan.list().find((i) => i.title === 'A surprise');
  assert.equal(plain.kind, 'stop');
  assert.equal(plain.type, null);
  await f.provided.acceptSuggestion({ title: 'Something odd', kind: 'nonsense' });
  assert.equal(plan.list().find((i) => i.title === 'Something odd').kind, 'stop');
  const ev = { ref: { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: 'lobby' }, module: { id: 'calendar' }, title: 'Train', when: '2026-10-03' };
  const g = fakeHost({ cards: [ev], search: [ev, { ...ev, ref: { ...ev.ref, id: 'e2' }, when: '2026-12-25' }, { ...ev, ref: { ...ev.ref, id: 'e3' }, module: { id: 'travel' } }] });
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

test('details for the cards: a journey has a mode, a stop and a stay a type, any item a leg to it', () => {
  const f = lib.cleanItem({ id: 'f', kind: 'journey', title: 'LIS to FAO', mode: 'flight', operator: 'TAP', number: 'tp 1234', fromCode: 'lis!', toCode: 'fao', terminal: '1', seat: '12A', travelClass: 'economy' });
  assert.equal(f.mode, 'flight');
  assert.equal(f.fromCode, 'LIS');
  assert.equal(f.number, 'tp 1234');
  assert.equal(f.seat, '12A');
  assert.equal(lib.cleanItem({ id: 'j', kind: 'journey', title: 'x', mode: 'rocket' }).mode, 'other');
  assert.equal(lib.cleanItem({ id: 'j', kind: 'journey', title: 'x' }).mode, 'other');
  const t = lib.cleanItem({ id: 't', kind: 'journey', title: 'x', mode: 'train', operator: 'CP', platform: '4', carriage: '7' });
  assert.equal(t.platform, '4');
  assert.equal(t.carriage, '7');
  const c = lib.cleanItem({ id: 'c', kind: 'journey', title: 'x', mode: 'car', pickup: 'Airport', dropoff: 'Lisbon' });
  assert.equal(c.pickup, 'Airport');
  const meal = lib.cleanItem({ id: 'm', kind: 'stop', title: 'Dinner', type: 'restaurant', partySize: 4.4, reservationName: 'Ann', admissionCount: 0 });
  assert.equal(meal.type, 'restaurant');
  assert.equal(meal.partySize, 4);
  assert.equal(meal.reservationName, 'Ann');
  assert.equal(meal.admissionCount, null);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'x', type: 'casino' }).type, null);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'x', mode: 'flight' }).mode, undefined);
  const show = lib.cleanItem({ id: 'e', kind: 'stop', title: 'Fado', type: 'show', admissionCount: 2, gate: 'b' });
  assert.equal(show.admissionCount, 2);
  const stay = lib.cleanItem({ id: 'h', kind: 'stay', title: 'Hotel', type: 'hotel', roomType: 'double', guests: 2 });
  assert.equal(stay.type, 'hotel');
  assert.equal(stay.guests, 2);
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', checkOutTime: '11:00' }).checkOutTime, '11:00');
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', checkOutTime: '25:00' }).checkOutTime, null);
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', type: 'igloo' }).type, null);
  const leg = lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'walk', travelMinutes: 12.4 });
  assert.equal(leg.travelMode, 'walk');
  assert.equal(leg.travelMinutes, 12);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'teleport', travelMinutes: -5 }).travelMode, null);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'teleport', travelMinutes: -5 }).travelMinutes, null);
  assert.equal(lib.MODES.length, 9);
  assert.ok(lib.STOP_TYPES.includes('cafe') && lib.STAY_TYPES.includes('camp') && lib.TRAVEL_MODES.includes('none'));
});

test('what an item is: its editor tile, the fields a tile decides, and its card', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', ...o });
  assert.equal(lib.tileOf(it({ kind: 'journey', mode: 'flight' })), 'flight');
  assert.equal(lib.tileOf(it({ kind: 'journey' })), 'bus');
  assert.equal(lib.tileOf(it({ kind: 'stay' })), 'hotel');
  assert.equal(lib.tileOf(it({ kind: 'note' })), 'note');
  assert.equal(lib.tileOf(it({ kind: 'stop', type: 'cafe' })), 'cafe');
  assert.equal(lib.tileOf(it({ kind: 'stop', type: 'hike' })), 'tour');
  assert.equal(lib.tileOf(it({ kind: 'stop', category: 'eat' })), 'restaurant');
  assert.equal(lib.tileOf(it({ kind: 'stop', category: 'do' })), 'sight');
  assert.equal(lib.tileOf(null), 'sight');
  assert.deepEqual(lib.fromTile('flight'), { kind: 'journey', mode: 'flight', category: 'travel' });
  assert.deepEqual(lib.fromTile('cafe'), { kind: 'stop', type: 'cafe', category: 'eat' });
  assert.deepEqual(lib.fromTile('museum'), { kind: 'stop', type: 'museum', category: 'do' });
  assert.deepEqual(lib.fromTile('note'), { kind: 'note', category: 'other' });
  assert.equal(lib.fromTile('tour', it({ kind: 'stop', type: 'hike' })).type, 'hike');
  assert.equal(lib.fromTile('sight', it({ kind: 'stop', type: 'hike' })).type, 'sight');
  assert.equal(lib.fromTile('hotel', it({ kind: 'stay', type: 'camp' })).type, 'camp');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'train' })).card, 'train');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'ferry' })).card, 'transit');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'ferry' })).badge, 'ship');
  assert.equal(lib.cardOf(it({ kind: 'journey' })).family, 'bus');
  assert.equal(lib.cardOf(it({ kind: 'stay', type: 'hostel' })).kicker, 'Hostel');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'bar' })).card, 'meal');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'spa' })).family, 'sight');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'show' })).card, 'show');
  assert.equal(lib.cardOf(it({ kind: 'stop', category: 'eat' })).family, 'restaurant');
  assert.equal(lib.cardOf(it({ kind: 'stop', category: 'other' })).kicker, 'Stop');
  assert.equal(lib.cardOf(it({ kind: 'note' })).card, 'note');
  assert.equal(lib.cardOf({ kind: 'link' }, { kind: 'place', title: 'x' }).card, 'place');
  assert.equal(lib.cardOf({ kind: 'link' }, { kind: 'event', title: 'x' }).card, 'link');
  assert.equal(lib.cardOf({ kind: 'link' }, { error: 'gone' }).card, 'link');
  assert.ok(lib.TILES.every((t) => lib.tileOf(it(lib.fromTile(t))) === t), 'every tile round-trips');
  assert.equal(lib.LEG_ICONS.walk, 'person-walking');
});

test('where the trip starts and ends: the first and last booked item', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', order: 1, ...o });
  assert.equal(lib.tripBounds([]), null);
  assert.equal(lib.tripBounds([it({ id: 'n', kind: 'note', date: '2026-10-03' }), it({ id: 'u', kind: 'stop', date: '2026-10-03' })]), null, 'untimed stops and notes are not booked');
  const items = [
    it({ id: 'dinner', kind: 'stop', date: '2026-10-03', time: '20:00' }),
    it({ id: 'flight', kind: 'journey', mode: 'flight', date: '2026-10-03', time: '08:10', minutes: 65 }),
    it({ id: 'hotel', kind: 'stay', date: '2026-10-03', checkOut: '2026-10-05', checkOutTime: '11:00' }),
    it({ id: 'home', kind: 'journey', mode: 'flight', date: '2026-10-05', time: '15:00', minutes: 120 }),
    it({ id: 'idea', kind: 'stop', date: null, time: '01:00' }),
  ];
  const b = lib.tripBounds(items);
  assert.deepEqual(b.start, { id: 'flight', day: '2026-10-03', time: '08:10' });
  assert.deepEqual(b.end, { id: 'home', day: '2026-10-05', time: '17:00' });
  const stayLast = lib.tripBounds([items[2]]);
  assert.deepEqual(stayLast.end, { id: 'hotel', day: '2026-10-05', time: '11:00' });
  const fallback = lib.tripBounds([it({ id: 'a', kind: 'stop', date: '2026-10-04', time: '09:00' }), it({ id: 'b', kind: 'stop', date: '2026-10-04', time: '18:00', minutes: 30 })]);
  assert.equal(fallback.start.id, 'a');
  assert.deepEqual(fallback.end, { id: 'b', day: '2026-10-04', time: '18:30' });
  assert.equal(lib.tripBounds([it({ id: 'c', kind: 'stop', date: '2026-10-04', confirm: 'XY1' })]).start.id, 'c', 'anything with a confirmation is booked');
});

test('a time block is an item with a marker type and no place', () => {
  const b = lib.cleanItem({ id: 'b', kind: 'block', type: 'free-time', title: ' ', date: '2026-10-03', time: '14:00', minutes: 90 });
  assert.equal(b.kind, 'block');
  assert.equal(b.type, 'free-time');
  assert.equal(b.title, '');
  assert.equal(b.minutes, 90);
  assert.equal(lib.cleanItem({ id: 'b', kind: 'block', title: 'x' }), null, 'a block needs a type');
  assert.equal(lib.cleanItem({ id: 'b', kind: 'block', type: 'Bad Type' }), null);
  assert.equal(lib.tileOf(b), 'block:free-time');
  assert.deepEqual(lib.fromTile('block:rest'), { kind: 'block', type: 'rest', category: 'other' });
  assert.equal(lib.cardOf(b).card, 'block');
  assert.equal(lib.tripBounds([b, lib.cleanItem({ id: 'j', kind: 'journey', title: 'x', date: '2026-10-04', time: '09:00' })]).start.id, 'j', 'a block is never the start of the trip');
});

test('a marker between the days follows a day and has no time', () => {
  const l = lib.cleanItem({ id: 'l', kind: 'lane', type: 'free-time', title: '', after: '2026-10-04', date: '2026-10-09', time: '10:00', minutes: 30, notes: 'n' });
  assert.equal(l.kind, 'lane');
  assert.equal(l.after, '2026-10-04');
  assert.equal(l.date, null);
  assert.equal(l.time, null);
  assert.equal(l.minutes, null);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', type: 'rest', after: 'nope' }).after, '', 'the head of the line');
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', type: 'rest', after: null }).after, '', 'a stored null reads as the head');
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', title: 'x' }), null, 'a marker needs a type');
  assert.equal(lib.tileOf(l), 'lane:free-time');
  assert.deepEqual(lib.fromTile('lane:rest'), { kind: 'lane', type: 'rest', category: 'other' });
  assert.equal(lib.cardOf(l).card, 'lane');
});

test('an item is on a day or at a joint, never both; nothing is read as the head or the borrowed day', () => {
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', date: '2026-10-01', after: '2026-10-01' }).after, null, 'a day clears the joint');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: '2026-10-01' }).after, '2026-10-01');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: '' }).after, '', 'the head');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x' }).after, null, 'nowhere in particular');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: 'nope' }).after, null);
  assert.equal(lib.lineOf({ after: '2026-10-02' }, null), '2026-10-02');
  assert.equal(lib.lineOf({ after: '' }, null), '');
  assert.equal(lib.lineOf({ after: null, date: '2026-10-02' }, '2026-10-02'), null, 'on a day');
  assert.equal(lib.lineOf({ after: null }, '2026-10-02'), null, 'a pointer borrowing its day');
  assert.equal(lib.lineOf({ after: null }, null), '', 'an old idea is at the head');
  assert.deepEqual(lib.joints(['2026-10-01', '2026-10-02']), ['', '2026-10-01', '2026-10-02']);
  assert.deepEqual(lib.sortLine([{ id: 'b', after: '2026-10-01', order: 1000 }, { id: 'a', after: '', order: 2000 }, { id: 'c', after: '', order: 1000 }]).map((i) => i.id), ['c', 'a', 'b']);
  assert.deepEqual(lib.placeFields({ date: '2026-10-01' }), { date: '2026-10-01', after: null });
  assert.deepEqual(lib.placeFields({ after: '' }), { date: null, after: '' });
  assert.deepEqual(lib.placeFields({ after: '2026-10-01' }), { date: null, after: '2026-10-01' });
  assert.deepEqual(lib.placeFields(null), { date: null, after: null });
  assert.deepEqual(lib.placeFields({ date: 'nope', after: 'nope' }), { date: null, after: null });
});

test('an item dropped among others at a joint gets an order between its neighbours', () => {
  const others = [{ id: 'a', order: 1000 }, { id: 'b', order: 2000 }];
  assert.equal(lib.jointOrder([], null, null), 1000);
  assert.equal(lib.jointOrder(others, null, null), 3000, 'at the end');
  assert.equal(lib.jointOrder(others, 'a', 'before'), 0);
  assert.equal(lib.jointOrder(others, 'a', 'after'), 1500);
  assert.equal(lib.jointOrder(others, 'b', 'before'), 1500);
  assert.equal(lib.jointOrder(others, 'b', 'after'), 3000);
});

test('a length is typed as hours and minutes and stored as minutes, and shown as "8 h 15 min"', () => {
  assert.deepEqual(lib.splitMinutes(495), { hours: 8, minutes: 15 });
  assert.deepEqual(lib.splitMinutes(45), { hours: null, minutes: 45 });
  assert.deepEqual(lib.splitMinutes(120), { hours: 2, minutes: null });
  assert.deepEqual(lib.splitMinutes(null), { hours: null, minutes: null });
  assert.equal(lib.joinMinutes(8, 15), 495);
  assert.equal(lib.joinMinutes(8, null), 480);
  assert.equal(lib.joinMinutes(null, 90), 90, 'minutes past 59 still count');
  assert.equal(lib.joinMinutes(null, null), null, 'nothing entered');
  assert.equal(lib.joinMinutes(0, 0), null);
  assert.equal(lib.joinMinutes(30, 0), 24 * 60, 'at most a day, as cleanItem keeps');
  assert.equal(lib.gapText(495), '8 h 15 min');
  assert.equal(lib.gapText(480), '8 h');
  // A length saved before (whole minutes) reads back the same: the stored shape did not change.
  assert.equal(lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'x', minutes: 495 }).minutes, 495);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'taxi', travelMinutes: 20 }).travelMinutes, 20);
});

test('taxi, ride share and shuttle are journeys with a tile and a card, and ride share is a way to a stop', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', ...o });
  for (const mode of ['taxi', 'rideshare', 'shuttle']) {
    assert.ok(lib.MODES.includes(mode) && lib.JOURNEY_TILES.includes(mode) && lib.TILES.includes(mode), mode);
    assert.equal(it({ kind: 'journey', mode }).mode, mode);
    assert.equal(lib.tileOf(it({ kind: 'journey', mode })), mode);
    assert.deepEqual(lib.fromTile(mode), { kind: 'journey', mode, category: 'travel' });
    const c = lib.cardOf(it({ kind: 'journey', mode }));
    assert.equal(c.card, 'transit');
    assert.equal(c.family, mode);
    assert.ok(c.kicker && c.badge, mode);
  }
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'rideshare' })).kicker, 'Ride share');
  assert.ok(lib.TRAVEL_MODES.includes('rideshare') && lib.LEG_ICONS.rideshare);
});

test('the page: every journey kind has its tile and colours, lengths are hours and minutes, a stay checks out on any date', () => {
  const html = read('travel.html');
  const cards = read('travel-lib-cards.css');
  const editor = read('travel-lib-editor.css');
  for (const t of lib.JOURNEY_TILES) {
    assert.ok(html.includes(`class="tile" type="button" data-type="${t}"`), `a tile for ${t}`);
    assert.ok(cards.includes(`.entry[data-type="${t}"]`), `a card colour for ${t}`);
    assert.ok(editor.includes(`.tile[data-type="${t}"]`), `a tile colour for ${t}`);
  }
  for (const m of Object.keys(lib.LEG_ICONS)) assert.ok(html.includes(`data-mode="${m}"`), `a way-to-a-stop button for ${m}`);
  assert.ok(!/\(minutes\)|Minutes from/.test(html), 'no length is asked for in minutes alone');
  for (const id of ['f-hours', 'f-minutes', 'f-travelHours', 'f-travelMinutes']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="f-checkout" name="checkOut" type="date"/, 'a checkout is a date, not a list of the trip\'s days');
  assert.ok(html.includes('<span class="side">Departs</span>') && html.includes('<span class="side">Arrives</span>'), 'a flight card says which end departs and which arrives');
});

console.log(`check-travel: OK (${n} checks)`);
