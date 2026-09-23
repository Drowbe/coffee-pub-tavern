#!/usr/bin/env node
/*
 * check-drop.mjs -- the drop fill rules (tavern.refs.fillFor) and the shared drop decision (offersFor, dropMenu)
 * from public/sdk/tavern.js, run on their own: what a drop can fill of an action's inputs from what was dragged
 * (a pointer, or a card carried by a module with nothing stored) and what is under the pointer, and which actions
 * a drop offers at all (the dropped item's own module's, by its exact kind, doing something with what is here). See
 * documentation/plans/plan-drop.md.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sdk = fs.readFileSync(new URL('../public/sdk/tavern.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, {});

// A stub host: what actions.list and refs.resolve answer, and what was requested.
const calls = [];
const host = { actions: [], cards: {} };
const call = async (method, params) => {
  calls.push([method, params]);
  if (method === 'actions.list') return host.actions;
  if (method === 'refs.resolve') return params.refs.map((r) => host.cards[`${r.module}:${r.kind}:${r.id}`] || { ref: r, error: 'not available', status: 404 });
  if (method === 'actions.request') return { id: 'q1' };
  if (method === 'actions.status') return { status: 'done', result: { ok: true } };
  return {};
};
const { tavern } = win.createTavern({ call, root: {}, rootElement: {} });
const { fillFor } = tavern.refs;

const task = { module: 'todo', kind: 'task', id: 't1', scope: 'room', room: 'r' };
const event = { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: 'r' };
const place = { module: 'places', kind: 'place', id: 'p1', scope: 'room', room: 'r' };
const card = { title: 'Dinner at the pier', text: 'Book for four', date: '2026-10-03', place: { lat: 38.7, lng: -9.1, name: 'Pier' }, kind: 'restaurant' };

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };

await test('a plain ref input takes the dropped item; a title fills from its card', () => {
  const a = { input: { title: 'string', notes: 'text?', ref: 'ref?' } };
  assert.deepEqual(fillFor(a, { ref: task }, { card: { title: 'Book flights' } }), { title: 'Book flights', ref: task });
});

await test('a typed ref input takes only that kind', () => {
  const a = { input: { task: 'ref:todo:task', date: 'date' } };
  assert.deepEqual(fillFor(a, { ref: task }, { card: {}, date: '2026-10-03' }), { task, date: '2026-10-03' });
  assert.equal(fillFor(a, { ref: event }, { card: {}, date: '2026-10-03' }), null, 'an event is not a task');
  assert.equal(fillFor(a, { ref: task }, { card: {} }), null, 'no day under the pointer');
});

await test('a second plain ref, or one named target, takes the item under the pointer', () => {
  const link = { input: { task: 'ref:todo:task', target: 'ref' } };
  assert.deepEqual(fillFor(link, { ref: task }, { card: {}, target: event }), { task, target: event });
  assert.equal(fillFor(link, { ref: task }, { card: {} }), null, 'nothing under the pointer to link to');
  const two = { input: { a: 'ref', b: 'ref' } };
  assert.deepEqual(fillFor(two, { ref: task }, { card: {}, target: event }), { a: task, b: event });
});

await test('an action unrelated to the dropped item is never filled', () => {
  assert.equal(fillFor({ input: { date: 'date' } }, { ref: task }, { card: {}, date: '2026-10-03' }), null);
  assert.equal(fillFor({ input: { note: 'string' } }, { ref: task }, { card: { title: 'x' } }), null, 'a string not named title is not filled');
  assert.equal(fillFor({ input: { target: 'ref' } }, { ref: task }, { card: {}, target: event }), null, 'only the target was used');
});

await test('date and datetime: the day under the pointer, else the card\'s own', () => {
  const a = { input: { title: 'string', date: 'date', ref: 'ref?' } };
  assert.deepEqual(fillFor(a, { ref: task }, { card: { title: 'T' }, date: '2026-10-05' }), { title: 'T', date: '2026-10-05', ref: task });
  assert.equal(fillFor(a, { ref: task }, { card: { title: 'T' } }), null, 'a required date with none anywhere');
  assert.deepEqual(fillFor({ input: { when: 'datetime', ref: 'ref' } }, { ref: task }, { card: {}, date: '2026-10-05', time: '19:00' }), { when: '2026-10-05T19:00', ref: task });
  assert.deepEqual(fillFor({ input: { when: 'datetime', ref: 'ref' } }, { ref: task }, { card: {}, date: '2026-10-05' }), { when: '2026-10-05', ref: task });
});

await test('a place: lat and lng from the spot under the pointer, else the card\'s own place', () => {
  const pin = { input: { place: 'ref:places:place', lat: 'number', lng: 'number' } };
  assert.deepEqual(fillFor(pin, { ref: place }, { card: {}, place: { lat: 1, lng: 2 } }), { place, lat: 1, lng: 2 });
  assert.deepEqual(fillFor(pin, { ref: place }, { card: { place: { lat: 3, lng: 4 } } }), { place, lat: 3, lng: 4 });
  assert.equal(fillFor(pin, { ref: place }, { card: {} }), null, 'no position anywhere');
  assert.equal(fillFor({ input: { ref: 'ref' } }, { card }, {}), null, 'a bare card cannot fill a ref');
});

await test('a bare card (nothing stored) fills title, kind, text, date and place', () => {
  const a = { input: { title: 'string', kind: 'string?', content: 'text?', date: 'date?' } };
  assert.deepEqual(fillFor(a, { card }, {}), { title: 'Dinner at the pier', kind: 'restaurant', content: 'Book for four', date: '2026-10-03' });
  assert.deepEqual(fillFor({ input: { title: 'string', date: 'date' } }, { card }, { date: '2026-10-09' }), { title: 'Dinner at the pier', date: '2026-10-09' }, 'the day under the pointer wins');
  assert.deepEqual(fillFor({ input: { lat: 'number', lng: 'number', title: 'string' } }, { card }, {}), { lat: 38.7, lng: -9.1, title: 'Dinner at the pier' });
});

await test('a bare pointer is accepted as well as { ref }', () => {
  assert.deepEqual(fillFor({ input: { ref: 'ref' } }, task, {}), { ref: task });
  assert.equal(fillFor({ input: { ref: 'ref' } }, { module: 'x' }, {}), null, 'not a pointer');
});

// What a drop offers beyond the target's own: the dropped item's own module's actions, by its exact kind, using something
// from under the pointer. Every other module's action is left out, however well it fills.
host.cards['todo:task:t1'] = { ref: task, title: 'Book flights', kind: 'task', module: { id: 'todo', icon: 'list-check' } };
host.cards['places:place:p1'] = { ref: place, title: 'The pier', kind: 'place', module: { id: 'places', icon: 'location-dot' }, place: { lat: 3, lng: 4 } };
const ALL = [
  { action: 'calendar:createEvent', module: 'calendar', icon: 'calendar-days', label: 'Add it to the calendar', moduleName: 'Calendar', input: { title: 'string', date: 'date', ref: 'ref?' } },
  { action: 'research:saveNote', module: 'research', icon: 'book', label: 'Save a note', moduleName: 'Research', input: { title: 'string', body: 'text?', ref: 'ref?' } },
  { action: 'todo:createTask', module: 'todo', icon: 'list-check', label: 'Add a task', moduleName: 'To-do', input: { title: 'string', ref: 'ref?' } },
  { action: 'todo:setTaskDue', module: 'todo', icon: 'list-check', label: 'Set its due date', moduleName: 'To-do', input: { task: 'ref:todo:task', date: 'date' } },
  { action: 'todo:linkTask', module: 'todo', icon: 'list-check', label: 'Link it', moduleName: 'To-do', input: { task: 'ref:todo:task', target: 'ref' } },
  { action: 'places:setPlacePoint', module: 'places', icon: 'location-dot', label: 'Move the pin', moduleName: 'Places', input: { place: 'ref:places:place', lat: 'number', lng: 'number' } },
  { action: 'maps:showOnMap', module: 'maps', icon: 'map', label: 'Show on the map', moduleName: 'Maps', input: { ref: 'ref' }, needs: ['place'] },
];

await test('offersFor: only the dropped item\'s own module\'s actions, by its exact kind, using what is under the pointer', async () => {
  host.actions = ALL;
  calls.length = 0;
  const onDay = await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' });
  assert.deepEqual(onDay.map((o) => o.id), ['todo:setTaskDue'], 'a task on a day: its due date, and not an event, a note, another task or the map');
  assert.deepEqual(onDay[0].input, { task, date: '2026-10-03' });
  assert.equal(onDay[0].icon, 'list-check', 'an offer wears its module\'s icon');
  assert.deepEqual(calls.find((c) => c[0] === 'actions.list')[1], { accepts: 'todo:task', self: false });
  const onEvent = await tavern.refs.offersFor({ ref: task }, { target: event, date: '2026-10-03' });
  assert.deepEqual(onEvent.map((o) => o.id), ['todo:setTaskDue', 'todo:linkTask'], 'on an event: its due date, and linking it to the event');
  const nowhere = await tavern.refs.offersFor({ ref: task }, {});
  assert.deepEqual(nowhere, [], 'nothing under the pointer: nothing to offer beyond the target\'s own');
  const onMap = await tavern.refs.offersFor({ ref: place }, { place: { lat: 1, lng: 2 } });
  assert.deepEqual(onMap.map((o) => o.id), ['places:setPlacePoint'], 'a place on a spot of the map: put it there');
  assert.deepEqual(await tavern.refs.offersFor({ card }, { date: '2026-10-03' }), [], 'a carried card has no module of its own: only the target\'s own offers');
});

await test('offersFor: an action declaring what the item `needs` is left out for an item without it', async () => {
  host.actions = [{ action: 'todo:setTaskDue', module: 'todo', label: 'Set its due date', moduleName: 'To-do', input: { task: 'ref:todo:task', date: 'date' }, needs: ['place'] }];
  assert.deepEqual(await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' }), []);
  host.cards['todo:task:t1'].place = { lat: 1, lng: 2 };
  assert.deepEqual((await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' })).map((o) => o.id), ['todo:setTaskDue']);
  delete host.cards['todo:task:t1'].place;
});

await test('offersFor: an item the viewer may not see stops with its error', async () => {
  await assert.rejects(tavern.refs.offersFor({ ref: { ...task, id: 'gone' } }, {}), /not available/);
});

await test('dropMenu: own offers first (wearing the module\'s icon), remembered under the dropped kind; one offer runs at once', async () => {
  host.actions = ALL;
  const ran = [];
  const picked = [];
  tavern.actions.pick = async (items, at, o) => { picked.push({ items: items.map((i) => [i.label, i.icon]), remember: o && o.remember }); return items[0]; };
  const own = [{ id: 'put', label: 'Put it on Oct 3', run: (ctx) => ran.push(ctx.card.title) }];
  const chosen = await tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: { date: '2026-10-03' }, own, remember: 'day' });
  assert.equal(chosen.id, 'put');
  assert.deepEqual(ran, ['Book flights'], 'the own offer saw the resolved card');
  assert.deepEqual(picked[0], { items: [['Put it on Oct 3', undefined], ['Set its due date', 'list-check']], remember: 'todo:task:day' });
  picked.length = 0;
  const alone = await tavern.refs.dropMenu({ card }, { x: 1, y: 1 }, { context: {}, own: [{ id: 'put', label: 'Put it here', run: (ctx) => ran.push(ctx.card.kind) }] });
  assert.equal(alone.id, 'put');
  assert.deepEqual(picked, [{ items: [['Put it here', undefined]], remember: undefined }], 'one offer: pick gets just it (and, for real, resolves it at once without drawing)');
  assert.deepEqual(ran, ['Book flights', 'restaurant'], 'a carried card reaches the own offer as the card');
});

await test('dropMenu: an own offer whose `when` says no is left out; an action chosen is requested with its filled input; nothing at all throws', async () => {
  host.actions = ALL;
  tavern.actions.pick = async (items) => items[items.length - 1];
  const own = [{ id: 'save', label: 'Save it as a place', when: (ctx) => Boolean(ctx.card.place), run: () => {} }];
  calls.length = 0;
  const chosen = await tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: { date: '2026-10-03' }, own, wait: false });
  assert.equal(chosen.id, 'todo:setTaskDue', 'the own offer was left out (no place), the due date remained');
  assert.deepEqual(calls.find((c) => c[0] === 'actions.request')[1], { action: 'todo:setTaskDue', input: { task, date: '2026-10-03' } });
  await assert.rejects(tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: {}, own }), /Nothing can be done/);
});

await Promise.resolve();
console.log(`check-drop: OK (${n} checks)`);
