// The Travel module's dashboard widget: the trips the viewer's spaces have that are on now or coming, soonest first,
// each with how far away it is, and while a trip is on, what is planned today. It shows and opens; it never edits.
// Clicking a trip (or a planned item) opens it in its space's Planner.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = host.util;

  try {
    await host.ready();
  } catch (err) {
    $('msg').textContent = 'Trips could not start: ' + err.message;
    return;
  }

  /*__LIB__*/

  let goIcon = '';
  try { goIcon = await host.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const MAX_TRIPS = 3;
  const MAX_TODAY = 3;
  const trips = new Map(); // space id -> trip
  const planned = new Map(); // space id -> Map(id -> the plan's items)
  const spaces = new Map(); // space id -> { id, name, icon, svg }

  async function load() {
    trips.clear();
    planned.clear();
    try {
      for (const r of await host.spaces()) spaces.set(r.id, r);
      for (const it of await host.storage.list(TRIP_KEY, { scope: 'spaces' })) if (it.value) trips.set(it.spaceId, cleanTrip(it.value));
      // A space whose Planner has not been opened since the rename still has its items under the old keys: both are read, the
      // new key winning (see PLAN_PREFIX).
      const stored = [...await host.storage.list(OLD_PLAN_PREFIX, { scope: 'spaces' }), ...await host.storage.list(PLAN_PREFIX, { scope: 'spaces' })];
      for (const it of stored) {
        const item = it.value ? cleanItem({ ...it.value, id: planIdOf(it.key) }) : null;
        if (!item) continue;
        if (!planned.has(it.spaceId)) planned.set(it.spaceId, new Map());
        planned.get(it.spaceId).set(item.id, item);
      }
    } catch (err) {
      // no spaces is fine: no trips
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
    $('list').innerHTML = list.map(([spaceId, t]) => {
      const r = spaces.get(spaceId);
      const on = daysUntil(t, today) <= 0;
      const todays = on ? sortDay([...(planned.get(spaceId) || new Map()).values()].filter((i) => i.date === today)).slice(0, MAX_TODAY) : [];
      const range = t.end && t.end !== t.start ? `${parseYmd(t.start).toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${parseYmd(t.end).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : parseYmd(t.start).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<div class="trip">
        <button type="button" class="item" data-trip="${esc(spaceId)}" title="${esc(t.title || t.destination || 'Trip')}${r ? ' - ' + esc(r.name) : ''}">
          <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="stack"><span class="what">${esc(t.title || t.destination || 'Trip')}</span><span class="sub">${esc(range)}</span></span><span class="when${on ? ' on' : ''}">${esc(whenText(t, today))}</span><span class="go">${goIcon}</span></button>
        ${todays.map((i) => `<button type="button" class="item today" data-plan="${esc(spaceId)}|${esc(i.id)}"><span class="when">${esc(i.time ? host.util.time(i.time) : 'today')}</span><span class="what">${esc(i.title)}</span></button>`).join('')}
      </div>`;
    }).join('');
    try {
      host.resize({ height: $('w').offsetHeight + 4 }); // the content, not the frame's own height
    } catch (err) {
      // the host sizes it
    }
  }

  root.addEventListener('click', (e) => {
    const trip = e.target.closest('[data-trip]');
    if (trip) return void host.objects.open(host.objects.make('trip', 'main', { space: trip.dataset.trip })).catch(() => {});
    const plan = e.target.closest('[data-plan]');
    if (plan) {
      const [space, id] = plan.dataset.plan.split('|');
      host.objects.open(host.objects.make('plan', id, { space })).catch(() => {});
    }
  });

  let refreshing = 0;
  host.on('change', (e) => {
    const key = String(e.key);
    if (key !== TRIP_KEY && planIdOf(key) === null) return;
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
