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
      cost: Number.isFinite(raw.cost) && raw.cost > 0 ? Math.min(Math.round(raw.cost * 100) / 100, 1e9) : null,
      paidBy: typeof raw.paidBy === 'string' ? raw.paidBy.slice(0, 40) : '',
      follow: Boolean(raw.follow),
      result: clip(raw.result, 200),
      fired: Number.isFinite(raw.fired) ? raw.fired : 0,
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
    const currency = typeof r.currency === 'string' && /^[A-Za-z]{3}$/.test(r.currency.trim()) ? r.currency.trim().toUpperCase() : '';
    return { title: clip(r.title, 80), destination: clip(r.destination, 80), start, end, notes: clip(r.notes, 2000), currency, by: clip(r.by, 40) };
  }

  // When a card says something is: its `when` may be a day ("2026-10-03"), a moment (ISO text) or milliseconds (a poll's
  // closing time). Returns { day, time } with the time as "HH:MM" (empty for a whole day), or null.
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function cardWhen(card) {
    const w = card && card.when;
    if (typeof w === 'number' && Number.isFinite(w)) { const d = new Date(w); return { day: ymd(d), time: hhmm(d) }; }
    if (typeof w !== 'string' || !w) return null;
    if (w.length <= 10) return isYmd(w) ? { day: w, time: '' } : null;
    const d = new Date(w);
    return Number.isNaN(d.getTime()) ? null : { day: ymd(d), time: hhmm(d) };
  }

  // The bookings: stays and journeys, in date and time order.
  function bookings(items) {
    return items.filter((i) => i.kind === 'stay' || i.kind === 'journey')
      .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id)));
  }

  // Who owes what. An item with a cost was paid by one person and is shared by the people it belongs to (all the
  // travellers when it belongs to nobody). Returns each person's paid, share and net (positive: owed money), the total,
  // and the fewest payments that settle it. Amounts are in the trip's one currency, rounded to cents.
  const cents = (n) => Math.round(n * 100);
  function balances(items, travellers) {
    const keys = travellers.slice();
    const paid = {};
    const share = {};
    let total = 0;
    for (const item of items) {
      if (!item.cost || !item.paidBy) continue;
      const among = (item.owners.length ? item.owners : keys).filter(Boolean);
      if (!among.length) continue;
      const amount = cents(item.cost);
      total += amount;
      paid[item.paidBy] = (paid[item.paidBy] || 0) + amount;
      const each = Math.floor(amount / among.length);
      let rest = amount - each * among.length;
      for (const k of among) { share[k] = (share[k] || 0) + each + (rest > 0 ? 1 : 0); if (rest > 0) rest -= 1; }
    }
    const people = [...new Set([...keys, ...Object.keys(paid), ...Object.keys(share)])];
    const net = {};
    for (const k of people) net[k] = (paid[k] || 0) - (share[k] || 0);
    const owed = people.filter((k) => net[k] > 0).map((k) => [k, net[k]]).sort((a, b) => b[1] - a[1]);
    const owing = people.filter((k) => net[k] < 0).map((k) => [k, -net[k]]).sort((a, b) => b[1] - a[1]);
    const payments = [];
    let i = 0;
    let j = 0;
    while (i < owing.length && j < owed.length) {
      const amount = Math.min(owing[i][1], owed[j][1]);
      if (amount > 0) payments.push({ from: owing[i][0], to: owed[j][0], amount: amount / 100 });
      owing[i][1] -= amount;
      owed[j][1] -= amount;
      if (owing[i][1] === 0) i += 1;
      if (owed[j][1] === 0) j += 1;
    }
    const out = { total: total / 100, paid: {}, share: {}, net: {}, payments };
    for (const k of people) { out.paid[k] = (paid[k] || 0) / 100; out.share[k] = (share[k] || 0) / 100; out.net[k] = net[k] / 100; }
    return out;
  }
