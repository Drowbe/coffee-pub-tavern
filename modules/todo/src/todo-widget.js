// The To-do's dashboard widget: tasks that are due within the week (or overdue) and not done, across every space
// the viewer is in and the environment's own list. It shows and opens; it never edits. Clicking a task takes the person
// to it (host.objects.open); the widget's heading opens the full list.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = host.util;

  try {
    await host.ready();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not start: ' + err.message;
    return;
  }

  // The arrow that says "go there", as inline SVG (a frame cannot load the icon font).
  let goIcon = '';
  try { goIcon = await host.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const DAYS_AHEAD = 7;
  const MAX_ITEMS = 8;
  const tasks = new Map(); // "<place>:<key>" -> { id, spaceId, t }
  const spaces = new Map(); // space id -> { id, name, icon, svg }

  async function load() {
    tasks.clear();
    for (const item of await host.storage.list('task:')) if (item.value) tasks.set('environment:' + item.key, { id: item.key.slice(5), spaceId: null, t: item.value });
    try {
      for (const r of await host.spaces()) spaces.set(r.id, r);
      for (const item of await host.storage.list('task:', { scope: 'spaces' })) if (item.value) tasks.set(`${item.spaceId}:${item.key}`, { id: item.key.slice(5), spaceId: item.spaceId, t: item.value });
    } catch (err) {
      // no spaces is fine: just the environment's own tasks
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
    const shown = [...tasks.values()]
      .filter((x) => x.t.due && !x.t.done && x.t.due <= limit)
      .sort((a, b) => (a.t.due < b.t.due ? -1 : a.t.due > b.t.due ? 1 : 0))
      .slice(0, MAX_ITEMS);
    $('msg').hidden = shown.length > 0;
    $('msg').textContent = 'Nothing due in the next week.';
    $('list').hidden = shown.length === 0;
    $('list').innerHTML = shown.map((x) => {
      const r = x.spaceId ? spaces.get(x.spaceId) : null;
      const w = whenOf(x.t.due);
      return `<button type="button" class="item" data-task="${esc(x.spaceId || '')}|${esc(x.id)}" title="${esc(x.t.title)}${r ? ' - ' + esc(r.name) : ''}">
        <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="what">${esc(x.t.title)}</span><span class="when ${w.cls}">${esc(w.text)}</span><span class="go">${goIcon}</span></button>`;
    }).join('');
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
    const b = e.target.closest('[data-task]');
    if (!b) return;
    const [space, id] = b.dataset.task.split('|');
    host.objects.open(host.objects.make('task', id, space ? { space } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  host.on('change', (e) => {
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
