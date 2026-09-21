  // The Travel module's model, with no page in it: dates, cleaning what is stored, the order of a day, and the gaps
  // between items. Shared by the module's page and its dashboard widget (inlined into both by the build), and run
  // on its own by tools/check-travel.mjs. It expects `ymd` and `parseYmd` (from tavern.util) in scope.

  // The trip is one stored value per room (its key is a pointer's id, so the trip can be pointed at and opened).
  const TRIP_KEY = 'trip:main';
  const CATEGORIES = ['do', 'eat', 'stay', 'travel', 'other'];
  const KINDS = ['stop', 'stay', 'journey', 'note', 'link'];
  const MAX_DAYS = 60;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime()) && ymd(parseYmd(s)) === s;
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const clip = (s, n) => String(s ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ' ')).trim().slice(0, n);

  // One stored item, made safe and complete; null when it cannot be an item at all. `date` is null for an idea
  // that has no day yet. A `link` item points at another module's item (`ref`) and takes its day from the card
  // unless it has its own.
  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = KINDS.includes(raw.kind) ? raw.kind : 'stop';
    const item = {
      id: clip(raw.id, 40),
      kind,
      title: clip(raw.title, 120),
      date: isYmd(raw.date) ? raw.date : null,
      time: isTime(raw.time) ? raw.time : null,
      minutes: Number.isFinite(raw.minutes) && raw.minutes > 0 ? Math.min(Math.round(raw.minutes), 24 * 60) : null,
      category: CATEGORIES.includes(raw.category) ? raw.category : kind === 'stay' ? 'stay' : kind === 'journey' ? 'travel' : 'do',
      place: clip(raw.place, 120),
      address: clip(raw.address, 200),
      notes: clip(raw.notes, 2000),
      confirm: clip(raw.confirm, 60),
      from: clip(raw.from, 80),
      to: clip(raw.to, 80),
      checkOut: isYmd(raw.checkOut) ? raw.checkOut : null,
      order: Number.isFinite(raw.order) ? raw.order : 0,
      owners: Array.isArray(raw.owners) ? [...new Set(raw.owners.filter((k) => typeof k === 'string').map((k) => k.slice(0, 40)))].slice(0, 20) : [],
      done: Boolean(raw.done),
      by: clip(raw.by, 40),
    };
    if (kind === 'link') {
      const r = raw.ref;
      if (!r || typeof r.module !== 'string' || typeof r.kind !== 'string' || typeof r.id !== 'string') return null;
      item.ref = { module: r.module, kind: r.kind, id: r.id, scope: r.scope === 'room' ? 'room' : 'server', ...(r.scope === 'room' && r.room ? { room: r.room } : {}) };
    }
    if (kind !== 'link' && !item.title) return null;
    if (kind === 'stay' && item.checkOut && item.date && item.checkOut < item.date) item.checkOut = null;
    return item;
  }

  // The trip's days, first to last, at most MAX_DAYS. No dates (or an end before the start): no days.
  function tripDays(trip) {
    if (!trip || !isYmd(trip.start) || !isYmd(trip.end) || trip.end < trip.start) return [];
    const out = [];
    const first = parseYmd(trip.start);
    for (let i = 0; i < MAX_DAYS; i += 1) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const k = ymd(d);
      out.push(k);
      if (k === trip.end) break;
    }
    return out;
  }

  // "Day 3 of 7", the weekday and the date of a day of the trip.
  function dayLabel(day, days) {
    const d = parseYmd(day);
    return {
      position: `Day ${days.indexOf(day) + 1} of ${days.length}`,
      weekday: d.toLocaleDateString([], { weekday: 'long' }),
      date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    };
  }

  // Whole days from today until the trip starts (negative while it is on or over), or null without dates.
  function daysUntil(trip, today) {
    if (!trip || !isYmd(trip.start)) return null;
    return Math.round((parseYmd(trip.start) - parseYmd(today)) / DAY_MS);
  }

  // Where a day's items sit: those with no time first (the whole-day things, in the order people put them), then
  // the timed ones by time. An item's `cards` day (for a link) is given by dayOf.
  const minutesOfDay = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  function sortDay(items) {
    const untimed = items.filter((i) => !i.time).sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
    const timed = items.filter((i) => i.time).sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time) || a.order - b.order || String(a.id).localeCompare(String(b.id)));
    return [...untimed, ...timed];
  }

  // Every item under its day; `dayOf(item)` says which (the item's own date, or a linked item's card). Items with
  // no day go under null, the ideas not yet placed.
  function itemsByDay(items, days, dayOf = (i) => i.date) {
    const by = new Map(days.map((d) => [d, []]));
    by.set(null, []);
    for (const item of items) {
      const d = dayOf(item);
      const key = d && by.has(d) ? d : d ? undefined : null;
      if (key === undefined) continue; // a day outside the trip is not shown
      by.get(key).push(item);
    }
    for (const [d, list] of by) by.set(d, sortDay(list));
    return by;
  }

  // A number for an untimed item between two neighbours' numbers (either may be missing); null when there is no
  // room left between them and the day needs renumbering.
  function orderBetween(before, after) {
    if (before === undefined && after === undefined) return 1000;
    if (before === undefined) return after - 1000;
    if (after === undefined) return before + 1000;
    const mid = (before + after) / 2;
    return mid > before && mid < after && after - before > 1e-6 ? mid : null;
  }

  // The day's untimed items renumbered 1000 apart, in their order: { id: order } for those that change.
  function renumber(untimed) {
    const out = {};
    untimed.forEach((item, i) => { if (item.order !== (i + 1) * 1000) out[item.id] = (i + 1) * 1000; });
    return out;
  }

  // Put an untimed item at `index` among the day's untimed items (which do not include it). Returns the changes
  // as { id: { date?, order } }, renumbering the day when there is no room.
  function placeUntimed(dayUntimed, moving, date, index) {
    const rest = dayUntimed.filter((i) => i.id !== moving.id);
    const at = Math.max(0, Math.min(index, rest.length));
    const order = orderBetween(rest[at - 1]?.order, rest[at]?.order);
    if (order !== null) return { [moving.id]: { date, order } };
    const sequence = [...rest.slice(0, at), { ...moving }, ...rest.slice(at)];
    const numbers = renumber(sequence);
    const changes = {};
    for (const [id, order2] of Object.entries(numbers)) changes[id] = { order: order2 };
    changes[moving.id] = { ...(changes[moving.id] || {}), date, order: (at + 1) * 1000 };
    return changes;
  }

  // Earlier and later, for the item menu (the way to move on a phone): an untimed item swaps with its neighbour;
  // a timed one moves by half an hour. Returns the changes as { id: { time | order } }, or null at the edge.
  function nudge(dayItems, item, direction) {
    if (item.time) {
      const m = minutesOfDay(item.time) + direction * 30;
      if (m < 0 || m >= 24 * 60) return null;
      const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return { [item.id]: { time: t } };
    }
    const untimed = sortDay(dayItems.filter((i) => !i.time));
    const at = untimed.findIndex((i) => i.id === item.id);
    const other = untimed[at + direction];
    if (at < 0 || !other) return null;
    return { [item.id]: { order: other.order }, [other.id]: { order: item.order } };
  }

  // The minutes between the end of one timed item and the start of the next, when there is a gap worth showing.
  function gapMinutes(prev, next) {
    if (!prev || !next || !prev.time || !next.time) return null;
    const gap = minutesOfDay(next.time) - (minutesOfDay(prev.time) + (prev.minutes || 0));
    return gap > 0 ? gap : null;
  }
  function gapText(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  }

  // A stay covers the nights from its date up to (not including) its check-out day.
  function stayNights(item) {
    if (item.kind !== 'stay' || !item.date || !item.checkOut) return 0;
    return Math.round((parseYmd(item.checkOut) - parseYmd(item.date)) / DAY_MS);
  }

  // The trip itself: a heading, where, and its dates.
  function cleanTrip(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const start = isYmd(r.start) ? r.start : null;
    const end = isYmd(r.end) && start && r.end >= start ? r.end : start;
    return { title: clip(r.title, 80), destination: clip(r.destination, 80), start, end, notes: clip(r.notes, 2000), by: clip(r.by, 40) };
  }
