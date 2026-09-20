// Polls module. One file of code for every place it shows: the server's own page, a room's
// docked pane or floating panel, and a window of its own. Each place has its own polls; on
// the server page the viewer's rooms' polls are shown too, read-only, under their room's
// icon. The SDK (window.tavern) is injected by Tavern.
//
// A poll is for deciding something together (where to go, where to stay, what to do): each
// option can carry a short detail, a poll can let people suggest more options while it is
// open, and a closed poll marks its winner.
//
// Storage: `poll:<id>` is the poll; `vote:<pollId>:<userKey>` is one person's vote. Each
// person writes only their own vote key, so two people voting at once never conflict.
// A vote records the voter's name, so results can show who voted for what.
(async function () {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script);
  // either way it looks elements up in tavern.root, never in document, so it works in both.
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;

  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Polls could not start: ' + err.message;
    return;
  }
  const inRoom = info.context.scope === 'room';
  const me = info.user.key;
  const canVote = tavern.can('vote');
  const canCreate = tavern.can('create');
  const MAX_OPTIONS = 20;

  // Every poll we know of by key, and each poll's votes. `scope` is 'own' (this place's poll) or
  // 'rooms' (another room's, read-only). The votes are keyed by the poll's key, then the voter's.
  const polls = new Map();
  const votes = new Map();
  const roomInfo = new Map(); // room id -> { id, name, icon, svg }, on the server page
  const hiddenRooms = new Set();
  let show = 'open';

  // --- storage --------------------------------------------------------------

  const pollKey = (scope, id, roomId) => (scope === 'rooms' ? `rooms:${roomId}:${id}` : `own:${id}`);
  function rememberPoll(scope, item, roomId) {
    const id = item.key.slice(5);
    const key = pollKey(scope, id, roomId);
    polls.set(key, { key, scope, roomId, id, version: item.version, p: item.value });
  }
  // vote:<pollId>:<userKey>
  function rememberVote(scope, item, roomId) {
    const [, id, user] = item.key.split(':');
    if (!id || !user) return;
    const key = pollKey(scope, id, roomId);
    if (!votes.has(key)) votes.set(key, new Map());
    votes.get(key).set(user, item.value);
  }
  function forgetVote(scope, itemKey, roomId) {
    const [, id, user] = itemKey.split(':');
    const key = pollKey(scope, id, roomId);
    if (votes.has(key)) votes.get(key).delete(user);
  }

  async function load() {
    polls.clear();
    votes.clear();
    for (const item of await tavern.storage.list('poll:')) if (item.value) rememberPoll('own', item);
    for (const item of await tavern.storage.list('vote:')) if (item.value) rememberVote('own', item);
    if (!inRoom && info.context.scope === 'server') {
      try {
        for (const r of await tavern.rooms()) roomInfo.set(r.id, r);
        for (const item of await tavern.storage.list('poll:', { scope: 'rooms' })) if (item.value) rememberPoll('rooms', item, item.roomId);
        for (const item of await tavern.storage.list('vote:', { scope: 'rooms' })) if (item.value) rememberVote('rooms', item, item.roomId);
      } catch (err) {
        // just this place's own polls
      }
    }
  }

  tavern.on('change', (e) => {
    const scope = e.scope === 'rooms' ? 'rooms' : 'own';
    if (e.key.startsWith('poll:')) {
      const key = pollKey(scope, e.key.slice(5), e.roomId);
      if (e.deleted) {
        polls.delete(key);
        votes.delete(key);
      } else {
        rememberPoll(scope, { key: e.key, value: e.value, version: e.version }, e.roomId);
      }
    } else if (e.key.startsWith('vote:')) {
      if (e.deleted) forgetVote(scope, e.key, e.roomId);
      else rememberVote(scope, { key: e.key, value: e.value }, e.roomId);
    } else {
      return;
    }
    render();
  });

  // --- what links to a poll, and being opened from a link ---------------------
  // Other modules (a to-do, say) can point at a poll. Tavern says what points at it, only what the
  // viewer may see (tavern.refs.linksTo), and a link to a poll can ask for it to be shown
  // (tavern.refs.onOpen). Nothing here knows which modules those are.

  const backlinks = new Map(); // poll key -> cards
  const asked = new Set();
  function askBacklinks() {
    if (!tavern.refs || !tavern.refs.linksTo) return;
    for (const x of polls.values()) {
      if (asked.has(x.key)) continue;
      asked.add(x.key);
      const ref = tavern.refs.make('poll', x.id, x.scope === 'rooms' ? { room: x.roomId } : undefined);
      tavern.refs.linksTo(ref).then((cards) => {
        if (JSON.stringify(cards.map((c) => c.ref)) === JSON.stringify((backlinks.get(x.key) || []).map((c) => c.ref)) && backlinks.has(x.key)) return;
        backlinks.set(x.key, cards);
        render();
      }).catch(() => backlinks.set(x.key, []));
    }
  }
  const backlinksHtml = (x) => {
    const cards = backlinks.get(x.key) || [];
    if (!cards.length) return '';
    return `<div class="meta">Linked from ${cards.map((c) => (c.open
      ? `<span class="tag ref" role="button" tabindex="0" data-ref="${esc(JSON.stringify(c.ref))}"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</span>`
      : `<span class="tag"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</span>`)).join(' ')}</div>`;
  };
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const key = polls.has('own:' + ref.id) ? 'own:' + ref.id : `rooms:${ref.room}:${ref.id}`;
      if (!polls.has(key)) return;
      show = 'all';
      hiddenRooms.delete(ref.room);
      render();
      const el = root.querySelector(`[data-poll="${CSS.escape(key)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2000);
      }
    });
    tavern.on('links', (e) => {
      if (!e.ref || e.ref.kind !== 'poll') return;
      for (const x of polls.values()) if (x.id === e.ref.id) asked.delete(x.key);
      askBacklinks();
    });
  }

  // --- state of a poll --------------------------------------------------------

  const isClosed = (p) => Boolean(p.closed) || (p.closesAt && Date.now() >= p.closesAt);

  function tally(x) {
    const byVoter = votes.get(x.key) || new Map();
    const counts = new Map(x.p.options.map((o) => [o.id, []]));
    for (const [user, v] of byVoter) for (const id of v.options || []) if (counts.has(id)) counts.get(id).push(v.name || user);
    return { counts, voters: byVoter.size, mine: (byVoter.get(me) || {}).options || [] };
  }

  // --- drawing -------------------------------------------------------------

  const roomIcon = (roomId) => {
    const r = roomInfo.get(roomId);
    return r && r.svg ? `<span class="ri">${r.svg}</span>` : '';
  };

  function closesText(p) {
    if (p.closed) return 'Closed';
    if (!p.closesAt) return '';
    const d = new Date(p.closesAt);
    const when = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return Date.now() >= p.closesAt ? `Closed ${when}` : `Closes ${when}`;
  }

  function pollHtml(x) {
    const p = x.p;
    const closed = isClosed(p);
    const { counts, voters, mine } = tally(x);
    const votable = canVote && !closed && x.scope === 'own';
    const max = Math.max(0, ...[...counts.values()].map((v) => v.length));
    const leaders = closed && max > 0 ? p.options.filter((o) => counts.get(o.id).length === max) : [];
    const opts = p.options.map((o) => {
      const names = counts.get(o.id);
      const width = voters ? Math.round((names.length / Math.max(voters, max, 1)) * 100) : 0;
      const win = leaders.some((l) => l.id === o.id);
      return `<button type="button" class="opt ${mine.includes(o.id) ? 'mine' : ''} ${win ? 'win' : ''}" data-vote="${esc(x.key)}|${esc(o.id)}" ${votable ? '' : 'disabled'}>
        <span class="fill" style="width:${width}%"></span><span class="name">${esc(o.text)}${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span><span class="num">${win ? (leaders.length > 1 ? 'Tied &middot; ' : 'Winner &middot; ') : ''}${names.length}</span></button>
        ${names.length ? `<div class="who">${esc(names.join(', '))}</div>` : ''}`;
    }).join('');
    const canManage = canCreate && x.scope === 'own' && (p.byKey === me || info.user.role === 'admin');
    const status = closesText(p);
    return `<article class="poll ${closed ? 'closed' : ''}" data-poll="${esc(x.key)}">
      <h3 data-drag="${esc(x.key)}" title="Drag onto a to-do to link it">${esc(p.question)}</h3>
      <div class="meta">${p.multi ? 'Pick any' : 'Pick one'} &middot; ${voters} ${voters === 1 ? 'vote' : 'votes'}${status ? `<span class="tag">${esc(status)}</span>` : ''}<br>Started by ${esc(p.by || 'someone')}</div>
      ${opts}
      ${p.addable && votable && p.options.length < MAX_OPTIONS ? `<div class="addopt"><input type="text" maxlength="100" placeholder="Suggest another option" data-addtext="${esc(x.key)}" aria-label="Suggest another option"><button class="btn btn-small" type="button" data-addopt="${esc(x.key)}">Add</button></div>` : ''}
      ${x.scope === 'rooms' && !closed ? '<div class="meta">Vote in that room.</div>' : ''}
      ${backlinksHtml(x)}
      ${closed && x.scope === 'own' && offered.length ? `<div class="actions">${offered.map((a) => `<button class="btn btn-small" type="button" data-action="${esc(x.key)}|${esc(a.action)}" title="${esc(a.moduleName)}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      ${canManage ? `<div class="actions"><button class="btn btn-small" data-toggle="${esc(x.key)}" type="button">${p.closed ? 'Reopen' : 'Close'}</button><button class="btn btn-small btn-danger" data-delete="${esc(x.key)}" type="button">Delete</button></div>` : ''}
    </article>`;
  }

  function groupHtml(label, list) {
    const shown = list.filter((x) => (show === 'all' ? true : show === 'closed' ? isClosed(x.p) : !isClosed(x.p)));
    if (!shown.length) return '';
    shown.sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));
    return `<section class="group">${label ? `<h4>${label}</h4>` : ''}${shown.map(pollHtml).join('')}</section>`;
  }

  // Open / Closed / All are icons in the titlebar when the host has one (a pane, or a module's own
  // window); on the server page there is none, and the buttons stay in the page.
  const FILTERS = [
    { id: 'open', icon: 'circle', regular: true, title: 'Open' },
    { id: 'closed', icon: 'lock', title: 'Closed' },
    { id: 'all', icon: 'list', title: 'All' },
  ];
  let headerSig = '';
  async function syncHeader(openCount) {
    if (!tavern.header) return;
    const sig = show + '|' + openCount;
    if (sig === headerSig) return;
    headerSig = sig;
    let hosted = false;
    try {
      hosted = await tavern.header.set(FILTERS.map((f) => ({ ...f, on: f.id === show, title: f.id === 'open' && openCount ? `Open (${openCount})` : f.title })));
    } catch (err) {
      hosted = false;
    }
    $('app').classList.toggle('hosted-header', Boolean(hosted));
  }
  if (tavern.header) {
    tavern.on('header', (e) => {
      if (!FILTERS.some((f) => f.id === e.id)) return;
      show = e.id;
      render();
    });
  }

  function render() {
    for (const b of $('filter').querySelectorAll('[data-show]')) b.classList.toggle('on', b.dataset.show === show);
    const own = [...polls.values()].filter((x) => x.scope === 'own');
    const open = own.filter((x) => !isClosed(x.p)).length;
    $('count').textContent = open ? `${open} open` : '';
    syncHeader(open);

    $('rooms').hidden = roomInfo.size === 0;
    if (roomInfo.size) {
      $('rooms').innerHTML = [...roomInfo.values()].map((r) => `<button type="button" class="filter ${hiddenRooms.has(r.id) ? '' : 'on'}" data-room="${esc(r.id)}" title="${hiddenRooms.has(r.id) ? 'Show' : 'Hide'} ${esc(r.name)}"><span class="ri">${r.svg || ''}</span> ${esc(r.name)}</button>`).join('');
    }

    let html = groupHtml(roomInfo.size ? 'Server' : '', own);
    for (const r of roomInfo.values()) {
      if (hiddenRooms.has(r.id)) continue;
      html += groupHtml(`${roomIcon(r.id)} ${esc(r.name)}`, [...polls.values()].filter((x) => x.scope === 'rooms' && x.roomId === r.id));
    }
    askBacklinks();
    $('body').innerHTML = html || `<p class="empty">${show === 'closed' ? 'No closed polls.' : 'No open polls.'}${canCreate && show !== 'closed' ? ' Start one to get a vote going.' : ''}</p>`;
  }

  function showNote(text, ok) {
    $('note').textContent = text;
    $('note').classList.toggle('ok', Boolean(ok));
    $('note').hidden = !text;
    if (text) setTimeout(() => { $('note').hidden = true; }, 5000);
  }

  // What other modules can do for a finished poll (whatever they offer that takes a title), offered as
  // buttons named by the action, so nothing here knows which modules there are.
  let offered = [];
  async function loadActions() {
    if (!tavern.actions || !canVote) return;
    try {
      offered = (await tavern.actions.list()).filter((a) => a.input && a.input.title);
    } catch (err) {
      offered = [];
    }
  }
  async function runAction(key, action) {
    const x = polls.get(key);
    const a = offered.find((o) => o.action === action);
    if (!x || !a) return;
    const { winner } = winnerOf(x);
    const input = { title: winner ? `${x.p.question}: ${winner}` : x.p.question };
    if (a.input.notes) input.notes = x.p.question;
    if (a.input.ref) input.ref = tavern.refs.make('poll', x.id, x.scope === 'rooms' ? { room: x.roomId } : undefined);
    try {
      await tavern.actions.request(action, input);
      showNote(`Sent to ${a.moduleName}: ${a.label}`, true);
    } catch (err) {
      showNote(err.message);
    }
  }

  // --- voting and managing -----------------------------------------------------

  async function vote(key, optionId) {
    const x = polls.get(key);
    if (!x || x.scope !== 'own' || !canVote || isClosed(x.p)) return;
    const mine = tally(x).mine;
    // One choice: picking the same option again takes the vote back. Several: each option toggles.
    const next = x.p.multi
      ? (mine.includes(optionId) ? mine.filter((o) => o !== optionId) : [...mine, optionId])
      : (mine.length === 1 && mine[0] === optionId ? [] : [optionId]);
    const voteKey = `vote:${x.id}:${me}`;
    try {
      if (!next.length) {
        await tavern.storage.delete(voteKey);
        forgetVote('own', voteKey);
      } else {
        const value = { options: next, name: info.user.name, at: Date.now() };
        await tavern.storage.set(voteKey, value);
        rememberVote('own', { key: voteKey, value });
      }
    } catch (err) {
      showNote(err.message);
    }
    render();
  }

  // Closing a poll is something other modules may care about (a task waiting on it, say): say so through
  // Tavern, which delivers it to whichever modules were approved to hear it. Nothing here knows which.
  function winnerOf(x) {
    const { counts } = tally(x);
    const max = Math.max(0, ...[...counts.values()].map((v) => v.length));
    const top = max > 0 ? x.p.options.filter((o) => counts.get(o.id).length === max) : [];
    return { winner: top.length === 1 ? top[0].text : null, tied: top.length > 1 ? top.map((o) => o.text).slice(0, 5) : [] };
  }
  const announcing = new Set();
  async function announceClosed(x) {
    try {
      await tavern.events.publish('closed', { ref: tavern.refs.make('poll', x.id), data: winnerOf(x) });
    } catch (err) {
      // nobody may hear it, or this person cannot publish: the poll is closed either way
    }
  }
  // A poll that closes by its time closes with nobody clicking: whoever sees it first announces it, once.
  async function announceIfDue() {
    if (!tavern.events || !canVote) return;
    for (const x of polls.values()) {
      if (x.scope !== 'own' || x.p.closed || x.p.announced || !x.p.closesAt || Date.now() < x.p.closesAt || announcing.has(x.key)) continue;
      announcing.add(x.key);
      const p = { ...x.p, announced: true };
      try {
        const saved = await tavern.storage.set('poll:' + x.id, p, { version: x.version });
        rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
        await announceClosed({ ...x, p });
      } catch (err) {
        // someone else got there first
      }
    }
  }

  async function setClosed(key) {
    const x = polls.get(key);
    if (!x) return;
    const closing = !x.p.closed;
    const p = { ...x.p, closed: closing, closesAt: closing ? x.p.closesAt : null, announced: closing };
    try {
      const saved = await tavern.storage.set('poll:' + x.id, p, { version: x.version });
      rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
      if (closing) announceClosed({ ...x, p });
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that poll first. It has been refreshed.' : err.message);
      try { await load(); } catch (e) { /* keep what we have */ }
    }
    render();
  }

  // Anyone who can vote may add an option to a poll that allows it. The poll is one stored value,
  // so if someone changed it meanwhile, reload and try once more.
  async function addOption(key, text) {
    text = text.trim();
    if (!text) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const x = polls.get(key);
      if (!x || !x.p.addable || isClosed(x.p) || !canVote) return;
      if (x.p.options.length >= MAX_OPTIONS) return showNote('That poll has all the options it can hold.');
      if (x.p.options.some((o) => o.text.toLowerCase() === text.toLowerCase())) return showNote('That option is already there.');
      const p = { ...x.p, options: [...x.p.options, { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), text, by: info.user.name }] };
      try {
        const saved = await tavern.storage.set('poll:' + x.id, p, { version: x.version });
        rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
        break;
      } catch (err) {
        if (err.status !== 409 || attempt === 1) return showNote(err.message);
        await load();
      }
    }
    render();
  }

  const armed = new Set();
  async function remove(key) {
    const x = polls.get(key);
    if (!x) return;
    if (!armed.has(key)) {
      armed.add(key);
      const b = root.querySelector(`[data-delete="${CSS.escape(key)}"]`);
      if (b) b.textContent = 'Really delete?';
      setTimeout(() => { armed.delete(key); render(); }, 4000);
      return;
    }
    armed.delete(key);
    try {
      for (const user of [...(votes.get(key) || new Map()).keys()]) await tavern.storage.delete(`vote:${x.id}:${user}`);
      await tavern.storage.delete('poll:' + x.id);
      polls.delete(key);
      votes.delete(key);
    } catch (err) {
      showNote(err.message);
    }
    render();
  }

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  // One row per option: its name, and an optional detail (a price, a place, a date).
  function addOptionField() {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'o-text';
    name.maxLength = 100;
    name.placeholder = `Option ${$('f-options').children.length + 1}`;
    const desc = document.createElement('input');
    desc.type = 'text';
    desc.className = 'o-desc';
    desc.maxLength = 140;
    desc.placeholder = 'Detail (optional)';
    row.append(name, desc);
    $('f-options').appendChild(row);
    $('f-more').hidden = $('f-options').children.length >= MAX_OPTIONS;
    return name;
  }

  function openEditor() {
    showError('');
    $('f-question').value = '';
    $('f-options').innerHTML = '';
    addOptionField();
    addOptionField();
    $('f-multi').checked = false;
    $('f-addable').checked = false;
    $('f-closes').value = '';
    $('f-notify').checked = false;
    $('editor').hidden = false;
    $('f-question').focus();
  }
  function closeEditor() {
    $('editor').hidden = true;
  }
  $('f-more').addEventListener('click', () => addOptionField().focus());
  $('f-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) closeEditor(); });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function save() {
    showError('');
    const question = $('f-question').value.trim();
    const rows = [...$('f-options').children]
      .map((r) => ({ text: r.querySelector('.o-text').value.trim(), desc: r.querySelector('.o-desc').value.trim() }))
      .filter((o) => o.text);
    if (!question) return showError('A poll needs a question.');
    if (rows.length < 2) return showError('Give at least two options.');
    if (new Set(rows.map((o) => o.text.toLowerCase())).size !== rows.length) return showError('Two options are the same.');
    let closesAt = null;
    if ($('f-closes').value) {
      closesAt = new Date($('f-closes').value).getTime();
      if (Number.isNaN(closesAt) || closesAt <= Date.now()) return showError('The closing time has to be in the future.');
    }
    const p = {
      id: newId(),
      question,
      options: rows.map((o, i) => ({ id: 'o' + (i + 1), text: o.text, ...(o.desc ? { desc: o.desc } : {}) })),
      multi: $('f-multi').checked,
      addable: $('f-addable').checked,
      closed: false,
      closesAt,
      createdAt: Date.now(),
      by: info.user.name,
      byKey: me,
    };
    $('f-save').disabled = true;
    try {
      const saved = await tavern.storage.set('poll:' + p.id, p);
      rememberPoll('own', { key: 'poll:' + p.id, value: p, version: saved.version });
      if ($('f-notify').checked) {
        try { await tavern.notify({ title: 'New poll', body: question }); } catch (err) { showNote('Started, but people could not be notified: ' + err.message); }
      }
      closeEditor();
      show = 'open';
      render();
    } catch (err) {
      showError(err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    // Enter in an option's name moves on: to a new row from the last one, else to its detail.
    if (e.target.matches('.o-text')) {
      if (!e.target.value.trim()) return;
      const row = e.target.parentElement;
      if (row === $('f-options').lastElementChild && !$('f-more').hidden) addOptionField().focus();
      else row.querySelector('.o-desc').focus();
      return;
    }
    if (e.target.matches('.o-desc')) {
      const next = e.target.parentElement.nextElementSibling;
      if (next) next.querySelector('.o-text').focus();
      else if (!$('f-more').hidden) addOptionField().focus();
      return;
    }
    save();
  });

  // --- wiring ---------------------------------------------------------------

  $('filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    show = b.dataset.show;
    render();
  });
  $('rooms').addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    if (hiddenRooms.has(b.dataset.room)) hiddenRooms.delete(b.dataset.room); else hiddenRooms.add(b.dataset.room);
    render();
  });
  // A poll's question can be dragged onto another module that links to polls (a to-do, say).
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable($('body'), (target) => {
      const h = target.closest('[data-drag]');
      const x = h && polls.get(h.dataset.drag);
      return x ? { kind: 'poll', id: x.id, label: x.p.question, ...(x.scope === 'rooms' ? { room: x.roomId } : {}) } : null;
    });
  }
  $('body').addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) {
      const [k, a] = act.dataset.action.split('|');
      return void runAction(k, a);
    }
    const link = e.target.closest('[data-ref]');
    if (link && tavern.refs) return void tavern.refs.open(JSON.parse(link.dataset.ref)).catch((err) => showNote(err.message));
    const v = e.target.closest('[data-vote]');
    if (v) {
      const [key, option] = v.dataset.vote.split('|');
      return void vote(key, option);
    }
    const t = e.target.closest('[data-toggle]');
    if (t) return void setClosed(t.dataset.toggle);
    const d = e.target.closest('[data-delete]');
    if (d) return void remove(d.dataset.delete);
    const a = e.target.closest('[data-addopt]');
    if (a) {
      const input = a.parentElement.querySelector('[data-addtext]');
      addOption(a.dataset.addopt, input.value).then(() => { input.value = ''; });
    }
  });
  $('body').addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-addtext]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const key = input.dataset.addtext;
    addOption(key, input.value);
  });
  $('add').addEventListener('click', openEditor);
  // The host draws New poll in the module's action bar (in the room's bottom row when docked);
  // the button in the header stays only for a host without one.
  if (tavern.bar) {
    $('add').classList.add('hosted');
    tavern.bar.set(canCreate ? [{ id: 'add', label: 'New poll', icon: 'plus', primary: true }] : []).catch(() => $('add').classList.remove('hosted'));
    tavern.on('bar', (e) => { if (e.id === 'add' && canCreate) openEditor(); });
  }
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').hidden) closeEditor(); });
  // A poll with a closing time closes on its own: redraw now and then to show it.
  setInterval(() => { render(); announceIfDue(); }, 30000);

  $('add').hidden = !canCreate;
  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'Polls could not load: ' + err.message;
    return;
  }
  await loadActions();
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  announceIfDue();
})();
