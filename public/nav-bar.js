// The registry behind both nav bars (documentation/plans/plan-nav.md, "Modules register into the bars";
// documentation/architecture/architecture-navigation.md). The primary nav (brand.js) and the secondary (room.js) each
// attach their three zones here and register their own controls as tools; a module's tools arrive through
// module-host.js under the module's own namespace. One drawing path: the host draws every tool and owns its look, so a
// module never hands over markup, and the page's own controls are registrations of the same shape as a module's.
//
// A tool is { id, bar: 'primary' | 'secondary', zone: 'left' | 'middle' | 'right', icon, label, title?, order?, group?,
// groupOrder?, href? | onClick?, visible?, toggleable?, active?, badge? }, plus, for the page's own tools only,
// `element` (an element the registry places and orders but does not draw: the snap slider, the clock, the profile link),
// `labelled` (drawn as a small text button with its icon, not an icon alone: Pull participants back) and `activeIcon`
// (the icon a toggle shows while it is on: full screen's compress). `register()` returns the element drawn, which lives
// until `unregister()`, so the page may mark it (a data attribute the overlay opener looks for).
//
// The pure parts (the bands, the sort, the visibility rule, the cleaning of a module's registration) touch no document,
// so tools/check-nav.mjs runs them in node.

const BARS = ['primary', 'secondary'];
const ZONES = ['left', 'middle', 'right'];

// Where an order lands: the system's core tools first, then its secondary and utility ones, a module's own after
// them, and 999 for the one thing that goes last (Leave). Nobody coordinates numbers across modules: a module's
// orders are clamped into its band by cleanModuleTools.
export const BANDS = {
  core: [1, 10],
  secondary: [11, 50],
  utility: [51, 100],
  module: [101, 998],
  last: [999, 999],
};
export const DEFAULT_ORDER = 500; // the middle of the module band, for a tool that names none
export function bandOf(order) {
  const n = Number(order);
  for (const [name, [lo, hi]] of Object.entries(BANDS)) if (n >= lo && n <= hi) return name;
  return null;
}

// `visible` is a boolean or a function; left out means shown (and other code may still toggle the element's own
// `hidden`, which the registry then leaves alone). A function that throws counts as shown, so a bug in it never
// hides a control.
export function isVisible(tool) {
  if (typeof tool.visible === 'function') {
    try {
      return Boolean(tool.visible());
    } catch (err) {
      return true;
    }
  }
  return tool.visible === undefined ? true : Boolean(tool.visible);
}

const orderOf = (t) => (Number.isFinite(t.order) ? t.order : DEFAULT_ORDER);

// The tools of one zone as groups in drawing order: groups by groupOrder (the smallest any tool of the group names,
// or its first tool's order when none does), tools by order; ties keep registration order (`seq`). Hidden tools
// stay in their place so they can be shown again without moving; the caller decides what a divider separates.
export function arrange(list) {
  const groups = new Map();
  for (const t of list) {
    const key = t.group || '';
    let g = groups.get(key);
    if (!g) {
      g = { key, tools: [], seq: Number.isFinite(t.seq) ? t.seq : groups.size, groupOrder: null };
      groups.set(key, g);
    }
    g.tools.push(t);
    if (Number.isFinite(t.groupOrder)) g.groupOrder = g.groupOrder === null ? t.groupOrder : Math.min(g.groupOrder, t.groupOrder);
    if (Number.isFinite(t.seq) && t.seq < g.seq) g.seq = t.seq;
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.tools.sort((a, b) => orderOf(a) - orderOf(b) || (a.seq || 0) - (b.seq || 0));
    if (g.groupOrder === null) g.groupOrder = orderOf(g.tools[0]);
  }
  out.sort((a, b) => a.groupOrder - b.groupOrder || a.seq - b.seq);
  return out.map((g) => g.tools);
}

