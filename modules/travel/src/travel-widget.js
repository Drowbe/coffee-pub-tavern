// The Travel module's dashboard widget: the trips the viewer's rooms have that are on now or coming, soonest first,
// each with how far away it is, and while a trip is on, what is planned today. It shows and opens; it never edits.
// Clicking a trip (or a planned item) opens it in its room's Travel pane.
(async () => {
  'use strict';

  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = tavern.util;

  try {
    await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Trips could not start: ' + err.message;
    return;
  }

  /*__LIB__*/

  let goIcon = '';
  try { goIcon = await tavern.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const MAX_TRIPS = 3;
  const MAX_TODAY = 3;
  const trips = new Map(); // room id -> trip
  const planned = new Map(); // room id -> [items]
  const rooms = new Map(); // room id -> { id, name, icon, svg }

  async function load() {
    trips.clear();
    planned.clear();
    try {
      for (const r of await tavern.rooms()) rooms.set(r.id, r);
      for (const it of await tavern.storage.list(TRIP_KEY, { scope: 'rooms' })) if (it.value) trips.set(it.roomId, cleanTrip(it.value));
      for (const it of await tavern.storage.list('item:', { scope: 'rooms' })) {
        const item = it.value ? cleanItem({ ...it.value, id: it.key.slice(5) }) : null;
        if (!item) continue;
        if (!planned.has(it.roomId)) planned.set(it.roomId, []);
        planned.get(it.roomId).push(item);
      }
    } catch (err) {
      // no rooms is fine: no trips
    }
  }

  function whenText(trip, today) {
    const until = daysUntil(trip, today);
    if (until === null) return '';
    if (until > 1) return `in ${until} days`;
    if (until === 1) return 'tomorrow';
    if (until === 0) return 'starts today';
    const days = tripDays(trip);
    const at = days.indexOf(today);
    return at >= 0 ? `day ${at + 1} of ${days.length}` : '';
  }

  function render() {
    const today = ymd(new Date());
    const list = [...trips].filter(([, t]) => t.start && (t.end || t.start) >= today).sort(([, a], [, b]) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).slice(0, MAX_TRIPS);
    $('msg').hidden = list.length > 0;
    $('msg').textContent = 'No trips planned.';
    $('list').hidden = list.length === 0;
    $('list').innerHTML = list.map(([roomId, t]) => {
      const r = rooms.get(roomId);
      const on = daysUntil(t, today) <= 0;
      const todays = on ? sortDay((planned.get(roomId) || []).filter((i) => i.date === today)).slice(0, MAX_TODAY) : [];
      const range = t.end && t.end !== t.start ? `${parseYmd(t.start).toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${parseYmd(t.end).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : parseYmd(t.start).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<div class="trip">
        <button type="button" class="item" data-trip="${esc(roomId)}" title="${esc(t.title || t.destination || 'Trip')}${r ? ' - ' + esc(r.name) : ''}">
          <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="stack"><span class="what">${esc(t.title || t.destination || 'Trip')}</span><span class="sub">${esc(range)}</span></span><span class="when${on ? ' on' : ''}">${esc(whenText(t, today))}</span><span class="go">${goIcon}</span></button>
        ${todays.map((i) => `<button type="button" class="item today" data-plan="${esc(roomId)}|${esc(i.id)}"><span class="when">${esc(i.time ? tavern.util.time(i.time) : 'today')}</span><span class="what">${esc(i.title)}</span></button>`).join('')}
      </div>`;
    }).join('');
    try {
      tavern.resize({ height: $('w').offsetHeight + 4 }); // the content, not the frame's own height
    } catch (err) {
      // the host sizes it
    }
  }

  root.addEventListener('click', (e) => {
    const trip = e.target.closest('[data-trip]');
    if (trip) return void tavern.refs.open(tavern.refs.make('trip', 'main', { room: trip.dataset.trip })).catch(() => {});
    const plan = e.target.closest('[data-plan]');
    if (plan) {
      const [room, id] = plan.dataset.plan.split('|');
      tavern.refs.open(tavern.refs.make('plan', id, { room })).catch(() => {});
    }
  });

  let refreshing = 0;
  tavern.on('change', (e) => {
    const key = String(e.key);
    if (key !== TRIP_KEY && !key.startsWith('item:')) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(() => load().then(render).catch(() => {}), 300);
  });

  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'Trips could not load: ' + err.message;
    return;
  }
  render();
  setInterval(render, 60000);
})();
