// The Calendar's dashboard widget: what is coming up in the next week, across every room the viewer is in and
// the server's own calendar. It shows and opens; it never edits. The dashboard hosts it, and clicking an item
// takes the person to that event (tavern.refs.open) while the widget's heading opens the full calendar.
(async () => {
  'use strict';

  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = tavern.util;

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'The calendar could not start: ' + err.message;
    return;
  }

  /*__LIB__*/

  const DAYS_AHEAD = 7;
  const MAX_ITEMS = 8;
  const events = new Map(); // "<place>:<id>" -> { id, roomId, ev }
  const rooms = new Map(); // room id -> { id, name, icon, svg }

  async function load() {
    events.clear();
    for (const item of await tavern.storage.list('event:')) if (item.value) events.set('server:' + item.key, { id: item.key.slice(6), roomId: null, ev: item.value });
    try {
      for (const r of await tavern.rooms()) rooms.set(r.id, r);
      for (const item of await tavern.storage.list('event:', { scope: 'rooms' })) if (item.value) events.set(`${item.roomId}:${item.key}`, { id: item.key.slice(6), roomId: item.roomId, ev: item.value });
    } catch (err) {
      // no rooms is fine: just the server's own events
    }
  }

  function upcoming() {
    const from = startOfDay(new Date());
    const to = addDays(from, DAYS_AHEAD);
    const out = [];
    for (const x of events.values()) {
      const dur = durationOf(x.ev);
      for (const start of occurrences(x.ev, new Date(from.getTime() - dur), to)) {
        const end = endOf(x.ev, start);
        if (end > new Date() || start >= from) out.push({ x, start, end });
      }
    }
    return out.sort((a, b) => a.start - b.start).slice(0, MAX_ITEMS);
  }

  function render() {
    const items = upcoming();
    $('msg').hidden = items.length > 0;
    $('msg').textContent = 'Nothing in the next week.';
    $('list').hidden = items.length === 0;
    const today = ymd(new Date());
    const tomorrow = ymd(addDays(new Date(), 1));
    const byDay = new Map();
    for (const it of items) {
      const k = ymd(it.start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(it);
    }
    $('list').innerHTML = [...byDay].map(([k, list]) => `
      <section class="day"><h4>${esc(k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayHeading(parseYmd(k)))}</h4>
      ${list.map(({ x, start, end }) => {
        const r = x.roomId ? rooms.get(x.roomId) : null;
        return `<button type="button" class="item" data-event="${esc(x.roomId || '')}|${esc(x.id)}" title="${esc(x.ev.title)}${r ? ' - ' + esc(r.name) : ''}">
          <span class="when">${esc(whenText(x.ev, start, end))}</span><span class="what">${esc(x.ev.title)}</span>${r && r.svg ? `<span class="ri" title="${esc(r.name)}">${r.svg}</span>` : ''}</button>`;
      }).join('')}</section>`).join('');
    fit();
  }

  // A widget in a frame tells the dashboard how tall it is; one in the page just takes the room it needs.
  function fit() {
    try {
      tavern.resize({ height: $('w').offsetHeight + 4 }); // the content, not the frame's own height
    } catch (err) {
      // the host sizes it
    }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-event]');
    if (!b) return;
    const [room, id] = b.dataset.event.split('|');
    tavern.refs.open(tavern.refs.make('event', id, room ? { room } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  tavern.on('change', (e) => {
    if (!String(e.key).startsWith('event:')) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(() => load().then(render).catch(() => {}), 300);
  });

  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'The calendar could not load: ' + err.message;
    return;
  }
  render();
  setInterval(render, 60000);
})();
