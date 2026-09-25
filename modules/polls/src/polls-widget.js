// The Polls' dashboard widget: open polls the viewer has not voted in yet, across every space they are in and the
// environment's own polls. It shows and opens; voting happens in the poll. Clicking a poll takes the person to it
// (host.refs.open); the widget's heading opens all the polls.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { esc } = host.util;

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'Polls could not start: ' + err.message;
    return;
  }
  const me = info.user.key;

  // The arrow that says "go there", as inline SVG (a frame cannot load the icon font).
  let goIcon = '';
  try { goIcon = await host.ui.icon('circle-right'); } catch (err) { goIcon = ''; }

  const MAX_ITEMS = 8;
  const polls = new Map(); // "<place>:<id>" -> { id, spaceId, p }
  const mine = new Set(); // the same keys, for polls the viewer has voted in
  const spaces = new Map(); // space id -> { id, name, icon, svg }

  const isClosed = (p) => Boolean(p.closed) || (p.closesAt && Date.now() >= p.closesAt);

  async function load() {
    polls.clear();
    mine.clear();
    const add = (item, spaceId) => {
      const place = spaceId || 'environment';
      if (item.key.startsWith('poll:') && item.value) polls.set(`${place}:${item.key.slice(5)}`, { id: item.key.slice(5), spaceId: spaceId || null, p: item.value });
      else if (item.key.startsWith('vote:') && item.value) {
        const [, id, user] = item.key.split(':');
        if (user === me && (item.value.options || []).length) mine.add(`${place}:${id}`);
      }
    };
    for (const item of await host.storage.list('poll:')) add(item, null);
    for (const item of await host.storage.list('vote:')) add(item, null);
    try {
      for (const r of await host.spaces()) spaces.set(r.id, r);
      for (const item of await host.storage.list('poll:', { scope: 'spaces' })) add(item, item.spaceId);
      for (const item of await host.storage.list('vote:', { scope: 'spaces' })) add(item, item.spaceId);
    } catch (err) {
      // no spaces is fine: just the environment's own polls
    }
  }

  function closesText(p) {
    if (!p.closesAt) return '';
    return 'Closes ' + new Date(p.closesAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: host.util.hour12() });
  }

  function render() {
    const items = [...polls.entries()]
      .filter(([key, x]) => !isClosed(x.p) && !mine.has(key))
      // soonest closing first, then the newest
      .sort(([, a], [, b]) => (a.p.closesAt || Infinity) - (b.p.closesAt || Infinity) || (b.p.createdAt || 0) - (a.p.createdAt || 0))
      .slice(0, MAX_ITEMS);
    $('msg').hidden = items.length > 0;
    $('msg').textContent = 'No polls waiting for your vote.';
    $('list').hidden = items.length === 0;
    $('list').innerHTML = items.map(([, x]) => {
      const r = x.spaceId ? spaces.get(x.spaceId) : null;
      const closes = closesText(x.p);
      return `<button type="button" class="item" data-poll="${esc(x.spaceId || '')}|${esc(x.id)}" title="${esc(x.p.question)}${r ? ' - ' + esc(r.name) : ''}">
        <span class="ri"${r ? ` title="${esc(r.name)}"` : ''}>${r && r.svg ? r.svg : ''}</span><span class="what">${esc(x.p.question)}</span>${closes ? `<span class="when soon">${esc(closes)}</span>` : ''}<span class="go">${goIcon}</span></button>`;
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
    const b = e.target.closest('[data-poll]');
    if (!b) return;
    const [space, id] = b.dataset.poll.split('|');
    host.refs.open(host.refs.make('poll', id, space ? { space } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  host.on('change', (e) => {
    const key = String(e.key);
    if (!key.startsWith('poll:') && !key.startsWith('vote:')) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(() => load().then(render).catch(() => {}), 300);
  });

  try {
    await load();
  } catch (err) {
    $('msg').textContent = `${info.module.name} could not load: ${err.message}`;
    return;
  }
  render();
  setInterval(render, 60000);
})();
