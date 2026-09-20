// The Polls' dashboard widget: open polls the viewer has not voted in yet, across every room they are in and the
// server's own polls. It shows and opens; voting happens in the poll. Clicking a poll takes the person to it
// (tavern.refs.open); the widget's heading opens all the polls.
(async () => {
  'use strict';

  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);
  const { esc } = tavern.util;

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Polls could not start: ' + err.message;
    return;
  }
  const me = info.user.key;

  const MAX_ITEMS = 8;
  const polls = new Map(); // "<place>:<id>" -> { id, roomId, p }
  const mine = new Set(); // the same keys, for polls the viewer has voted in
  const rooms = new Map(); // room id -> { id, name, icon, svg }

  const isClosed = (p) => Boolean(p.closed) || (p.closesAt && Date.now() >= p.closesAt);

  async function load() {
    polls.clear();
    mine.clear();
    const add = (item, roomId) => {
      const place = roomId || 'server';
      if (item.key.startsWith('poll:') && item.value) polls.set(`${place}:${item.key.slice(5)}`, { id: item.key.slice(5), roomId: roomId || null, p: item.value });
      else if (item.key.startsWith('vote:') && item.value) {
        const [, id, user] = item.key.split(':');
        if (user === me && (item.value.options || []).length) mine.add(`${place}:${id}`);
      }
    };
    for (const item of await tavern.storage.list('poll:')) add(item, null);
    for (const item of await tavern.storage.list('vote:')) add(item, null);
    try {
      for (const r of await tavern.rooms()) rooms.set(r.id, r);
      for (const item of await tavern.storage.list('poll:', { scope: 'rooms' })) add(item, item.roomId);
      for (const item of await tavern.storage.list('vote:', { scope: 'rooms' })) add(item, item.roomId);
    } catch (err) {
      // no rooms is fine: just the server's own polls
    }
  }

  function closesText(p) {
    if (!p.closesAt) return '';
    return 'Closes ' + new Date(p.closesAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
      const r = x.roomId ? rooms.get(x.roomId) : null;
      const closes = closesText(x.p);
      return `<button type="button" class="item" data-poll="${esc(x.roomId || '')}|${esc(x.id)}" title="${esc(x.p.question)}${r ? ' - ' + esc(r.name) : ''}">
        <span class="what">${esc(x.p.question)}</span>${closes ? `<span class="when soon">${esc(closes)}</span>` : ''}${r && r.svg ? `<span class="ri" title="${esc(r.name)}">${r.svg}</span>` : ''}</button>`;
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
    const b = e.target.closest('[data-poll]');
    if (!b) return;
    const [room, id] = b.dataset.poll.split('|');
    tavern.refs.open(tavern.refs.make('poll', id, room ? { room } : undefined)).catch(() => {});
  });

  let refreshing = 0;
  tavern.on('change', (e) => {
    const key = String(e.key);
    if (!key.startsWith('poll:') && !key.startsWith('vote:')) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(() => load().then(render).catch(() => {}), 300);
  });

  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'Polls could not load: ' + err.message;
    return;
  }
  render();
  setInterval(render, 60000);
})();
