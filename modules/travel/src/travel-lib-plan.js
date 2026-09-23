
  // The plan itself: the trip and its items, kept in the module's own store and live for everyone. No page in it,
  // so the page, the widget and the checks can all use it. Each item is its own stored value (`item:<id>`) and the
  // trip is one (`trip`), so two people editing different items never collide; an edit to an item someone else
  // changed meanwhile is refused with `error.conflict` and the newer copy is loaded.
  function createPlan(tavern) {
    const refKey = tavern.util.refKey;
    const items = new Map(); // id -> { item, version }
    const cards = new Map(); // pointer key -> card, or { error } when it is gone or not for this viewer
    let trip = null;
    let tripVersion = null;
    let suggested = [];
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };

    const remember = (key, value, version) => {
      if (key === TRIP_KEY) {
        trip = value ? cleanTrip(value) : null;
        tripVersion = value ? version : null;
      } else if (key.startsWith('item:')) {
        const item = value ? cleanItem({ ...value, id: key.slice(5) }) : null;
        if (item) items.set(item.id, { item, version });
        else items.delete(key.slice(5));
      }
    };

    async function load() {
      const t = await tavern.storage.get(TRIP_KEY);
      remember(TRIP_KEY, t ? t.value : null, t ? t.version : null);
      items.clear();
      for (const it of await tavern.storage.list('item:')) remember(it.key, it.value, it.version);
      changed();
      resolveCards().catch(() => {});
    }

    tavern.on('change', (e) => {
      if (e.scope === 'rooms') return;
      if (e.key !== TRIP_KEY && !String(e.key).startsWith('item:')) return;
      remember(e.key, e.deleted ? null : e.value, e.version);
      changed();
      if (String(e.key).startsWith('item:')) resolveCards().catch(() => {});
    });

    // The cards of the items other modules hold that this plan points at.
    // `all` asks again for every one (an item may have been changed or deleted where it lives), not just the new ones.
    async function resolveCards(all) {
      const want = [...items.values()].map((x) => x.item).filter((i) => i.ref && (all || !cards.has(refKey(i.ref)))).map((i) => i.ref);
      if (!want.length) return;
      let got;
      try {
        got = await tavern.refs.resolve(want);
      } catch (err) {
        if (all) return; // asking again failed: what was shown stays as it was
        got = want.map(() => ({ error: 'unavailable' }));
      }
      want.forEach((r, i) => cards.set(refKey(r), got[i] || { error: 'unavailable' }));
      changed();
    }

    // The day of an item: its own, or for a pointer with no place of its own the day of the item it points at. An item on the
    // line (at a joint) has no day.
    const dayOf = (item) => {
      if (item.date) return item.date;
      if (item.after !== null && item.after !== undefined) return null;
      const c = item.ref ? cards.get(refKey(item.ref)) : null;
      const w = c && !c.error ? cardWhen(c) : null;
      return w ? w.day : null;
    };
    // The joint an item is at on the line ('' the head, else the day it follows), or null when it is on a day.
    const jointOf = (item) => lineOf(item, dayOf(item));

    const list = () => [...items.values()].map((x) => x.item);
    // An item as it is placed in a day: a pointer with no time of its own takes the time its card gives, so it sorts
    // where that time says.
    const timed = (item) => {
      if (item.time || !item.ref) return item;
      const c = cards.get(refKey(item.ref));
      const w = c && !c.error ? cardWhen(c) : null;
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
      const next = cleanTrip({ ...(trip || {}), ...patch, by: tavern.user.name });
      const saved = await tavern.storage.set(TRIP_KEY, next, tripVersion === null ? {} : { version: tripVersion });
      remember(TRIP_KEY, next, saved.version);
      changed();
      return trip;
    }

    async function addItem(fields) {
      const id = tavern.util.id();
      const onTheLine = !fields.date && (fields.after === '' || isYmd(fields.after) || fields.kind === 'lane');
      const item = cleanItem({ ...fields, id, order: fields.order ?? (onTheLine ? nextJointOrder(fields.after || '') : nextOrder(fields.date)), by: tavern.user.name });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      const saved = await tavern.storage.set(`item:${id}`, value, {});
      items.set(id, { item, version: saved.version });
      changed();
      if (item.ref) resolveCards().catch(() => {});
      return item;
    }

    async function updateItem(id, patch) {
      const cur = items.get(id);
      if (!cur) throw new Error('that item is not here any more');
      const item = cleanItem({ ...cur.item, ...patch, id });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      try {
        const saved = await tavern.storage.set(`item:${id}`, value, { version: cur.version });
        items.set(id, { item, version: saved.version });
        changed();
        return item;
      } catch (err) {
        if (err && err.status === 409) {
          const fresh = await tavern.storage.get(`item:${id}`).catch(() => null);
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
      await tavern.storage.delete(`item:${id}`);
      items.delete(id);
      changed();
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

    // A pointer to another module's item, put at a place: `{ date }` a day, `{ after }` a joint on the line, or nothing (the
    // pointed-at item's own day when it has one, else the head of the line).
    const addLink = (ref, place, title) => addItem({ kind: 'link', ref, ...placeFields(place), title: title || '' });

    // Dated items other modules hold in this room, on days of the trip, that the plan does not already point at:
    // what the plan could take in. Nothing is stored until one is added.
    async function suggest() {
      const tripDaysList = days();
      if (!tripDaysList.length) { suggested = []; changed(); return suggested; }
      let found = [];
      try {
        found = await tavern.refs.search('');
      } catch (err) {
        found = [];
      }
      const pinned = new Set(list().filter((i) => i.ref).map((i) => refKey(i.ref)));
      suggested = found.filter((c) => c && c.ref && c.module && c.module.id !== 'travel' && !pinned.has(refKey(c.ref)) && tripDaysList.includes((cardWhen(c) || {}).day));
      changed();
      return suggested;
    }

    // What other modules may ask of this one, and what it is when they do.
    function provide() {
      if (!tavern.actions || !tavern.actions.provide) return;
      tavern.actions.provide({
        addStop: async (input) => {
          const date = input.date && isYmd(input.date) ? input.date : null;
          const item = input.ref
            ? await addLink(input.ref, date, input.title)
            : await addItem({ kind: 'stop', title: input.title, date, notes: input.notes || '' });
          return { ref: tavern.refs.make('plan', item.id) };
        },
        addToDay: async (input) => {
          const item = await addLink(input.item, isYmd(input.date) ? input.date : null);
          return { ref: tavern.refs.make('plan', item.id) };
        },
        // A suggestion from anywhere (an AI's typed card, another module's idea): placed as the right kind of item when its
        // `kind` is one of the everyday words a journey, a stay or a stop already knows (a flight, a hotel, a sight...); an
        // unrecognised or missing kind is an ordinary stop, the same as addStop. Found by name and input shape, never by
        // whoever asks for it.
        acceptSuggestion: async (input) => {
          const item = await addItem(fromSuggestion(input));
          return { ref: tavern.refs.make('plan', item.id) };
        },
      });
    }
    // The item a suggestion becomes ({ title, kind?, content?, place?, date? }, an AI's card or a card dropped here):
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
      refreshCards: () => resolveCards(true), load, list, onLine, atJoint, sortable, days, byDay, dayOf, jointOf, cards, suggest, provide, saveTrip, addItem, updateItem, removeItem, applyChanges, moveTo, moveToJoint, nudgeItem, addLink, fromSuggestion,
      get trip() { return trip; },
      get suggestions() { return suggested; },
      versionOf: (id) => (items.get(id) || {}).version,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
  }
