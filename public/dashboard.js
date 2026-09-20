// The dashboard on the rooms page: cards under the room list, across all of a person's rooms. Who is around is
// Tavern's own; every other card is a widget a module provides (its manifest's surfaces.widget), hosted here
// exactly as a module page is, so Tavern names no module. The section stays hidden while there is nothing to show.
import { api, escapeHtml } from '/brand.js';
import { mountModule } from '/module-host.js';

let started = false;
let whoBody = null;

const section = () => document.getElementById('dashboard');

// Showing an item where its module keeps it: that module's page, given the pointer in the address (the page
// hands it on), in the room the item is in.
function openRef(ref) {
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
    // A widget in a frame says how tall it is.
    onResize: ({ height }) => { if (!inPage && Number.isFinite(height)) holder.style.height = `${Math.min(Math.max(Math.ceil(height), 40), 600)}px`; },
  });
}

// Who is around: the people online now, and where.
function renderWho(table) {
  if (!whoBody) return;
  const rooms = new Map((table.rooms || []).map((r) => [r.id, r]));
  const online = (table.users || []).filter((u) => u.online);
  whoBody.innerHTML = online.length
    ? online.map((u) => {
      const where = u.room && rooms.get(u.room) ? rooms.get(u.room).name : '';
      return `<div class="dashboard-person"><img src="/img/${encodeURIComponent(u.key)}/profile" alt=""><span class="dashboard-person-name">${escapeHtml(u.displayName || u.login || 'Someone')}</span>${where ? `<span class="dashboard-person-where">${escapeHtml(where)}</span>` : ''}${u.inCall ? '<i class="fa-solid fa-video fa-fw dashboard-person-call" title="In the call" aria-hidden="true"></i>' : ''}</div>`;
    }).join('')
    : '<p class="dashboard-empty">Nobody is around right now.</p>';
}

// Called each time the room list is drawn: the widgets are mounted once, who is around every time.
export async function initDashboard(table) {
  const root = section();
  if (!root) return;
  if (!started) {
    started = true;
    const who = card({ id: '_who', title: "Who's around", icon: 'user-group', size: 'small' });
    whoBody = who.body;
    root.appendChild(who.el);
    let widgets = [];
    try {
      widgets = (await api('GET', '/api/modules/widgets')).widgets;
    } catch {
      // no widgets is fine: just who is around
    }
    for (const w of widgets) mountWidget(w);
  }
  renderWho(table);
  root.hidden = false;
}
