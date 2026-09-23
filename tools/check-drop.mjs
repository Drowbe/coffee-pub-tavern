#!/usr/bin/env node
/*
 * check-drop.mjs -- the drop fill rules (tavern.refs.fillFor) and the shared drop decision (offersFor, dropMenu)
 * from public/sdk/tavern.js, run on their own: what a drop can fill of an action's inputs from what was dragged
 * (a pointer, or a card carried by a module with nothing stored) and what is under the pointer. See
 * documentation/plans/plan-drop.md, "The drop context".
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

await test('an action unrelated to the dropped item is never offered', () => {
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

await test('offersFor: resolves the card, asks for the actions that take the kind, keeps the ones that fill', async () => {
  host.cards['todo:task:t1'] = { ref: task, title: 'Book flights', kind: 'task', module: { id: 'todo' } };
  host.actions = [
    { action: 'calendar:createEvent', label: 'Add to the calendar', moduleName: 'Calendar', input: { title: 'string', date: 'date', ref: 'ref?' } },
    { action: 'research:saveNote', label: 'Save a note', moduleName: 'Research', input: { title: 'string', body: 'text?', ref: 'ref?' } },
    { action: 'places:setPlacePoint', label: 'Move the pin', moduleName: 'Places', input: { place: 'ref:places:place', lat: 'number', lng: 'number' } },
  ];
  calls.length = 0;
  const offers = await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' });
  assert.deepEqual(offers.map((o) => o.id), ['calendar:createEvent', 'research:saveNote']);
  assert.deepEqual(offers[0].input, { title: 'Book flights', date: '2026-10-03', ref: task });
  assert.deepEqual(calls.find((c) => c[0] === 'actions.list')[1], { accepts: 'todo:task', self: false });
  const noDay = await tavern.refs.offersFor({ ref: task }, {});
  assert.deepEqual(noDay.map((o) => o.id), ['research:saveNote'], 'createEvent needs a day');
});

await test('offersFor: an item the viewer may not see stops with its error', async () => {
  await assert.rejects(tavern.refs.offersFor({ ref: { ...task, id: 'gone' } }, {}), /not available/);
});

await test('dropMenu: own offers first; one offer runs at once; an action is requested with its filled input', async () => {
  const ran = [];
  // Two offers (own + saveNote) would need a person to choose; there is no page here, so pick takes the first.
  const picked = [];
  tavern.actions.pick = async (items, at, o) => { picked.push({ labels: items.map((i) => i.label), remember: o && o.remember }); return items[0]; };
  const own = await tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: {}, own: [{ id: 'link', label: 'Link it here', run: (ctx) => ran.push(ctx.card.title) }], remember: 'task' });
  assert.equal(own.id, 'link');
  assert.deepEqual(picked[0], { labels: ['Link it here', 'Save a note'], remember: 'todo:task:task' }, 'own offers first, remembered under the dropped kind');
  assert.deepEqual(ran, ['Book flights']);
  calls.length = 0;
  const requested = await tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: {}, wait: false });
  assert.equal(requested.id, 'research:saveNote');
  assert.deepEqual(calls.find((c) => c[0] === 'actions.request')[1], { action: 'research:saveNote', input: { title: 'Book flights', ref: task } });
  host.actions = [];
  await assert.rejects(tavern.refs.dropMenu({ ref: task }, { x: 1, y: 1 }, { context: {} }), /Nothing can be done/);
});

await test('dropMenu: an own offer whose `when` says no for this card is left out; a bare card reaches the offers', async () => {
  host.actions = [{ action: 'travel:acceptSuggestion', label: 'Add to the plan', moduleName: 'Planner', input: { title: 'string', kind: 'string?', content: 'text?', date: 'date?' } }];
  calls.length = 0;
  const seen = [];
  tavern.actions.pick = async (items) => { seen.push(items.map((i) => i.label)); return items[items.length - 1]; }; // the action, not the own offer
  const own = [{ id: 'save', label: 'Save it as a place', when: (ctx) => Boolean(ctx.card.place), run: () => {} }];
  await tavern.refs.dropMenu({ card: { title: 'No place' } }, { x: 1, y: 1 }, { context: {}, own, wait: false });
  await tavern.refs.dropMenu({ card }, { x: 1, y: 1 }, { context: {}, own, wait: false });
  assert.deepEqual(seen, [['Add to the plan'], ['Save it as a place', 'Add to the plan']]);
  assert.deepEqual(calls.filter((c) => c[0] === 'actions.request').pop()[1].input, { title: 'Dinner at the pier', kind: 'restaurant', content: 'Book for four', date: '2026-10-03' }, 'a carried card fills the action');
  assert.equal(calls.some((c) => c[0] === 'actions.list' && c[1].accepts), false, 'a bare card asks for every action, not one kind');
});

await test('offersFor: an action declaring what the item `needs` is left out for an item without it; an action of the item\'s own module taking it only as any ref is left out too', async () => {
  host.cards['todo:task:t1'] = { ref: task, title: 'Book flights', kind: 'task', module: { id: 'todo' } };
  host.actions = [
    { action: 'maps:showOnMap', module: 'maps', label: 'Show on the map', moduleName: 'Maps', input: { ref: 'ref' }, needs: ['place'] },
    { action: 'todo:createTask', module: 'todo', label: 'Add a task', moduleName: 'To-do', input: { title: 'string', ref: 'ref?' } },
    { action: 'todo:setTaskDue', module: 'todo', label: 'Set its due date', moduleName: 'To-do', input: { task: 'ref:todo:task', date: 'date' } },
    { action: 'research:saveNote', module: 'research', label: 'Save a note', moduleName: 'Research', input: { title: 'string', ref: 'ref?' } },
  ];
  const offers = await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' });
  assert.deepEqual(offers.map((o) => o.id), ['todo:setTaskDue', 'research:saveNote']);
  host.cards['todo:task:t1'].place = { lat: 1, lng: 2 };
  const withPlace = await tavern.refs.offersFor({ ref: task }, { date: '2026-10-03' });
  assert.deepEqual(withPlace.map((o) => o.id), ['maps:showOnMap', 'todo:setTaskDue', 'research:saveNote'], 'with a position, the map is offered');
  delete host.cards['todo:task:t1'].place;
});

await Promise.resolve();
console.log(`check-drop: OK (${n} checks)`);