// A module's registration, checked and namespaced. Ids, groups and orders are the module's own (`<module>:<id>`,
// `<module>:<group>`, orders clamped into the module band), so a module can neither touch another's tools nor the
// system's, nor get ahead of them. The secondary bar takes any zone; the primary takes a tool only when the admin has
// allowed the module there (its manifest's surfaces.page.nav, `allowPrimary`), the tool says system: true, and it goes
// into the right zone, the system-level actions. Throws with a status on anything else, so the module hears why.
const TOOL_ID = /^[a-z][a-z0-9-]{0,39}$/;
const ICON = /^[a-z0-9-]{1,40}$/;
const clamp = (n, lo, hi, fallback) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Math.round(Number(n)))) : fallback);
const refuse = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function cleanModuleTools(moduleId, tools, { allowPrimary = false } = {}) {
  if (!Array.isArray(tools)) refuse('nav.set takes a list of tools');
  if (tools.length > 12) refuse('a module may register at most 12 nav tools');
  const [lo, hi] = BANDS.module;
  const seen = new Set();
  return tools.map((raw) => {
    const t = raw && typeof raw === 'object' ? raw : {};
    const id = String(t.id ?? '');
    if (!TOOL_ID.test(id)) refuse(`a nav tool needs an id of letters, digits and hyphens (got "${id.slice(0, 40)}")`);
    if (seen.has(id)) refuse(`nav tool "${id}" is listed twice`);
    seen.add(id);
    const bar = t.bar === 'primary' ? 'primary' : 'secondary';
    const zone = ZONES.includes(t.zone) ? t.zone : 'right';
    if (bar === 'primary') {
      if (!allowPrimary || !t.system) refuse(`nav tool "${id}": the primary bar takes only a system-wide tool (system: true) from a module allowed there (surfaces.page.nav); a module's own tools go in the secondary bar`, 403);
      if (zone !== 'right') refuse(`nav tool "${id}": a module's system tool goes into the primary bar's right zone only`);
    }
    const icon = String(t.icon ?? '');
    if (!ICON.test(icon)) refuse(`nav tool "${id}" needs an icon (a Font Awesome name)`);
    const label = String(t.label ?? '').trim().slice(0, 40);
    if (!label) refuse(`nav tool "${id}" needs a label (what a screen reader and a tooltip say)`);
    const href = t.href === undefined || t.href === null ? '' : String(t.href).slice(0, 500);
    if (href && !/^(\/(?!\/)|https:\/\/)/.test(href)) refuse(`nav tool "${id}": href must be a path on this server or an https address`);
    const group = String(t.group ?? '');
    if (group && !TOOL_ID.test(group)) refuse(`nav tool "${id}": a group is letters, digits and hyphens`);
    const out = {
      id: `${moduleId}:${id}`,
      own: id,
      module: moduleId,
      bar,
      zone,
      icon,
      label,
      title: String(t.title ?? '').slice(0, 80) || undefined,
      order: clamp(t.order, lo, hi, DEFAULT_ORDER),
      group: `${moduleId}:${group || 'own'}`,
      groupOrder: clamp(t.groupOrder, lo, hi, DEFAULT_ORDER),
      visible: t.visible === undefined ? true : Boolean(t.visible),
      toggleable: Boolean(t.toggleable),
      active: Boolean(t.active),
      badge: clamp(t.badge, 0, 999, 0),
      system: Boolean(t.system),
    };
    if (href) out.href = href;
    return out;
  });
}

// --- the registry ------------------------------------------------------------------------------

const tools = new Map(); // id -> tool (with seq)
const els = new Map(); // id -> the element drawn (or placed) for it
const bars = { primary: null, secondary: null }; // bar -> { el, zones: { left, middle, right } }
let seq = 0;

// On a phone the primary nav's middle and right zones fold into the one menu (the right zone's element, which the
// stylesheet turns into the menu): the registry draws the middle's tools there, ahead of the right's, and back when
// the window widens.
const phone = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : null;
if (phone) phone.addEventListener('change', () => draw('primary'));

export function has(bar) {
  return Boolean(bars[bar]);
}

// Tell the registry where a bar is: its element holds `.nav-left`, `.nav-middle` and `.nav-right`. Tools registered
// before this are drawn now. The elements may later move to another document (the popped-out window takes the header
// with it); the registry follows them, since it keeps the elements, not selectors.
export function attach(bar, el) {
  if (!BARS.includes(bar)) throw new Error(`no such bar: ${bar}`);
  bars[bar] = { el, zones: Object.fromEntries(ZONES.map((z) => [z, el.querySelector(`.nav-${z}`)])) };
  draw(bar);
}

