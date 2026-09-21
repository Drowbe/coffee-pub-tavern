  // The Places module's model: no page in it, so the page and the checks can both use it. A place is one stored value
  // (`place:<id>`): { title, category, address, point?, notes, owners, by, ref? }. `point` is a field of its own so the
  // module's card can name it (a card's `place`); a place with only an address has none. The page defines `geo`
  // (tavern.util.geo) ahead of this code, as the check does.
  const PLACE_PREFIX = 'place:';
  const CATEGORIES = ['do', 'eat', 'stay', 'travel', 'other'];

  // A stored value as a place, or null when it is not one.
  function cleanPlace(id, v) {
    if (!v || typeof v !== 'object') return null;
    const title = geo.oneLine(v.title, 120);
    if (!title) return null;
    let point = null;
    if (v.point && typeof v.point === 'object') {
      const lat = Number(v.point.lat);
      const lng = Number(v.point.lng);
      if (geo.inRange(lat, lng)) point = { lat: geo.round6(lat), lng: geo.round6(lng) };
    }
    const r = v.ref;
    const ref = r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string'
      ? { module: r.module, kind: r.kind, id: r.id, ...(typeof r.scope === 'string' ? { scope: r.scope } : {}), ...(typeof r.room === 'string' ? { room: r.room } : {}) }
      : null;
    return {
      id: String(id),
      title,
      category: CATEGORIES.includes(v.category) ? v.category : 'other',
      address: geo.oneLine(v.address, 200),
      point,
      notes: String(v.notes == null ? '' : v.notes).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 1000),
      owners: Array.isArray(v.owners) ? [...new Set(v.owners.filter((k) => typeof k === 'string' && k.length <= 64))].slice(0, 20) : [],
      by: typeof v.by === 'string' ? v.by.slice(0, 64) : '',
      ref,
    };
  }
  // What is stored for a place (no `point` at all when it has none, so its card carries no place).
  const placeValue = (p) => ({
    title: p.title,
    category: p.category,
    address: p.address,
    ...(p.point ? { point: { lat: p.point.lat, lng: p.point.lng } } : {}),
    notes: p.notes,
    owners: p.owners,
    by: p.by,
    ...(p.ref ? { ref: p.ref } : {}),
  });

  // What another module asks for through `addPlace`: a checked place, or an Error saying what is wrong.
  function placeFromRequest(input, by) {
    const i = input || {};
    const title = geo.oneLine(i.title, 120);
    if (!title) throw new Error('a place needs a name');
    const has = (x) => x !== undefined && x !== null && x !== '';
    let point = null;
    if (has(i.lat) || has(i.lng)) {
      const lat = Number(i.lat);
      const lng = Number(i.lng);
      if (!geo.inRange(lat, lng)) throw new Error('the coordinates are out of range');
      point = { lat, lng };
    }
    const p = cleanPlace('new', { title, category: i.category, address: i.address, point, notes: i.notes, owners: [], by, ref: i.ref });
    if (!p) throw new Error('that is not a place');
    return p;
  }

  // The places of a room, kept live, and what other modules may ask of them. `tavern` is the SDK.
  function createPlaces(tavern) {
    const items = new Map(); // id -> { place, version }
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };

    const remember = (id, value, version) => {
      const p = value ? cleanPlace(id, value) : null;
      if (p) items.set(id, { place: p, version });
      else items.delete(id);
    };
    async function load() {
      items.clear();
      for (const it of await tavern.storage.list(PLACE_PREFIX)) remember(it.key.slice(PLACE_PREFIX.length), it.value, it.version);
      changed();
    }
    tavern.on('change', (e) => {
      if (e.scope === 'rooms' || !String(e.key).startsWith(PLACE_PREFIX)) return;
      remember(String(e.key).slice(PLACE_PREFIX.length), e.deleted ? null : e.value, e.version);
      changed();
    });

    const list = () => [...items.values()].map((x) => x.place).sort((a, b) => a.title.localeCompare(b.title));
    const get = (id) => (items.get(id) || {}).place || null;
    const versionOf = (id) => (items.get(id) || {}).version;

    // Save a place (a new one when it has no id). A stale edit is refused with the store's 409.
    async function save(p, version) {
      const id = p.id && p.id !== 'new' ? p.id : tavern.util.id();
      const value = placeValue({ ...p, id });
      const saved = await tavern.storage.set(PLACE_PREFIX + id, value, version === undefined ? undefined : { version });
      const place = cleanPlace(id, value);
      items.set(id, { place, version: saved && saved.version });
      if (place.ref) tavern.refs.setLinks(tavern.refs.make('place', id), [place.ref]).catch(() => {});
      changed();
      return place;
    }
    async function remove(id) {
      await tavern.storage.delete(PLACE_PREFIX + id, items.has(id) ? { version: items.get(id).version } : undefined);
      items.delete(id);
      tavern.refs.setLinks(tavern.refs.make('place', id), []).catch(() => {});
      changed();
    }
    // Give a place a point (or take it away with null).
    async function setPoint(id, pt) {
      const cur = items.get(id);
      if (!cur) throw new Error('there is no such place');
      if (pt && !geo.inRange(Number(pt.lat), Number(pt.lng))) throw new Error('the coordinates are out of range');
      return save({ ...cur.place, point: pt ? { lat: geo.round6(Number(pt.lat)), lng: geo.round6(Number(pt.lng)) } : null }, cur.version);
    }

    // What other modules may ask of this one, and what it is when they do.
    function provide(me) {
      if (!tavern.actions || !tavern.actions.provide) return;
      tavern.actions.provide({
        addPlace: async (input, ctx) => {
          const place = await save(placeFromRequest(input, (ctx && ctx.by) || me || ''));
          return { ref: tavern.refs.make('place', place.id) };
        },
        setPlacePoint: async (input) => {
          const r = input && input.place;
          if (!r || r.kind !== 'place') throw new Error('that is not a place');
          const place = await setPoint(String(r.id), { lat: input.lat, lng: input.lng });
          return { ref: tavern.refs.make('place', place.id) };
        },
      });
    }

    return { load, list, get, versionOf, save, remove, setPoint, provide, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  }
