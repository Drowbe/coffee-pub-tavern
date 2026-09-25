// The Calendar's dashboard widget: what is coming up in the next week, across every space the viewer is in and
// the environment's own calendar. It shows and opens; it never edits. The dashboard hosts it, and clicking an event
// takes the person to that event (host.objects.open) while the widget's heading opens the full calendar.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = host.util;

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'The calendar could not start: ' + err.message;
    return;
  }

  /*__LIB__*/

  // The arrow that says "go there", as inline SVG (a frame cannot load the icon font).
  let goIcon = '';
  try { goIcon = await host.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const DAYS_AHEAD = 7;
  const MAX_ITEMS = 5;
  const events = new Map(); // "<place>:<id>" -> { id, spaceId, ev }
  const spaces = new Map(); // space id -> { id, name, icon, svg }

  async function load() {
    events.clear();
    for (const item of await host.storage.list('event:')) if (item.value) events.set('environment:' + item.key, { id: item.key.slice(6), spaceId: null, ev: item.value });
    try {
      for (const r of await host.spaces()) spaces.set(r.id, r);
      for (const item of await host.storage.list('event:', { scope: 'spaces' })) if (item.value) events.set(`${item.spaceId}:${item.key}`, { id: item.key.slice(6), spaceId: item.spaceId, ev: item.value });
    } catch (err) {
      // no spaces is fine: just the environment's own events
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

  // A small month, with a dot on each day that has something, and a click on a day opens that day in the full calendar.
  let shown = startOfDay(new Date());
  shown = new Date(shown.getFullYear(), shown.getMonth(), 1);
  function renderMonth() {
    const first = shown;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const gridEnd = addDays(gridStart, 42);
    const busy = new Set();
    for (const x of events.values()) for (const start of occurrences(x.ev, gridStart, gridEnd)) busy.add(ymd(start));
    const today = ymd(new Date());
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="mini-dow">${d}</span>`).join('');
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(gridStart, i);
      const k = ymd(d);
      cells += `<button type="button" class="mini-day${d.getMonth() !== first.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${busy.has(k) ? ' has' : ''}" data-day="${k}" aria-label="${esc(dayHeading(d))}">${d.getDate()}</button>`;
    }
    $('month').hidden = false;
    $('month').innerHTML = `<div class="mini-head"><button type="button" data-step="-1" aria-label="Previous month">&lsaquo;</button><strong>${esc(first.toLocaleDateString([], { month: 'long', year: 'numeric' }))}</strong><button type="button" data-step="1" aria-label="Next month">&rsaquo;</button></div><div class="mini-grid">${cells}</div>`;
  }

  function render() {
    renderMonth();
    const shown = upcoming();
    $('msg').hidden = shown.length > 0;
    $('msg').textContent = 'Nothing in the next week.';
    $('msg').hidden = shown.length > 0;
    $('list').hidden = shown.length === 0;
    const today = ymd(new Date());
    const tomorrow = ymd(addDays(new Date(), 1));
    const byDay = new Map();
    for (const it of shown) {
      const k = ymd(it.start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(it);
    }
    $('list').innerHTML = [...byDay].map(([k, list]) => `
      <section class="day"><h4>${esc(k === today ? 'Today' : k === tomorrow ? 'Tomorrow' : dayHeading(parseYmd(k)))}</h4>
      ${list.map(({ x, start, end }) => {
        const r = x.spaceId ? spaces.get(x.spaceId) : null;
        return `<button type="button" class="item" data-event="${esc(x.spaceId || '')}|${esc(x.id)}" title="${esc(x.ev.title)}${r ? ' - ' + esc(r.name) : ''}">
          <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="when">${esc(whenText(x.ev, start, end))}</span><span class="what">${esc(x.ev.title)}</span><span class="go">${goIcon}</span></button>`;
      }).join('')}</section>`).join('');
    fit();
  }

  // A widget in a frame tells the dashboard how tall it is; one in the page just takes the height it needs.
  function fit() {
    try {
      host.resize({ height: $('w').offsetHeight + 4 }); // the content, not the frame's own height
    } catch (err) {
      // the host sizes it
    }
  }

  root.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      shown = new Date(shown.getFullYear(), shown.getMonth() + Number(step.dataset.step), 1);
      return render();
    }
    const day = e.target.closest('[data-day]');
    if (day) return void host.page.open('day=' + day.dataset.day).catch(() => {});
    const b = e.target.closest('[data-event]');
    if (!b) return;
    const [space, id] = b.dataset.event.split('|');
    host.objects.open(host.objects.make('event', id, space ? { space } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  host.on('change', (e) => {
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