export function register(tool) {
  if (!tool || typeof tool.id !== 'string' || !tool.id) throw new Error('a nav tool needs an id');
  if (!BARS.includes(tool.bar)) throw new Error(`nav tool "${tool.id}": bar must be primary or secondary`);
  if (!ZONES.includes(tool.zone)) throw new Error(`nav tool "${tool.id}": zone must be left, middle or right`);
  const prev = tools.get(tool.id);
  const rec = { ...tool, seq: prev ? prev.seq : ++seq };
  tools.set(tool.id, rec);
  const b = bars[rec.bar];
  if (b) {
    if (els.has(rec.id)) apply(els.get(rec.id), rec); // registered again: the same element, brought up to date
    else ensureEl(rec, b.el.ownerDocument);
    draw(rec.bar);
  }
  return els.get(tool.id) || null;
}

export function unregister(id) {
  const t = tools.get(id);
  if (!t) return;
  tools.delete(id);
  const el = els.get(id);
  els.delete(id);
  if (el) el.remove(); // the page's own element is only taken out of the bar; whoever made it still has it
  draw(t.bar);
}

// Every tool whose id starts with `prefix` (a module's namespace) goes.
export function unregisterAll(prefix) {
  for (const id of [...tools.keys()]) if (id.startsWith(prefix)) unregister(id);
}

export function get(id) {
  return tools.get(id) || null;
}

export function elementOf(id) {
  return els.get(id) || null;
}

// A toggle's state, in place: the element takes or drops `on` and says so to a screen reader. Never a re-registration.
export function setActive(id, on) {
  const t = tools.get(id);
  if (!t) return false;
  t.active = Boolean(on);
  const el = els.get(id);
  if (el && !t.element) {
    el.classList.toggle('on', t.active);
    el.setAttribute('aria-pressed', String(t.active));
  }
  return true;
}

// A count on the tool (unread items, updates waiting); 0 takes it off.
export function setBadge(id, n) {
  const t = tools.get(id);
  if (!t) return false;
  t.badge = Math.max(0, Math.round(Number(n) || 0));
  const el = els.get(id);
  if (el && !t.element) paintBadge(el, t);
  return true;
}

// Redraw a bar (or both): order, dividers and visibility. Call it after something a `visible` function reads has
// changed; registering, unregistering and the phone fold call it themselves.
export function draw(bar) {
  if (!bar) {
    for (const b of BARS) draw(b);
    return;
  }
  const b = bars[bar];
  if (!b) return;
  const doc = b.el.ownerDocument;
  const fold = bar === 'primary' && phone && phone.matches;
  const byZone = { left: [], middle: [], right: [] };
  for (const t of tools.values()) if (t.bar === bar) byZone[t.zone].push(t);
  for (const z of ZONES) {
    const zone = b.zones[z];
    if (!zone) continue;
    for (const d of zone.querySelectorAll(':scope > [data-nav-divider]')) d.remove();
  }
  const lists = {};
  for (const z of ZONES) lists[z] = flatten(byZone[z], doc);
  if (fold) {
    lists.right = [...lists.middle, ...lists.right];
    lists.middle = [];
  }
  for (const z of ZONES) if (b.zones[z]) place(b.zones[z], lists[z]);
}

// --- drawing -------------------------------------------------------------------------------------

// The look is the host's, by where the tool is: the primary nav's middle zone is the core navigation (an icon and its
// name), everywhere else a tool is an icon button with its name as the tooltip and for a screen reader, unless the
// page marked it `labelled`. Every class here already exists in the stylesheet; nothing new is styled.
const lookOf = (t) => (t.bar === 'primary' && t.zone === 'middle' ? 'core' : t.labelled ? 'labelled' : 'icon');
const LOOK_CLASSES = { core: ['core-link'], labelled: ['btn', 'btn-small'], icon: ['icon-link'] };
const PLAIN_ID = /^[a-z][a-z0-9-]*$/;

