
  // The plan itself: the trip and its items, kept in the module's own store and live for everyone. No page in it,
  // so the page, the widget and the checks can all use it. Each item is its own stored value (`plan:<id>`) and the
  // trip is one (`trip`), so two people editing different items never collide; an edit to an item someone else
  // changed meanwhile is refused with `error.conflict` and the newer copy is loaded.
  function createPlan(host) {
    const objectKey = host.util.objectKey;
    const items = new Map(); // id -> { item, version, key }: `key` is where it is stored (see PLAN_PREFIX)
    const summaries = new Map(); // pointer key -> the summary of the object it points at, or { error } when it is gone or not for this viewer
    let trip = null;
    let tripVersion = null;
    let suggested = [];
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };

    const remember = (key, value, version) => {
      if (key === TRIP_KEY) {
        trip = value ? cleanTrip(value) : null;
        tripVersion = value ? version : null;
      } else {
        const id = planIdOf(key);
        if (id === null) return;
        // An item still under its old key while it has one under the new: the new one is the item.
        if (key.startsWith(OLD_PLAN_PREFIX) && items.has(id) && items.get(id).key.startsWith(PLAN_PREFIX)) return;
        const item = value ? cleanItem({ ...value, id }) : null;
        if (item) items.set(id, { item, version, key });
        else if ((items.get(id) || {}).key === key) items.delete(id);
      }
    };

    // Move one item from its old key to `plan:<id>`: written only where nothing is yet, then the old key removed as it was read.
    // Anyone else doing the same at the same time is harmless: whichever write lands second is refused. When `plan:<id>` is
    // already there with a different value, the old key is left where it is, never deleted: the plan shows the new one, and
    // nothing anyone wrote is lost.
    async function moveOld(entry) {
      const id = entry.key.slice(OLD_PLAN_PREFIX.length);
      try {
        await host.storage.set(PLAN_PREFIX + id, entry.value, { version: 0 });
      } catch (err) {
        if (!err || err.status !== 409) throw err;
        const there = await host.storage.get(PLAN_PREFIX + id);
        if (there && JSON.stringify(there.value) !== JSON.stringify(entry.value)) return;
      }
      try {
        await host.storage.delete(entry.key, { version: entry.version });
      } catch (err) {
        if (!err || err.status !== 409) throw err; // changed meanwhile (an old page still open): moved on its next change
      }
    }
    // The plan's old `item:` keys renamed to `plan:` (plan-names decision 19), once in each place, recorded under MOVED_KEY. Someone
    // who cannot edit moves nothing and records nothing; the plan reads both kinds of key, so they see it all the same.
    async function moveOldKeys() {
      try {
        if (await host.storage.get(MOVED_KEY)) return;
        for (const entry of await host.storage.list(OLD_PLAN_PREFIX)) await moveOld(entry);
        await host.storage.set(MOVED_KEY, { at: new Date().toISOString() }, { version: 0 });
      } catch (err) {
        // not allowed to write here, or it failed part way: tried again on the next load; nothing is lost meanwhile
      }
    }

    async function load() {
      await moveOldKeys();
      const t = await host.storage.get(TRIP_KEY);
      remember(TRIP_KEY, t ? t.value : null, t ? t.version : null);
      items.clear();
      for (const it of await host.storage.list(PLAN_PREFIX)) remember(it.key, it.value, it.version);
      for (const it of await host.storage.list(OLD_PLAN_PREFIX)) remember(it.key, it.value, it.version);
      changed();
      resolveSummaries().catch(() => {});
    }

    host.on('change', (e) => {
      if (e.scope === 'spaces') return;
      if (e.key !== TRIP_KEY && planIdOf(e.key) === null) return;
      remember(e.key, e.deleted ? null : e.value, e.version);
      changed();
      if (planIdOf(e.key) === null) return;
      resolveSummaries().catch(() => {});
      // An old page still open wrote under the old key: move it along, when this person may.
      if (!e.deleted && String(e.key).startsWith(OLD_PLAN_PREFIX)) moveOld({ key: e.key, value: e.value, version: e.version }).catch(() => {});
    });

    // The summaries of the objects other modules hold that this plan points at.
    // `all` asks again for every one (an object may have been changed or deleted where it lives), not just the new ones.
    async function resolveSummaries(all) {
      const want = [...items.values()].map((x) => x.item).filter((i) => i.ref && (all || !summaries.has(objectKey(i.ref)))).map((i) => i.ref);
      if (!want.length) return;
      let got;
      try {
        got = await host.objects.resolve(want);
      } catch (err) {
        if (all) return; // asking again failed: what was shown stays as it was
        got = want.map(() => ({ error: 'unavailable' }));
      }
      want.forEach((r, i) => summaries.set(objectKey(r), got[i] || { error: 'unavailable' }));
      changed();
    }

    // The day of an item: its own, or for a pointer with no place of its own the day of the object it points at. An item on the
    // line (at a joint) has no day.
    const dayOf = (item) => {
      if (item.date) return item.date;
      if (item.after !== null && item.after !== undefined) return null;
      const c = item.ref ? summaries.get(objectKey(item.ref)) : null;
      const w = c && !c.error ? summaryWhen(c) : null;
      return w ? w.day : null;
    };
    // The joint an item is at on the line ('' the head, else the day it follows), or null when it is on a day.
    const jointOf = (item) => lineOf(item, dayOf(item));

    const list = () => [...items.values()].map((x) => x.item);
    // An item as it is placed in a day: a pointer with no time of its own takes the time its object's summary gives, so it sorts
    // where that time says.
    const timed = (item) => {
      if (item.time || !item.ref) return item;
      const c = summaries.get(objectKey(item.ref));
      const w = c && !c.error ? summaryWhen(c) : null;
      return w && w.time ? { ...item, time: w.time } : item;
    };
    // The items on days (what the days see); items on the line are not among them.
    const sortable = () => list().filter((i) => jointOf(i) === null).map(timed);
    // The items on the line, in the order they are on it: by joint (the head first, then the day each follows), then by hand order.
    const onLine = () => sortLine(list().filter((i) => jointOf(i) !== null).map((i) => ({ ...i, after: jointOf(i) })));
    const atJoint = (after) => onLine().filter((i) => i.after === after);
    const days = () => tripDays(trip);
    const byDay = () => itemsByDay(sortable(), days(), dayOf);
    const nextOrder = (date) => {
      const same = sortable().filter((i) => !i.time && i.date === date);
      return same.length ? Math.max(...same.map((i) => i.order)) + 1000 : 1000;
    };
    const nextJointOrder = (after) => jointOrder(atJoint(after), null, null);

    async function saveTrip(patch) {
      const next = cleanTrip({ ...(trip || {}), ...patch, by: host.user.name });
      const saved = await host.storage.set(TRIP_KEY, next, tripVersion === null ? {} : { version: tripVersion });
      remember(TRIP_KEY, next, saved.version);
      changed();
      return trip;
    }

    async function addItem(fields) {
      const id = host.util.id();
      const onTheLine = !fields.date && (fields.after === '' || isYmd(fields.after) || fields.kind === 'lane');
      const item = cleanItem({ ...fields, id, order: fields.order ?? (onTheLine ? nextJointOrder(fields.after || '') : nextOrder(fields.date)), by: host.user.name });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      const saved = await host.storage.set(PLAN_PREFIX + id, value, {});
      items.set(id, { item, version: saved.version, key: PLAN_PREFIX + id });
      changed();
      if (item.ref) resolveSummaries().catch(() => {});
      return item;
    }

    async function updateItem(id, patch) {
      const cur = items.get(id);
      if (!cur) throw new Error(`that ${host.util.word('object')} is not here any more`);
      const item = cleanItem({ ...cur.item, ...patch, id });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      try {
        // Still under its old key (someone who could not move it loaded it): saved under the new one, and the old one goes.
        const moving = cur.key !== PLAN_PREFIX + id;
        const saved = await host.storage.set(PLAN_PREFIX + id, value, moving ? {} : { version: cur.version });
        if (moving) await host.storage.delete(cur.key).catch(() => {});
        items.set(id, { item, version: saved.version, key: PLAN_PREFIX + id });
        changed();
        return item;
      } catch (err) {
        if (err && err.status === 409) {
          const fresh = await host.storage.get(PLAN_PREFIX + id).catch(() => null);
          if (fresh) remember(fresh.key, fresh.value, fresh.version); else items.delete(id);
          changed();
          const conflict = new Error('someone changed this first');
          conflict.conflict = true;
          throw conflict;
        }
        throw err;
      }
    }

    async function removeItem(id) {
      const cur = items.get(id);
      if (!cur) return;
      await host.storage.delete(cur.key || PLAN_PREFIX + id);
      items.delete(id);
      changed();
    }

    // A round trip: the outbound, then the return pointing at it. A car cannot be one.
    async function addRoundTrip(outFields, backFields) {
      if (outFields.mode === 'car') throw new Error('A rental car cannot be a round trip.');
      const out = await addItem({ ...outFields, kind: 'journey', legOf: null });
      const back = await addItem({ ...backFields, kind: 'journey', mode: out.mode, legOf: out.id, confirm: '', cost: null, paidBy: '' });
      return { out, back };
    }
    const returnFor = (id) => returnOf(list(), id);
    const outboundFor = (item) => outboundOf(list(), item);
    // The returns of `id` beyond the first (two people added one at the same time).
    const extraReturns = (id) => (returnFor(id) ? legsOf(list(), id).slice(1) : []);
    // Deleting a leg of a round trip: both legs (and any extra return), or only this one. Only the outbound: the return becomes a
    // one-way journey and takes the booking reference, the cost and who paid, so nothing that was paid disappears. Not a leg of a
    // round trip: the item alone.
    async function removeLeg(id, both) {
      const all = list();
      const item = all.find((i) => i.id === id);
      if (!item) return;
      const out = item.legOf ? outboundOf(all, item) : item;
      const back = out ? returnOf(all, out.id) : null;
      if (!out || !back) return removeItem(id);
      if (both) {
        for (const leg of legsOf(all, out.id)) await removeItem(leg.id);
        return removeItem(out.id);
      }
      if (id === out.id) await updateItem(back.id, { legOf: null, confirm: out.confirm, cost: out.cost, paidBy: out.paidBy });
      return removeItem(id);
    }

    // Several items changed at once, from a move: { id: patch }.
    async function applyChanges(changes) {
      for (const [id, patch] of Object.entries(changes)) await updateItem(id, patch);
    }

    // Put the item at a place in a day (the drag, and "Move to..."): untimed items are ordered by hand, a timed
    // one only changes day. Coming off the line, it leaves its joint.
    async function moveTo(id, date, index) {
      const cur = items.get(id);
      if (!cur) return;
      if (timed(cur.item).time) return void (await updateItem(id, { date, after: null }));
      const dayUntimed = sortDay(sortable().filter((i) => !i.time && dayOf(i) === date && i.id !== id));
      const changes = placeUntimed(dayUntimed, cur.item, date, index);
      changes[id] = { ...(changes[id] || {}), after: null };
      await applyChanges(changes);
    }
    // Put the item at a joint on the line ('' the head), at `index` among the items already there.
    async function moveToJoint(id, after, index) {
      const cur = items.get(id);
      if (!cur) return;
      const others = atJoint(after).filter((i) => i.id !== id);
      const changes = placeUntimed(others, cur.item, null, index);
      changes[id] = { ...(changes[id] || {}), date: null, after };
      await applyChanges(changes);
    }
    // Earlier or later: on a day, the day's own rule (nudge); on the line, a swap with the neighbour at the joint, and at
    // either end of a joint a hop to the next one.
    async function nudgeItem(id, direction) {
      const cur = items.get(id);
      if (!cur) return;
      const joint = jointOf(cur.item);
      if (joint === null) {
        const day = dayOf(cur.item);
        const changes = nudge(sortDay(sortable().filter((i) => dayOf(i) === day)), timed(cur.item), direction);
        if (changes) await applyChanges(changes);
        return;
      }
      const here = atJoint(joint);
      const changes = nudge(here, { ...cur.item, time: null }, direction);
      if (changes) return void (await applyChanges(changes));
      const all = joints(days());
      const next = all[all.indexOf(joint) + direction];
      if (next === undefined) return;
      await moveToJoint(id, next, direction < 0 ? 1e6 : 0);
    }

    // A pointer to another module's object, put at a place: `{ date }` a day, `{ after }` a joint on the line, or nothing (the
    // pointed-at object's own day when it has one, else the head of the line).
    const addLink = (ref, place, title) => addItem({ kind: 'link', ref, ...placeFields(place), title: title || '' });

    // Dated objects other modules hold in this space, on days of the trip, that the plan does not already point at:
    // what the plan could take in. Nothing is stored until one is added.
    async function suggest() {
      const tripDaysList = days();
      if (!tripDaysList.length) { suggested = []; changed(); return suggested; }
      let found = [];
      try {
        found = await host.objects.search('');
      } catch (err) {
        found = [];
      }
      const pinned = new Set(list().filter((i) => i.ref).map((i) => objectKey(i.ref)));
      suggested = found.filter((c) => c && c.ref && c.module && c.module.id !== 'travel' && !pinned.has(objectKey(c.ref)) && tripDaysList.includes((summaryWhen(c) || {}).day));
      changed();
      return suggested;
    }

    // What other modules may ask of this one, and what it is when they do.
    function provide() {
      if (!host.actions || !host.actions.provide) return;
      host.actions.provide({
        addStop: async (input) => {
          const date = input.date && isYmd(input.date) ? input.date : null;
          const item = input.ref
            ? await addLink(input.ref, date, input.title)
            : await addItem({ kind: 'stop', title: input.title, date, notes: input.notes || '' });
          return { ref: host.objects.make('plan', item.id) };
        },
        addToDay: async (input) => {
          // `item` is what the input was called before the rename (a request queued then is still carried out).
          const item = await addLink(input.object || input.item, isYmd(input.date) ? input.date : null);
          return { ref: host.objects.make('plan', item.id) };
        },
        // A suggestion from anywhere (an AI's typed summary, another module's idea): placed as the right kind of item when its
        // `kind` is one of the everyday words a journey, a stay or a stop already knows (a flight, a hotel, a sight...); an
        // unrecognised or missing kind is an ordinary stop, the same as addStop. Found by name and input shape, never by
        // whoever asks for it.
        acceptSuggestion: async (input) => {
          const item = await addItem(fromSuggestion(input));
          return { ref: host.objects.make('plan', item.id) };
        },
      });
    }
    // The item a suggestion becomes ({ title, kind?, content?, place?, date? }, an AI's summary or a summary dropped here):
    // the right kind when `kind` is one of the everyday words a journey, a stay or a stop already knows, else a stop.
    function fromSuggestion(input) {
      const title = clip(input.title, 120);
      if (!title) throw new Error('that needs a title');
      const fields = { title, ...placeFields(input), notes: clip(input.content, 2000), place: clip(input.place, 120) };
      const kindWord = typeof input.kind === 'string' ? input.kind : '';
      if (MODES.includes(kindWord)) { fields.kind = 'journey'; fields.mode = kindWord; }
      else if (STAY_TYPES.includes(kindWord)) { fields.kind = 'stay'; fields.type = kindWord; }
      else if (STOP_TYPES.includes(kindWord)) { fields.kind = 'stop'; fields.type = kindWord; }
      else fields.kind = 'stop';
      return fields;
    }

    return {
      refreshSummaries: () => resolveSummaries(true), load, list, onLine, atJoint, sortable, days, byDay, dayOf, jointOf, summaries, suggest, provide, saveTrip, addItem, updateItem, removeItem, addRoundTrip, returnFor, outboundFor, extraReturns, removeLeg, applyChanges, moveTo, moveToJoint, nudgeItem, addLink, fromSuggestion,
      get trip() { return trip; },
      get suggestions() { return suggested; },
      versionOf: (id) => (items.get(id) || {}).version,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
  }
