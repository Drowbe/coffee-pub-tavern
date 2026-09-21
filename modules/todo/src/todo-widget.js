// The To-do's dashboard widget: tasks that are due within the week (or overdue) and not done, across every room
// the viewer is in and the server's own list. It shows and opens; it never edits. Clicking a task takes the person
// to it (tavern.refs.open); the widget's heading opens the full list.
(async () => {
  'use strict';

  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = tavern.util;

  try {
    await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not start: ' + err.message;
    return;
  }

  // The arrow that says "go there", as inline SVG (a frame cannot load the icon font).
  let goIcon = '';
  try { goIcon = await tavern.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const DAYS_AHEAD = 7;
  const MAX_ITEMS = 8;
  const tasks = new Map(); // "<place>:<key>" -> { id, roomId, t }
  const rooms = new Map(); // room id -> { id, name, icon, svg }

  async function load() {
    tasks.clear();
    for (const item of await tavern.storage.list('task:')) if (item.value) tasks.set('server:' + item.key, { id: item.key.slice(5), roomId: null, t: item.value });
    try {
      for (const r of await tavern.rooms()) rooms.set(r.id, r);
      for (const item of await tavern.storage.list('task:', { scope: 'rooms' })) if (item.value) tasks.set(`${item.roomId}:${item.key}`, { id: item.key.slice(5), roomId: item.roomId, t: item.value });
    } catch (err) {
      // no rooms is fine: just the server's own tasks
    }
  }

  function whenOf(due) {
    const today = ymd(new Date());
    const tomorrow = ymd(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const d = parseYmd(due).toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (due < today) return { text: 'Overdue, ' + d, cls: 'late' };
    if (due === today) return { text: 'Today', cls: 'soon' };
    if (due === tomorrow) return { text: 'Tomorrow', cls: 'soon' };
    return { text: d, cls: '' };
  }

  function render() {
    const limit = ymd(new Date(Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000));
    const items = [...tasks.values()]
      .filter((x) => x.t.due && !x.t.done && x.t.due <= limit)
      .sort((a, b) => (a.t.due < b.t.due ? -1 : a.t.due > b.t.due ? 1 : 0))
      .slice(0, MAX_ITEMS);
    $('msg').hidden = items.length > 0;
    $('msg').textContent = 'Nothing due in the next week.';
    $('list').hidden = items.length === 0;
    $('list').innerHTML = items.map((x) => {
      const r = x.roomId ? rooms.get(x.roomId) : null;
      const w = whenOf(x.t.due);
      return `<button type="button" class="item" data-task="${esc(x.roomId || '')}|${esc(x.id)}" title="${esc(x.t.title)}${r ? ' - ' + esc(r.name) : ''}">
        <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="what">${esc(x.t.title)}</span><span class="when ${w.cls}">${esc(w.text)}</span><span class="go">${goIcon}</span></button>`;
    }).join('');
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
    const b = e.target.closest('[data-task]');
    if (!b) return;
    const [room, id] = b.dataset.task.split('|');
    tavern.refs.open(tavern.refs.make('task', id, room ? { room } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  tavern.on('change', (e) => {
    if (!String(e.key).startsWith('task:')) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(() => load().then(render).catch(() => {}), 300);
  });

  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not load: ' + err.message;
    return;
  }
  render();
  setInterval(render, 60000);
})();
