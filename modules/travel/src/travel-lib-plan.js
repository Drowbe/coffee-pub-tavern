
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

    // The day of an item: its own, or for a pointer the day of the item it points at.
    const dayOf = (item) => {
      if (item.date) return item.date;
      const c = item.ref ? cards.get(refKey(item.ref)) : null;
      const w = c && !c.error ? cardWhen(c) : null;
      return w ? w.day : null;
    };

    const list = () => [...items.values()].map((x) => x.item);
    // An item as it is placed in a day: a pointer with no time of its own takes the time its card gives, so it sorts
    // where that time says.
    const timed = (item) => {
      if (item.time || !item.ref) return item;
      const c = cards.get(refKey(item.ref));
      const w = c && !c.error ? cardWhen(c) : null;
      return w && w.time ? { ...item, time: w.time } : item;
    };
    // Markers between the days are on the plan's line, not in any day, so days never see them.
    const sortable = () => list().filter((i) => i.kind !== 'lane').map(timed);
    // The markers between the days, in the order they are on the line: by the day they follow, then by their own order.
    const lanes = () => list().filter((i) => i.kind === 'lane').sort((a, b) => String(a.after || '').localeCompare(String(b.after || '')) || a.order - b.order || String(a.id).localeCompare(String(b.id)));
    const days = () => tripDays(trip);
    const byDay = () => itemsByDay(sortable(), days(), dayOf);
    const nextOrder = (date) => {
      const same = sortable().filter((i) => !i.time && i.date === date);
      return same.length ? Math.max(...same.map((i) => i.order)) + 1000 : 1000;
    };

    async function saveTrip(patch) {
      const next = cleanTrip({ ...(trip || {}), ...patch, by: tavern.user.name });
      const saved = await tavern.storage.set(TRIP_KEY, next, tripVersion === null ? {} : { version: tripVersion });
      remember(TRIP_KEY, next, saved.version);
      changed();
      return trip;
    }

    async function addItem(fields) {
      const id = tavern.util.id();
      const item = cleanItem({ ...fields, id, order: fields.order ?? nextOrder(fields.date), by: tavern.user.name });
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

    // Put the item at a place in a day (the drag, and "Move to day..."): untimed items are ordered by hand, a timed
    // one only changes day.
    async function moveTo(id, date, index) {
      const cur = items.get(id);
      if (!cur) return;
      if (timed(cur.item).time) return void (await updateItem(id, { date }));
      const dayUntimed = sortDay(sortable().filter((i) => !i.time && dayOf(i) === date));
      await applyChanges(placeUntimed(dayUntimed, cur.item, date, index));
    }
    async function nudgeItem(id, direction) {
      const cur = items.get(id);
      if (!cur) return;
      const day = dayOf(cur.item);
      const changes = nudge(sortDay(sortable().filter((i) => dayOf(i) === day)), timed(cur.item), direction);
      if (changes) await applyChanges(changes);
    }

    // A pointer to another module's item, put on a day (or left without one: taken from the item when it has one).
    const addLink = (ref, date, title) => addItem({ kind: 'link', ref, date: date || null, title: title || '' });

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
      });
    }

    return {
      refreshCards: () => resolveCards(true), load, list, lanes, sortable, days, byDay, dayOf, cards, suggest, provide, saveTrip, addItem, updateItem, removeItem, applyChanges, moveTo, nudgeItem, addLink,
      get trip() { return trip; },
      get suggestions() { return suggested; },
      versionOf: (id) => (items.get(id) || {}).version,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
  }
