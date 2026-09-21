// The dashboard on the rooms page: cards under the room list, across all of a person's rooms. Who is around is
// Tavern's own; every other card is a widget a module provides (its manifest's surfaces.widget), hosted here
// exactly as a module page is, so Tavern names no module. The section stays hidden while there is nothing to show.
import { api, escapeHtml } from '/brand.js';
import { mountModule } from '/module-host.js';

// What each module has unread (Tavern's notification counts): shown on its card's heading, since the header no
// longer has an item for a module with a widget. brand.js announces the counts; this keeps the latest.
let unread = {};
document.addEventListener('tavern:unread', (event) => {
  unread = event.detail || {};
  paintUnread();
});
function paintUnread() {
  for (const el of document.querySelectorAll('#dashboard [data-widget]')) {
    const n = unread[el.dataset.widget] || 0;
    let badge = el.querySelector('.dashboard-badge');
    if (!n) { badge?.remove(); continue; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'dashboard-badge';
      el.querySelector('.dashboard-widget-title').after(badge);
    }
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.title = `${n} unread`;
  }
}

let started = false;

const section = () => document.getElementById('dashboard');

// Showing an item where its module keeps it. An item in a room takes the person into that room with the module's
// pane open on it (the page supplies how, since it owns joining); anything else goes to the module's own page,
// given the pointer in the address (the page hands it on).
let openInRoom = null;
function openRef(ref) {
  if (ref.scope === 'room' && ref.room && openInRoom) {
    openInRoom(ref.room, ref.module, ref);
    return true;
  }
  const q = new URLSearchParams();
  if (ref.scope === 'room') q.set('moduleRoom', ref.room);
  location.href = `/modules/${encodeURIComponent(ref.module)}${q.toString() ? '?' + q : ''}#ref=${encodeURIComponent(JSON.stringify(ref))}`;
  return true;
}

function card({ id, title, icon, href, size }) {
  const el = document.createElement('article');
  el.className = 'dashboard-widget';
  el.dataset.widget = id;
  el.dataset.size = size || 'small';
  const head = document.createElement('header');
  const label = `<i class="fa-solid fa-${escapeHtml(icon || 'puzzle-piece')} fa-fw" aria-hidden="true"></i> ${escapeHtml(title)}`;
  head.innerHTML = href
    ? `<a class="dashboard-widget-title" href="${escapeHtml(href)}" title="Open ${escapeHtml(title)}">${label}</a>`
    : `<span class="dashboard-widget-title">${label}</span>`;
  const body = document.createElement('div');
  body.className = 'dashboard-widget-body';
  el.append(head, body);
  return { el, body };
}

function mountWidget(w) {
  const { el, body } = card({ id: w.id, title: w.title, icon: w.icon, href: `/modules/${encodeURIComponent(w.id)}`, size: w.size });
  const inPage = w.runMode === 'page';
  let holder;
  if (inPage) {
    holder = document.createElement('div');
    holder.className = 'module-root dashboard-widget-root';
  } else {
    holder = document.createElement('iframe');
    holder.className = 'dashboard-widget-frame';
    holder.title = w.title;
  }
  body.appendChild(holder);
  section().appendChild(el);
  mountModule({
    module: { id: w.id, version: w.version, scope: w.scope },
    ...(inPage ? { container: holder } : { frame: holder }),
    scope: 'server',
    entry: w.entry,
    onOpenRef: openRef,
    // A click in the widget that means "show me this in full": the module's own page, at that place.
    onOpenPage: (hash) => { location.href = `/modules/${encodeURIComponent(w.id)}${hash ? '#' + hash : ''}`; return true; },
    // A widget in a frame says how tall it is.
    onResize: ({ height }) => { if (!inPage && Number.isFinite(height)) holder.style.height = `${Math.min(Math.max(Math.ceil(height), 40), 600)}px`; },
  });
}

// Who is around: a strip above the room cards of everyone online (signed in with Tavern open, in a room or not),
// with where they are, and a button to ask them into a private conversation of two.
let joinRoom = null;
let whoNote = '';
function renderWho(table) {
  const el = document.getElementById('whos-around');
  if (!el) return;
  const rooms = new Map((table.rooms || []).map((r) => [r.id, r]));
  const here = (table.users || []).filter((u) => u.present || u.online);
  const people = here.map((u) => {
    const mine = u.key === table.me;
    const where = u.room && rooms.get(u.room) ? rooms.get(u.room).name : '';
    const label = escapeHtml(u.displayName || u.login || 'Someone');
    // One cell of the grid: who, where they are, and what can be done (in the call, invite).
    const actions = `${u.inCall ? '<i class="fa-solid fa-video fa-fw dashboard-person-call" title="In the call" aria-hidden="true"></i>' : ''}${!mine && joinRoom ? `<button type="button" class="dashboard-invite" data-invite="${escapeHtml(u.key)}" title="Invite ${label} to a private conversation" aria-label="Invite ${label} to a private conversation"><i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i></button>` : ''}`;
    return `<div class="dashboard-person${where ? ' in-room' : ''}"><img src="/img/${encodeURIComponent(u.key)}/profile" alt=""><span class="dashboard-person-text"><span class="dashboard-person-name">${label}${mine ? ' (you)' : ''}</span><span class="dashboard-person-where">${where ? `in ${escapeHtml(where)}` : 'online'}</span></span><span class="dashboard-person-actions">${actions}</span></div>`;
  });
  el.innerHTML = `<h2 class="whos-around-title"><i class="fa-solid fa-user-group fa-fw" aria-hidden="true"></i> Who's around <span class="whos-around-count">${people.length || ''}</span></h2>` + (people.length ? `<div class="whos-around-list">${people.join('')}</div>` : '<p class="dashboard-empty">Nobody is around right now.</p>') + (whoNote ? `<p class="whos-around-note">${escapeHtml(whoNote)}</p>` : '');
  el.hidden = false;
}

async function invite(key) {
  try {
    const { room } = await api('POST', '/api/table/invite', { to: key });
    whoNote = '';
    await joinRoom(room.id);
  } catch (err) {
    whoNote = err.message;
    renderWho(lastTable);
    setTimeout(() => { whoNote = ''; renderWho(lastTable); }, 6000);
  }
}
let lastTable = {};
document.addEventListener('click', (event) => {
  const b = event.target.closest('#whos-around [data-invite]');
  if (b) invite(b.dataset.invite);
});

// Called each time the room list is drawn: the widgets are mounted once, who is around every time.
export async function initDashboard(table, hooks = {}) {
  const root = section();
  if (!root) return;
  if (hooks.openInRoom) openInRoom = hooks.openInRoom;
  if (hooks.joinRoom) joinRoom = hooks.joinRoom;
  lastTable = table;
  if (!started) {
    started = true;
    let widgets = [];
    try {
      widgets = (await api('GET', '/api/modules/widgets')).widgets;
    } catch {
      // no widgets is fine: just who is around
    }
    for (const w of widgets) mountWidget(w);
    paintUnread();
  }
  renderWho(table);
  root.hidden = root.children.length === 0;
}