function ensureEl(t, doc) {
  let el = els.get(t.id);
  if (el) return el;
  if (t.element) {
    el = t.element;
  } else {
    el = doc.createElement(t.href ? 'a' : 'button');
    if (!t.href) el.type = 'button';
    // The page's own tools keep the element ids other code and the checks look up; a module's carry a colon and
    // get none, which also keeps them from ever colliding with the page's.
    if (PLAIN_ID.test(t.id)) el.id = t.id;
    el.addEventListener('click', (event) => {
      const now = tools.get(t.id);
      if (now && typeof now.onClick === 'function') now.onClick(event);
    });
  }
  el.dataset.navTool = t.id;
  els.set(t.id, el);
  apply(el, t);
  return el;
}

function iconEl(doc, name, extra) {
  const i = doc.createElement('i');
  i.className = `${name.includes(' ') ? name : `fa-solid fa-${name}`} fa-fw${extra ? ` ${extra}` : ''}`;
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function apply(el, t) {
  if (t.element) return; // its look is its own
  const doc = el.ownerDocument;
  const look = lookOf(t);
  el.classList.add(...LOOK_CLASSES[look]);
  if (t.href) {
    el.setAttribute('href', t.href);
    if (t.target) el.setAttribute('target', t.target);
    else el.removeAttribute('target');
  }
  const label = String(t.label || '');
  const title = t.title || (look === 'icon' ? label : '');
  if (title) el.title = title;
  else el.removeAttribute('title');
  el.setAttribute('aria-label', label);
  if (t.toggleable) el.setAttribute('aria-pressed', String(Boolean(t.active)));
  else el.removeAttribute('aria-pressed');
  el.classList.toggle('on', Boolean(t.toggleable && t.active));
  const parts = [];
  if (t.icon) parts.push(iconEl(doc, t.icon, t.activeIcon ? 'icon-on' : ''));
  if (t.activeIcon) parts.push(iconEl(doc, t.activeIcon, 'icon-off')); // shown while on, see .icon-link.on in style.css
  if (look === 'core') {
    const s = doc.createElement('span');
    s.className = 'core-label';
    s.textContent = label;
    parts.push(s);
  } else if (look === 'labelled') {
    parts.push(doc.createTextNode(` ${label}`));
  }
  el.replaceChildren(...parts);
  paintBadge(el, t);
}

function paintBadge(el, t) {
  const cls = lookOf(t) === 'core' ? 'nav-badge' : 'badge';
  let badge = el.querySelector(`:scope > .${cls}`);
  const n = Number(t.badge) || 0;
  if (!n) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = el.ownerDocument.createElement('span');
    badge.className = cls;
    badge.setAttribute('aria-hidden', 'true');
    el.appendChild(badge);
  }
  badge.textContent = n > 9 ? '9+' : String(n);
}

// One zone's elements in drawing order, dividers between the groups that show something. A tool whose `visible`
// says no keeps its place, hidden; one with no `visible` is left to whoever toggles its `hidden`.
function flatten(list, doc) {
  const out = [];
  let shownBefore = false;
  for (const group of arrange(list)) {
    const shown = group.filter(isVisible);
    if (shown.length && shownBefore) {
      const d = doc.createElement('span');
      d.className = 'nav-divider';
      d.dataset.navDivider = '';
      out.push(d);
    }
    if (shown.length) shownBefore = true;
    for (const t of group) {
      const el = ensureEl(t, doc);
      if (t.visible !== undefined) el.hidden = !isVisible(t);
      out.push(el);
    }
  }
  return out;
}

// Put the owned elements into the container in this order, moving only what is out of place. Anything else in the
// container (the room's name and pane switches, an overlay page's Back button) stays where it is: the registry
// owns its own elements, not the zone.
const owned = (n) => n.nodeType === 1 && n.dataset && ('navTool' in n.dataset || 'navDivider' in n.dataset);
function place(container, list) {
  let cursor = null;
  for (const el of list) {
    let n = cursor ? cursor.nextSibling : container.firstChild;
    while (n && n !== el && !owned(n)) n = n.nextSibling;
    if (n !== el) {
      if (cursor) cursor.after(el);
      else container.insertBefore(el, n);
    }
    cursor = el;
  }
}

export const nav = { attach, register, unregister, unregisterAll, get, elementOf, setActive, setBadge, draw, has, arrange, isVisible, cleanModuleTools, bandOf, BANDS };
export default nav;
