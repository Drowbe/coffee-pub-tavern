import { loadBranding, api, wireOverlayBack, renderTopbar, escapeHtml, crumbLink, getIcons, setUpdateBadge, hasOwnerRights, roleLabel, word, setWords, applyWords, refreshModuleNav, themeMode } from '/brand.js';
import { pickBackground } from '/background-picker.js';
import { CHANGEABLE, DEFAULTS, words, fill as fillWords } from '/words.js';
import { renderOffer, switchQuestion } from '/template-offer.js';

const $ = (id) => document.getElementById(id);
const userCards = new Map(); // key -> the user's card element
let me = null;
let streamKey = '';
let streamShown = false;
// The environment this Manage page runs in, on a host with several (GET /api/me's `environment`): hosted says the host has
// environments, owner that the viewer is this one's admin (its owner), hostAdmin that the viewer is the host's own cross
// sign-in. What only the host may do is hidden from an owner; the Environment panel shows the plan and its use.
let environment = { hosted: false, owner: false, hostAdmin: false, slug: '', name: '' };
const hostOnlyHidden = () => environment.hosted && !environment.hostAdmin;
let users = [];

// The choices come from the Font Awesome list on the Theme tab. null (only with a template) is the template's own.
let selectedHomeIcon = 'couch';

// The template this environment was made from (plan-environment-templates.md; GET /api/settings' `template`: { id, name,
// appliedAt, skipped }), or null for none, and the owner's own words and home icon (`ownWords`, `ownHomeIcon`).
let madeFrom = null;
let ownWords = {};
let ownHomeIcon = null;
// What the template gives, whatever the owner has set over it (`templateWords`: { <key>: { one, many, a? } }, and
// `templateHomeIcon`), each null for none.
let templateWords = {};
let templateHomeIcon = null;
const DEFAULT_HOME_ICON = 'couch';
function useOwnerSettings(settings) {
  madeFrom = settings.template || null;
  ownWords = settings.ownWords || {};
  ownHomeIcon = settings.ownHomeIcon || null;
  templateWords = (madeFrom && settings.templateWords) || {};
  templateHomeIcon = (madeFrom && settings.templateHomeIcon) || null;
}

function buildHomeIconGrid() {
  const grid = $('set-home-icon');
  grid.textContent = '';
  for (const { id, classes, label } of getIcons()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = id;
    btn.title = label || id;
    btn.innerHTML = `<i class="${escapeHtml(classes)} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedHomeIcon = id;
      renderHomeIconSelection();
    });
    grid.appendChild(btn);
  }
}
function renderHomeIconSelection() {
  for (const btn of $('set-home-icon').children) btn.classList.toggle('selected', btn.dataset.icon === selectedHomeIcon);
  // With a template, its own icon is the first choice: "Template's own" (or "Default" when it gives none), saved as no
  // icon of the owner's, so the template's stays in use.
  const box = $('home-icon-template');
  box.hidden = !madeFrom;
  if (!madeFrom) return;
  const btn = $('home-icon-template-btn');
  const on = selectedHomeIcon === null;
  btn.querySelector('span').textContent = templateHomeIcon ? "Template's own" : 'Default';
  btn.querySelector('i').className = `fa-solid fa-${templateHomeIcon || DEFAULT_HOME_ICON} fa-fw`;
  btn.setAttribute('aria-pressed', String(on));
  $('home-icon-template-hint').textContent = on ? 'In use. Pick an icon below to choose your own.' : '';
}
$('home-icon-template-btn').addEventListener('click', () => {
  selectedHomeIcon = null;
  renderHomeIconSelection();
});

// A status line's message; a plain one clears after 3 s. Each new message cancels the last one's timer, so an earlier
// message's clearing never takes a later one with it (two saves within 3 s).
const sayTimers = new WeakMap();
function say(el, text, error = false) {
  clearTimeout(sayTimers.get(el));
  sayTimers.delete(el);
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) sayTimers.set(el, setTimeout(() => { sayTimers.delete(el); el.textContent = ''; }, 3000));
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

// Environment / Template / Theme / Spaces / Roles / Users / Modules / About tabs, remembered in the address
const TABS = ['environment', 'template', 'theme', 'spaces', 'roles', 'users', 'modules', 'about'];
// Their old names, from links and bookmarks: #settings and #server are the Environment tab, #rooms the Spaces tab.
const OLD_TABS = { settings: 'environment', server: 'environment', rooms: 'spaces' };
// Old names of sections that moved to the Template tab (addendum 2): a link to one opens the tab at it.
const OLD_SECTIONS = { words: 'words-panel', 'home-icon': 'home-icon-section' };
function selectTab(name) {
  if (OLD_TABS[name]) name = OLD_TABS[name];
  // A link to a section (an element's id, such as #words-panel or a module's row on the Template tab) opens its tab at it.
  const at = !TABS.includes(name) && name ? $(OLD_SECTIONS[name] || name) : null;
  const inTab = at && at.closest('section[id^="tab-"]');
  if (inTab) name = inTab.id.slice(4);
  const tab = TABS.includes(name) ? name : 'environment';
  for (const t of TABS) $(`tab-${t}`).hidden = tab !== t;
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  // A strip wider than the page scrolls inside itself (style.css): bring the chosen tab into it, the page left as it is.
  const strip = $('subtabs');
  const on = strip.querySelector('.subtab.active');
  if (on && strip.scrollWidth > strip.clientWidth) {
    const t = on.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    if (t.left < s.left) strip.scrollLeft += t.left - s.left;
    else if (t.right > s.right) strip.scrollLeft += t.right - s.right;
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  if (inTab) {
    at.scrollIntoView({ block: 'start' });
    const field = at.querySelector('input[type="text"]') || at.querySelector('input, select, button, summary');
    if (field) field.focus({ preventScroll: true });
  }
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
// A section drawn later (a module's row on the Template tab) is opened again once the page has drawn it (init).
const firstHash = location.hash.slice(1);
selectTab(firstHash);

$('add-toggle').addEventListener('click', () => {
  $('add-user').hidden = !$('add-user').hidden;
  if (!$('add-user').hidden) $('new-login').focus();
});
$('add-cancel').addEventListener('click', () => {
  $('add-user').hidden = true;
  $('add-user').reset();
  $('new-link').checked = true;
});

// A card is just a roster row now: status, a thumbnail, quick mute/kick for
// whoever is live, and a link to their profile page, which is the one place
// any of a user's own settings actually get edited (see profile.js).
function fill(card, user) {
  card.dataset.key = user.key;
  card.querySelector('[data-name]').textContent = user.displayName;
  card.querySelector('[data-login]').textContent = user.login;
  card.querySelector('[data-role]').textContent = roleLabel(user);
  card.querySelector('[data-key]').textContent = user.key;
  card.querySelector('[data-thumb]').src = imgUrl(user.key, 'profile');
  card.querySelector('[data-action="edit"]').href = `/profile/${encodeURIComponent(user.key)}`;
  card.querySelector('[data-mfa]').hidden = !user.mfaEnrolled;
  renderLive(card, user.online);
}

function renderLive(card, online) {
  const dot = card.querySelector('[data-dot]');
  dot.classList.toggle('online', !!online);
  dot.title = online ? 'in a call' : 'offline';
  const live = card.querySelector('[data-live]');
  const inSpace = online && online.space ? spaces.find((r) => r.id === online.space) : null;
  live.textContent = online ? `${inSpace ? `in ${inSpace.name} · ` : ''}${online.micOn ? 'mic on' : 'mic off'} · ${online.cameraOn ? 'camera on' : 'camera off'}` : '';
  card.querySelector('[data-action="mute"]').hidden = !online || !online.micOn;
  card.querySelector('[data-action="kick"]').hidden = !online;
}

function cardFor(user) {
  let card = userCards.get(user.key);
  if (card) return card;
  card = $('user-card').content.firstElementChild.cloneNode(true);
  userCards.set(user.key, card);
  $('users').appendChild(card);
  wire(card);
  return card;
}

function userOf(card) {
  return users.find((u) => u.key === card.dataset.key);
}

function wire(card) {
  card.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !card.contains(button)) return;
    const user = userOf(card);
    const action = button.dataset.action;
    if (action === 'mute') {
      api('POST', `/api/users/${user.key}/mute`, { muted: true }).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    } else if (action === 'kick') {
      if (!window.confirm(`Kick ${user.displayName} from the call? They can rejoin.`)) return;
      api('POST', `/api/users/${user.key}/kick`).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    }
  });
}

function renderUsers() {
  for (const user of users) fill(cardFor(user), user);
  for (const [key, card] of userCards) {
    if (!users.some((u) => u.key === key)) {
      card.remove();
      userCards.delete(key);
    }
  }
  $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} in a call`;
  renderSpaces(); // the member lists follow the users
}

async function refreshLive() {
  try {
    const status = await api('GET', '/api/status');
    const byKey = new Map(status.users.map((u) => [u.key, u]));
    users = users.map((u) => ({ ...u, online: byKey.get(u.key)?.online || null }));
    for (const user of users) renderLive(cardFor(user), user.online);
    $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} in a call`;
  } catch (err) {
    // leave the last known state
  }
}

async function loadUsers() {
  const status = await api('GET', '/api/status');
  users = status.users;
  spaces = status.spaces || spaces;
  renderUsers();
  renderModules(); // the "(not in <Lobby>)" hints, now the Lobby's name is known
  // The Words group's descriptions, now the Lobby's name is known (in place: nothing typed there is lost).
  for (const hint of document.querySelectorAll('#words-list [data-word-about]')) hint.textContent = wordAbout(hint.closest('[data-word-key]').dataset.wordKey);
}

// --- roles ---------------------------------------------------------------------
// A grid: one row per permission, one column per role. Owner is always all
// on and disabled; the other three save the moment a box is clicked.

const ROLE_COLUMNS = ['owner', 'moderator', 'member', 'guest'];

function renderRoles({ permissions, roles }) {
  const label = (role) => word(role, { cap: true });
  const rows = ['<thead><tr><th></th>' + ROLE_COLUMNS.map((role) => `<th>${escapeHtml(label(role))}</th>`).join('') + '</tr></thead><tbody>'];
  let group = null;
  for (const p of permissions) {
    if (p.group !== group) {
      group = p.group;
      rows.push(`<tr class="roles-group"><th colspan="${ROLE_COLUMNS.length + 1}">${escapeHtml(group)}</th></tr>`);
    }
    rows.push(`<tr><th scope="row">${escapeHtml(p.label)}</th>` + ROLE_COLUMNS.map((role) => {
      const noGuestAi = role === 'guest' && p.key === 'useAi'; // the server refuses guests whatever the box says
      const locked = role === 'owner' || noGuestAi;
      return `<td><input type="checkbox" data-role="${role}" data-perm="${p.key}" ${(roles[role] || {})[p.key] && !noGuestAi ? 'checked' : ''} ${locked ? `disabled title="${escapeHtml(noGuestAi ? `${word('guest', { many: true, cap: true })} can never use AI` : `${word('owner', { many: true, cap: true })} can always do this`)}"` : ''} aria-label="${escapeHtml(p.label)}, ${escapeHtml(label(role))}"></td>`;
    }).join('') + '</tr>');
  }
  rows.push('</tbody>');
  $('roles-table').innerHTML = rows.join('');
}
async function loadRoles() {
  renderRoles(await api('GET', '/api/roles'));
}
$('roles-table').addEventListener('change', async (event) => {
  const box = event.target;
  if (!box.dataset.role) return;
  try {
    await api('PATCH', `/api/roles/${box.dataset.role}`, { [box.dataset.perm]: box.checked });
    say($('roles-status'), 'saved');
  } catch (err) {
    box.checked = !box.checked;
    say($('roles-status'), err.message, true);
  }
});

// --- spaces ---------------------------------------------------------------------
// A roster, same as Users: click a space to configure it on its own page
// (/spaces/<id>) instead of editing it inline in this list.

let spaces = [];
const spaceRows = new Map();

function spaceRowFor(space) {
  let row = spaceRows.get(space.id);
  if (row) return row;
  row = $('space-card').content.firstElementChild.cloneNode(true);
  applyWords(row); // the template's data-fill (Edit space), in this environment's words
  row.dataset.space = space.id;
  spaceRows.set(space.id, row);
  $('spaces').appendChild(row);
  return row;
}

const PROFILE_LABELS = { roleplaying: 'Roleplaying', participants: 'Participants', characters: 'Characters' };

function fillSpaceRow(row, space, index) {
  const img = row.querySelector('[data-thumb]');
  img.hidden = !space.hasImage;
  if (space.hasImage) img.src = `/img/space/${space.id}?v=${Date.now()}`;
  row.querySelector('[data-thumb-fallback]').hidden = space.hasImage;
  row.querySelector('[data-name]').textContent = space.name;
  const count = space.isLobby ? users.length : space.members.length;
  const who = space.isLobby ? 'Everyone' : `${count} ${word('member', { many: count !== 1 })}`;
  row.querySelector('[data-meta]').textContent = `${who} · ${PROFILE_LABELS[space.profile] || 'Roleplaying'}`;
  row.querySelector('[data-action="edit"]').href = `/spaces/${encodeURIComponent(space.id)}`;
  row.classList.toggle('lobby', space.isLobby);
  // The Lobby always sits first and isn't reorderable; among the rest, hide
  // whichever arrow would be a no-op at that end of the list.
  row.querySelector('[data-action="space-up"]').hidden = space.isLobby || index <= 1;
  row.querySelector('[data-action="space-down"]').hidden = space.isLobby || index >= spaces.length - 1;
}

function renderSpaces() {
  spaces.forEach((space, index) => {
    const row = spaceRowFor(space);
    fillSpaceRow(row, space, index);
    $('spaces').appendChild(row); // also fixes the row's position after a reorder
  });
  for (const [id, row] of spaceRows) {
    if (!spaces.some((r) => r.id === id)) {
      row.remove();
      spaceRows.delete(id);
    }
  }
  $('spaces-status').textContent = `${spaces.length} ${word('space', { many: spaces.length !== 1 })}`;
  renderInviteSpaces();
}

async function saveSpaceOrder() {
  try {
    await api('POST', '/api/spaces/order', { order: spaces.filter((r) => !r.isLobby).map((r) => r.id) });
  } catch (err) {
    say($('spaces-status'), err.message, true);
  }
}

$('spaces').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="space-up"], [data-action="space-down"]');
  if (!button) return;
  const id = button.closest('.user-card').dataset.space;
  const index = spaces.findIndex((r) => r.id === id);
  const swapWith = button.dataset.action === 'space-up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= spaces.length || spaces[swapWith].isLobby) return;
  [spaces[index], spaces[swapWith]] = [spaces[swapWith], spaces[index]];
  renderSpaces();
  saveSpaceOrder();
});

$('add-space').addEventListener('click', async () => {
  try {
    const { space } = await api('POST', '/api/spaces', { name: `${word('space', { cap: true })} ${spaces.length}`, description: '', members: [] });
    location.href = `/spaces/${encodeURIComponent(space.id)}`; // set up members and an image right away
  } catch (err) {
    say($('spaces-status'), err.message, true);
  }
});

$('add-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('add-error').hidden = true;
  try {
    const { user } = await api('POST', '/api/users', {
      login: $('new-login').value,
      displayName: $('new-name').value,
      role: $('new-role').value,
      password: $('new-password').value,
      passwordless: $('new-link').checked,
    });
    users.push({ ...user, online: null });
    renderUsers();
    $('add-user').reset();
    $('new-link').checked = true;
    $('add-user').hidden = true;
    location.href = `/profile/${encodeURIComponent(user.key)}`; // set up their images etc. right away
  } catch (err) {
    $('add-error').textContent = err.message;
    $('add-error').hidden = false;
  }
});

async function saveSettings(patch, statusEl) {
  try {
    const answer = await api('PATCH', '/api/settings', patch);
    if (answer && answer.settings) {
      useOwnerSettings(answer.settings);
      renderHomeIconSelection();
    }
    await loadBranding();
    say(statusEl, 'saved');
  } catch (err) {
    say(statusEl, err.message, true);
  }
}
$('save-settings').addEventListener('click', () => saveSettings({ environmentName: $('set-environment-name').value }, $('settings-status')));
// The home icon, on the Template tab (addendum 2): saved on its own.
$('save-home-icon').addEventListener('click', () => saveSettings({ homeIcon: selectedHomeIcon }, $('home-icon-status')));
// --- words ---------------------------------------------------------------------
// The Words group (Environment tab): the ten level and role words an owner may change, each a singular, a plural and,
// when "a"/"an" is wrong for it, the singular with its article. Blank is the default, shown as the placeholder. Saved
// together with Save; Reset puts one back at once. The server checks every word and says why it refused one, and a
// refused save changes nothing. Host and admin are the host's own words, so they are not here.
const WORD_ABOUT = {
  environment: 'What people sign in to',
  space: 'Where people meet: {lobby}, and each one you add',
  aside: 'A short, private call apart from the {space}',
  canvas: 'Where {modules} are used in {a space}',
  module: 'A tool on the {canvas}',
  object: 'A thing {a module} holds: a task, a note',
  owner: 'Who runs the {environment}',
  moderator: 'Who runs things in one {space}',
  member: 'A person with an account',
  guest: 'A person in by {a guest} link',
};
// A word's description; the space word's names the Lobby by its own name (a template may rename it: "Home base"), or
// "the first one" until the spaces are loaded.
function wordAbout(key) {
  const lobby = spaces.find((sp) => sp.isLobby);
  const name = !lobby ? 'the first one' : lobby.name === 'Lobby' ? 'the Lobby' : lobby.name;
  return fillWords(WORD_ABOUT[key]).replace('{lobby}', name);
}
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
const capitalOf = (text) => text.charAt(0).toLocaleUpperCase('en') + text.slice(1);

function renderWords() {
  const list = $('words-list');
  const now = words();
  list.textContent = '';
  // With a template, a blank word is the template's (marked "From the template"), else the default.
  $('words-blank').textContent = madeFrom ? `Leave a word blank for the ${madeFrom.name || madeFrom.id} template's word, or the default where it gives none.` : 'Leave a word blank for its default.';
  const head = document.createElement('div');
  head.className = 'word-row word-row-head';
  head.setAttribute('aria-hidden', 'true');
  head.innerHTML = '<span></span><span class="field-label">Singular</span><span class="field-label">Plural</span><span class="field-label">With its article</span><span></span>';
  list.appendChild(head);
  for (const key of CHANGEABLE) {
    const d = DEFAULTS[key];
    const w = now[key];
    const own = Boolean(ownWords[key]);
    // What a blank field reads: the template's word where it gives one, else the default.
    const t = templateWords[key] || null;
    const base = t ? { one: t.one, many: t.many, a: t.a || usualArticle(t.one) } : { one: d.one, many: d.many, a: usualArticle(d.one) };
    const name = capitalOf(d.one);
    const note = !t ? '' : own ? `The template's: ${t.one}` : 'From the template';
    const back = t ? `Back to ${t.one}, the template's` : `Back to ${d.one}, the default`;
    const row = document.createElement('div');
    row.className = 'word-row';
    row.dataset.wordKey = key;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', name);
    row.innerHTML = `
      <div class="word-name"><strong>${escapeHtml(name)}</strong><span class="hint" data-word-about>${escapeHtml(wordAbout(key))}</span>${note ? `<span class="from-template">${escapeHtml(note)}</span>` : ''}</div>
      <label><span class="word-field-label">Singular</span><input type="text" data-word-part="one" maxlength="30" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.one)}" aria-label="${escapeHtml(name)}, singular${t ? `, blank for ${escapeHtml(t.one)}, the template's` : ''}"></label>
      <label><span class="word-field-label">Plural</span><input type="text" data-word-part="many" maxlength="30" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.many)}" aria-label="${escapeHtml(name)}, plural"></label>
      <label><span class="word-field-label">With its article</span><input type="text" data-word-part="a" maxlength="41" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.a)}" aria-label="${escapeHtml(name)}, with its article (optional)"></label>
      <button class="btn btn-small" type="button" data-word-reset ${own ? '' : 'disabled'} title="${escapeHtml(back)}" aria-label="Reset ${escapeHtml(name)}: ${escapeHtml(back.charAt(0).toLowerCase() + back.slice(1))}">Reset</button>`;
    const input = (part) => row.querySelector(`[data-word-part="${part}"]`);
    if (own) {
      input('one').value = w.one;
      input('many').value = w.many;
      if (w.a !== usualArticle(w.one)) input('a').value = w.a;
    }
    // The article's placeholder follows the singular being typed ("a trip"), so the usual one is always shown.
    const follow = () => { const typed = input('one').value.trim(); input('a').placeholder = typed ? usualArticle(typed) : base.a; };
    input('one').addEventListener('input', follow);
    follow();
    list.appendChild(row);
  }
}

// After the words change (`settings`: the PATCH's answer): the page's own words (data-word and data-fill are done by
// loadBranding), then the parts this page draws with word(), then the group itself.
async function wordsChanged(settings) {
  if (settings) useOwnerSettings(settings);
  await loadBranding();
  renderWords();
  loadRoles().catch(() => {});
  loadModules().catch(() => {});
  loadEnvironment().catch(() => {});
}

$('save-words').addEventListener('click', async () => {
  const patch = {};
  for (const row of $('words-list').querySelectorAll('[data-word-key]')) {
    const key = row.dataset.wordKey;
    const value = (part) => row.querySelector(`[data-word-part="${part}"]`).value.trim();
    const [one, many, a] = [value('one'), value('many'), value('a')];
    if (one || many || a) patch[key] = a ? { one, many, a } : { one, many };
    else if (ownWords[key]) patch[key] = null; // emptied: back to the template's word or the default
  }
  if (!Object.keys(patch).length) {
    say($('words-status'), 'nothing to save');
    return;
  }
  const button = $('save-words');
  button.disabled = true;
  try {
    const answer = await api('PATCH', '/api/settings', { words: patch });
    await wordsChanged(answer && answer.settings);
    say($('words-status'), 'saved');
  } catch (err) {
    say($('words-status'), err.message, true); // the server's own sentence; nothing was changed
  } finally {
    button.disabled = false;
  }
});

$('words-list').addEventListener('click', async (event) => {
  const reset = event.target.closest('[data-word-reset]');
  if (!reset) return;
  const key = reset.closest('[data-word-key]').dataset.wordKey;
  reset.disabled = true;
  try {
    const answer = await api('PATCH', '/api/settings', { words: { [key]: null } });
    await wordsChanged(answer && answer.settings);
    const t = templateWords[key];
    say($('words-status'), t ? `${capitalOf(DEFAULTS[key].one)} is back to ${t.one}, the template's` : `${capitalOf(DEFAULTS[key].one)} is back to its default`);
    $('words-list').querySelector(`[data-word-key="${key}"] [data-word-part="one"]`)?.focus();
  } catch (err) {
    reset.disabled = false;
    say($('words-status'), err.message, true);
  }
});

// Language, time and money: the currency list is the one every picker uses (window.hostCurrency, from /sdk/host.js): the
// common ones first, then every other the server takes, by name, plus whatever is set if it is in neither (so a code chosen
// elsewhere is shown, not lost). Without the server's list it falls back to the browser's.
async function fillCurrencies(current) {
  const select = $('set-currency');
  window.hostCurrency.fill(select, { value: current }); // at once, so Save never sends an empty choice
  let currencies = null;
  try { ({ currencies } = await api('GET', '/api/currencies')); } catch (err) { return; }
  window.hostCurrency.fill(select, { value: select.value || current, currencies });
}
$('save-locale').addEventListener('click', () => saveSettings({ language: $('set-language').value, clock: $('set-clock').value, currency: $('set-currency').value }, $('locale-status')));
$('save-features').addEventListener('click', () => saveSettings({
  maxQuality: Number($('set-max-quality').value),
  allowScreenShare: $('set-allow-screen-share').checked,
  allowAsides: $('set-allow-asides').checked,
  allowPrivate: $('set-allow-private').checked,
  allowReactions: $('set-allow-reactions').checked,
}, $('features-status')));
$('save-login').addEventListener('click', () => saveSettings({ loginText: $('set-login-text').value, mfaRequired: $('set-mfa-required').checked }, $('login-status')));

// --- theme -------------------------------------------------------------------
// A chooser (Strong Coffee, the default, + every saved theme) and a
// Light/Dark switch, plus the same seven color inputs, used to create/edit
// whichever theme and mode is picked rather than a single live override.
// Every theme holds a light and a dark set (either may be missing: the
// other then stands in); Strong Coffee's two come from the server and
// can't be edited.
const THEME_FIELDS = [
  ['theme-bg', '--bg', 'bg'],
  ['theme-bg-section', '--bg-section', 'bgSection'],
  ['theme-border', '--border', 'border'],
  ['theme-text', '--text', 'text'],
  ['theme-text-dim', '--text-dim', 'textDim'],
  ['theme-accent', '--accent', 'accent'],
  ['theme-on-accent', '--on-accent', 'onAccent'],
];
// Colors a theme may leave on Auto (the stylesheet derives them). For an Auto
// field the preview sets the same formula style.css uses, so what you see is
// right whichever theme happens to be live.
const THEME_OPTIONAL_FIELDS = [
  ['theme-card', '--bg-card', 'card', 'var(--bg-input)'],
  ['theme-header-bg', '--header-bg', 'headerBg', 'var(--bg)'],
  ['theme-header-text', '--header-text', 'headerText', 'var(--text)'],
  ['theme-icon', '--icon', 'icon', 'initial'], // initial: unset, so the fallbacks in style.css apply
  ['theme-icon-hover', '--icon-hover', 'iconHover', 'var(--accent)'],
  ['theme-primary-hover', '--primary-hover', 'primaryHover', 'var(--accent-hover)'],
  ['theme-secondary', '--secondary', 'secondary', 'var(--surface)'],
  ['theme-secondary-text', '--secondary-text', 'secondaryText', 'var(--text)'],
  ['theme-secondary-hover', '--secondary-hover', 'secondaryHover', 'var(--surface-hover)'],
];
const autoBox = (id) => document.querySelector(`[data-auto-for="${id}"]`);
const isAuto = (id) => autoBox(id).checked;
let colorProbeCtx = null;
// Any CSS color (including color-mix results) as #rrggbb for a color input.
function toHex(cssColor) {
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  // color-mix() results serialize as color(srgb r g b) with 0-1 channels.
  const srgb = String(cssColor).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return '#' + srgb.slice(1, 4).map((n) => hex2(Number(n) * 255)).join('');
  colorProbeCtx ||= document.createElement('canvas').getContext('2d');
  colorProbeCtx.fillStyle = '#000000';
  colorProbeCtx.fillStyle = cssColor;
  const v = colorProbeCtx.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
}
function resolvedVar(cssVar) {
  const probe = document.createElement('span');
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return toHex(color);
}
let themes = [];
let defaultTheme = null; // Strong Coffee: { name, light, dark }
let activeThemeId = null; // what's actually live right now (persisted)
let activeMode = 'dark';
let selectedThemeId = null; // whatever the dropdown/editor is showing -- may not be applied yet
let selectedMode = 'dark';
// Whether the page shows the editor's colors (a theme, mode or color picked here and not yet applied) instead of its
// own live look. Until something is picked here, the page keeps the live theme in the viewer's own light or dark (the
// header's switch), so that switch works on this page too.
let previewing = false;

const selectedTheme = () => themes.find((t) => t.id === selectedThemeId) || null;
// The colors the editor shows: the picked theme's set for the picked mode, or its other set when it has no such one yet.
function selectedColors() {
  const theme = selectedTheme() || defaultTheme;
  return theme[selectedMode] || theme.light || theme.dark;
}
function loadThemeInputsFrom(colors) {
  for (const [id, , key] of THEME_FIELDS) $(id).value = colors[key];
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) {
    const auto = !colors[key];
    autoBox(id).checked = auto;
    $(id).disabled = auto;
    if (!auto) $(id).value = colors[key];
  }
}
// Sets these straight on :root (not just a scoped preview box) -- several
// other rules (button surfaces, hover shades) are themselves computed FROM
// these seven with color-mix(), and that only recomputes for real when the
// values it references change at the SAME element custom properties
// inherit their already-resolved value, they don't re-substitute var() per
// descendant. Root it is; this only previews locally until Apply actually
// persists it. Not previewing, the colors go on only long enough to read the Auto fields' values, and come off again
// before the page paints.
function updateThemePreview() {
  const root = document.documentElement;
  for (const [id, cssVar] of THEME_FIELDS) root.style.setProperty(cssVar, $(id).value);
  for (const [id, cssVar, , formula] of THEME_OPTIONAL_FIELDS) {
    root.style.setProperty(cssVar, isAuto(id) ? formula : $(id).value);
  }
  // An Auto field shows what it currently works out to.
  for (const [id, cssVar] of THEME_OPTIONAL_FIELDS) {
    if (!isAuto(id)) continue;
    // --icon has no value when Auto; show what an icon in the sample header actually draws.
    $(id).value = cssVar === '--icon'
      ? toHex(getComputedStyle(document.querySelector('.theme-preview-header .icon-link')).color)
      : resolvedVar(cssVar);
  }
  if (!previewing) clearThemePreview();
}
// A change made here: the page previews it from now until Apply.
function previewThemeEdit() {
  previewing = true;
  updateThemePreview();
}
// The header's switch, or a theme another page applied, changed the live look: the Auto fields read it again.
document.addEventListener('app:theme', () => {
  if (!previewing && defaultTheme) updateThemePreview();
});
function clearThemePreview() {
  const root = document.documentElement;
  for (const [, cssVar] of THEME_FIELDS) root.style.removeProperty(cssVar);
  for (const [, cssVar] of THEME_OPTIONAL_FIELDS) root.style.removeProperty(cssVar);
}
for (const [id] of THEME_FIELDS) $(id).addEventListener('input', previewThemeEdit);
for (const [id] of THEME_OPTIONAL_FIELDS) {
  $(id).addEventListener('input', previewThemeEdit);
  autoBox(id).addEventListener('change', () => {
    $(id).disabled = autoBox(id).checked;
    previewThemeEdit();
  });
}
// The colors to save: the seven, and each optional one or null when on Auto.
function themeColors() {
  const colors = {};
  for (const [id, , key] of THEME_FIELDS) colors[key] = $(id).value;
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) colors[key] = isAuto(id) ? null : $(id).value;
  return colors;
}
// /theme.css only changes what the *server* sends on the *next* request --
// this page's own <link> already fetched the old one. Re-pointing it at a
// cache-busted URL and waiting for it to load is what makes actually
// applying a theme visibly repaint this page too, not just the next page
// someone opens.
function reloadThemeStylesheet() {
  return new Promise((resolve) => {
    const link = $('theme-link');
    const onLoad = () => { link.removeEventListener('load', onLoad); resolve(); };
    link.addEventListener('load', onLoad);
    link.setAttribute('href', `/theme.css?v=${Date.now().toString(36)}`); // kept relative: brand.js finds it by its start
  });
}
function renderThemeChooser() {
  const select = $('theme-select');
  select.innerHTML = `<option value="">${escapeHtml(defaultTheme.name)} (Default)</option>` + themes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  select.value = selectedThemeId || '';
  const selected = selectedTheme();
  $('theme-mode').setAttribute('aria-checked', String(selectedMode === 'dark'));
  $('theme-mode').title = selectedMode === 'dark' ? 'The default is dark: switch to light' : 'The default is light: switch to dark';
  $('theme-update-name').textContent = selected ? `${selected.name}, ${selectedMode}` : '';
  $('theme-update').hidden = !selected;
  $('theme-delete').hidden = !selected;
  $('theme-apply').disabled = selectedThemeId === activeThemeId && selectedMode === activeMode;
  // Export: the saved theme in the chooser, as a file (Strong Coffee is "default"). The server names the download.
  $('theme-export').href = `/api/themes/${encodeURIComponent(selectedThemeId || 'default')}/export`;
  // Who made an imported theme: shown, never edited here (plan-themes.md).
  $('theme-author').textContent = selected?.author ? `Made by ${selected.author}` : '';
  $('theme-author').hidden = !selected?.author;
}
// What the last import said: stays until another theme is picked, so a list of what was left out can be read.
function sayImport(text, error = false) {
  $('theme-import-status').textContent = text;
  $('theme-import-status').classList.toggle('error', error);
  $('theme-import-status').hidden = !text;
}
// Picking a theme or a mode: into the editor and the preview, not live until Apply.
function showSelectedTheme() {
  renderThemeChooser();
  // A theme with only one set shows it in both modes until Update saves the other.
  const missing = selectedTheme() && !selectedTheme()[selectedMode];
  say($('theme-status'), missing ? `no ${selectedMode} version yet -- Update saves one` : '');
  loadThemeInputsFrom(selectedColors());
  updateThemePreview();
}
async function loadThemes() {
  const data = await api('GET', '/api/themes');
  themes = data.themes;
  defaultTheme = data.defaultTheme;
  activeThemeId = data.activeThemeId;
  activeMode = data.themeMode === 'light' ? 'light' : 'dark';
  selectedThemeId = activeThemeId;
  selectedMode = activeMode;
  showSelectedTheme();
}
// Browsing the dropdown only previews -- it takes an explicit Apply to
// actually persist and go live, rather than every click through the list
// changing what everyone else sees.
$('theme-select').addEventListener('change', () => {
  sayImport('');
  selectedThemeId = $('theme-select').value || null;
  previewing = true;
  showSelectedTheme();
});
$('theme-mode').addEventListener('click', () => {
  selectedMode = selectedMode === 'dark' ? 'light' : 'dark';
  previewing = true;
  showSelectedTheme();
});
// Apply puts the theme live, and its mode as the default: every open page follows at once (the notifications stream's
// 'theme' event, brand.js). Someone who picked their own light or dark with the header's switch keeps it, this owner too.
$('theme-apply').addEventListener('click', async () => {
  await saveSettings({ activeThemeId: selectedThemeId, themeMode: selectedMode }, $('theme-status'));
  if ($('theme-status').classList.contains('error')) return;
  await reloadThemeStylesheet();
  previewing = false;
  clearThemePreview();
  activeThemeId = selectedThemeId;
  activeMode = selectedMode;
  renderThemeChooser();
  const own = themeMode();
  say($('theme-status'), own === selectedMode ? 'applied' : `applied -- you still see ${own}, your own pick (the switch at the top)`);
});
// Import…: a theme file (plan-themes.md), read here and sent as its text; the server checks it and adds it as a new
// theme ("Name (2)" when the name is taken). It is chosen and previewed, never applied: Apply does that, as for any theme.
$('theme-import').addEventListener('click', () => $('theme-import-file').click());
// A file's text: UTF-16 when it starts with that byte order mark (FE FF or FF FE, as some editors save), else UTF-8.
async function themeFileText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}
$('theme-import-file').addEventListener('change', async () => {
  const input = $('theme-import-file');
  const file = input.files[0];
  input.value = ''; // the same file can be picked again
  if (!file) return;
  sayImport('');
  // Far bigger than any theme (the server takes 16 KB): not read at all.
  if (file.size > 1024 * 1024) return sayImport("That isn't a Magpie theme file.", true);
  try {
    const { theme, dropped } = await api('POST', '/api/themes/import', new Blob([await themeFileText(file)], { type: 'text/plain' }));
    themes.push(theme);
    selectedThemeId = theme.id;
    previewing = true;
    showSelectedTheme();
    const left = Array.isArray(dropped) && dropped.length ? ` Left out: ${dropped.join(', ')}.` : '';
    sayImport(`Imported ${theme.name}${theme.author ? ` by ${theme.author}` : ''}.${left} Apply to use it.`);
  } catch (err) {
    sayImport(err.message, true);
  }
});
$('theme-save-new').addEventListener('click', async () => {
  const name = window.prompt('Name this theme:');
  if (!name) return;
  const colors = themeColors();
  try {
    const { theme } = await api('POST', '/api/themes', { name, mode: selectedMode, ...colors });
    themes.push(theme);
    selectedThemeId = theme.id;
    renderThemeChooser();
    say($('theme-status'), 'saved -- Apply to go live');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-update').addEventListener('click', async () => {
  if (!selectedThemeId) return;
  const colors = themeColors();
  try {
    const { theme } = await api('PATCH', `/api/themes/${selectedThemeId}`, { mode: selectedMode, ...colors });
    themes = themes.map((t) => (t.id === theme.id ? theme : t));
    renderThemeChooser();
    // Only reapplies for real if this is the theme and mode actually live
    // right now -- editing one you're just browsing shouldn't make it live.
    if (selectedThemeId === activeThemeId && selectedMode === activeMode) {
      await reloadThemeStylesheet();
      previewing = false;
      clearThemePreview();
    }
    say($('theme-status'), 'saved');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-delete').addEventListener('click', async () => {
  const selected = themes.find((t) => t.id === selectedThemeId);
  if (!selected) return;
  if (!window.confirm(`Delete the theme "${selected.name}"? This can't be undone.`)) return;
  try {
    await api('DELETE', `/api/themes/${selected.id}`);
    themes = themes.filter((t) => t.id !== selected.id);
    // The server already fell back activeThemeId to the default if this was
    // the live one -- mirror that here rather than leaving a dangling
    // reference to a theme that no longer exists.
    const wasActive = activeThemeId === selected.id;
    if (wasActive) activeThemeId = null;
    selectedThemeId = activeThemeId;
    renderThemeChooser();
    loadThemeInputsFrom(selectedColors());
    previewing = false; // back on the live theme: the page shows its own look again
    updateThemePreview();
    if (wasActive) {
      await reloadThemeStylesheet();
      previewing = false;
      clearThemePreview();
    }
    say($('theme-status'), 'deleted');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('save-registration').addEventListener('click', () => saveSettings({ allowRegistration: $('set-allow-registration').checked }, $('registration-status')));

// --- invites -----------------------------------------------------------------

function renderInviteSpaces() {
  const container = $('invite-spaces');
  const keep = new Set();
  for (const space of spaces) {
    if (space.isLobby) continue; // everyone is already there; nothing to pick
    keep.add(space.id);
    let label = container.querySelector(`[data-space="${CSS.escape(space.id)}"]`);
    if (!label) {
      label = document.createElement('label');
      label.className = 'member member-toggle';
      label.dataset.space = space.id;
      const input = document.createElement('input');
      input.type = 'checkbox';
      const name = document.createElement('span');
      name.className = 'member-name';
      label.append(input, name);
      container.appendChild(label);
    }
    label.querySelector('.member-name').textContent = space.name;
  }
  for (const label of [...container.children]) if (!keep.has(label.dataset.space)) label.remove();
}

$('invite-spaces').addEventListener('change', (event) => {
  event.target.closest('.member-toggle')?.classList.toggle('online', event.target.checked);
});

$('make-invite').addEventListener('click', async () => {
  try {
    const spaceIds = [...$('invite-spaces').querySelectorAll('input:checked')].map((i) => i.closest('[data-space]').dataset.space);
    const { invite } = await api('POST', '/api/invites', { spaces: spaceIds });
    $('invite-link').textContent = invite.url;
    $('invite-link-row').hidden = false;
    say($('invite-status'), 'link made');
  } catch (err) {
    say($('invite-status'), err.message, true);
  }
});
$('invite-copy').addEventListener('click', () => copy($('invite-link').textContent, $('invite-status')));

// --- reactions --------------------------------------------------------------

function reactionRow(reaction) {
  const row = $('reaction-row').content.firstElementChild.cloneNode(true);
  row.dataset.id = reaction?.id || '';
  row.querySelector('.reaction-glyph').value = reaction?.glyph || '';
  row.querySelector('.reaction-label').value = reaction?.label || '';
  return row;
}

function renderReactionRows(reactions) {
  const list = $('reactions-list');
  list.textContent = '';
  for (const r of reactions || []) list.appendChild(reactionRow(r));
}

function slugify(text) {
  return String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

$('reactions-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.reaction-row');
  if (button.dataset.action === 'reaction-remove') row.remove();
  else if (button.dataset.action === 'reaction-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'reaction-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('reaction-add').addEventListener('click', () => $('reactions-list').appendChild(reactionRow()));

$('save-reactions').addEventListener('click', async () => {
  const seen = new Set();
  const reactions = [...$('reactions-list').querySelectorAll('.reaction-row')]
    .map((row) => {
      const glyph = row.querySelector('.reaction-glyph').value.trim();
      const label = row.querySelector('.reaction-label').value.trim();
      let id = row.dataset.id || slugify(label) || slugify(glyph);
      if (!id || seen.has(id)) id = `r${Math.random().toString(36).slice(2, 8)}`;
      seen.add(id);
      return { id, glyph, label };
    })
    .filter((r) => r.glyph);
  try {
    const { settings } = await api('PATCH', '/api/settings', { reactions });
    renderReactionRows(settings.reactions);
    say($('reactions-status'), 'saved');
  } catch (err) {
    say($('reactions-status'), err.message, true);
  }
});

// --- modules ----------------------------------------------------------------
// Upload a zip, review what it asks for, enable it. See docs/MODULES.md.
let installedModules = [];
let builtinModules = [];
let bundledModules = []; // the modules that ship with this server, and whether each is installed or has an update
// What this environment calls a module and shows it as (plan-environment-templates.md, "Module display names and icons"):
// its display name and icon, else its own (the manifest's `name` and `icon`, which the card keeps beside them).
const shownName = (m) => (m && (m.displayName || m.name)) || '';
const shownIcon = (m) => (m && (m.displayIcon || m.icon)) || 'puzzle-piece';
// Any module's name as shown, by id: installed first, then the ones that ship with the server.
const shownNameOf = (id) => shownName(installedModules.find((m) => m.id === id) || bundledModules.find((b) => b.id === id)) || id;

async function loadModules() {
  const data = await api('GET', '/api/modules');
  installedModules = data.modules;
  builtinModules = data.builtin || [];
  bundledModules = data.bundled || [];
  renderModules();
  renderModuleNames();
  renderTemplateNote();
  loadActivity();
  loadAi();
  // Say on the tab itself when an update is waiting, so it is seen without opening it.
  const updates = bundledModules.filter((b) => b.update).length;
  setUpdateBadge(updates);
  // The same count badge as on the header's gear (see setUpdateBadge in brand.js).
  const tab = document.querySelector('[data-tab="modules"]');
  if (tab) {
    tab.textContent = word('module', { many: true, cap: true });
    tab.title = '';
    if (updates) {
      const badge = document.createElement('span');
      badge.className = 'badge update-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = updates > 9 ? '9+' : String(updates);
      tab.append(badge);
      tab.title = `${updates} ${word('module')} update${updates === 1 ? '' : 's'} available`;
    }
  }
}

// What a module needs turned on first, as HTML: the AI service (with the way to its page), or another module.
const needsText = (r) => (r === 'ai' ? '<a href="/ai-config.html">the AI service</a> enabled' : `${escapeHtml(shownNameOf(r))} installed and turned on`);

// What a bundled module still needs before it can be turned on (Maps needs Places): said in its row of the list, so the
// admin installs those first instead of meeting a disabled Approve button afterwards.
function bundledNeeds(b) {
  const waiting = (b.requires || []).filter((r) => !installedModules.some((m) => m.id === r && m.enabled));
  if (!waiting.length) return '';
  const name = shownNameOf;
  return `<div class="hint module-needs"><i class="fa-solid fa-circle-info fa-fw" aria-hidden="true"></i> Needs ${waiting.map((r) => `<strong>${escapeHtml(name(r))}</strong>`).join(' and ')} installed and turned on first.</div>`;
}

function moduleCard(m) {
  // Where it shows (a person's own data is not a place of its own).
  // An outdated module's old scopes are not read, so it has no place to show: say why instead.
  const scopes = m.outdated ? 'Can\'t run until it is updated' : m.scope.filter((s) => s !== 'person').map((s) => (s === 'environment' ? `${word('environment', { cap: true })} page` : `${word('space', { cap: true })} ${word('canvas')}`)).join(' + ');
  // Versions built for an older Magpie can't be switched to: marked, and not offered.
  const staleVersions = new Set(m.outdatedVersions || (m.outdated ? [m.version] : []));
  // What a requirement needs to be turned on first (one built for an older Magpie is in needsUpdate instead).
  const nameOf = (r) => escapeHtml(shownName(installedModules.find((x) => x.id === r)) || r);
  const asks = [
    ...m.permissions.map((p) => `<li><strong>${escapeHtml(p.label)}</strong> <span class="hint">permission, appears in Roles</span></li>`),
    ...(m.hooks.schedule ? ['<li><strong>Run things on a schedule</strong> <span class="hint">reminders and timed events</span></li>'] : []),
    ...(m.hooks.notify ? ['<li><strong>Send notifications</strong> <span class="hint">to people using it</span></li>'] : []),
    ...(m.events && m.events.subscribes.length ? [`<li><strong>Hear what happens in other ${escapeHtml(word('module', { many: true }))}</strong> <span class="hint">${escapeHtml(m.events.subscribes.map((c) => c === '*' ? `any ${word('module')}` : c.replace(':', ' ')).join(', '))}: their events, only for people who can see them</span></li>`] : []),
    ...(m.actions && m.actions.uses.length ? [`<li><strong>Ask other ${escapeHtml(word('module', { many: true }))} to do things</strong> <span class="hint">${escapeHtml(m.actions.uses.map((c) => c === '*' ? `any ${word('module')}` : c.replace(':', ' ')).join(', '))}: each request is carried out by the ${escapeHtml(word('module'))} that owns the action</span></li>`] : []),
    ...(m.refs && m.refs.consumes.length ? [`<li><strong>Link to other ${escapeHtml(word('module', { many: true }))}' ${escapeHtml(word('object', { many: true }))}</strong> <span class="hint">${escapeHtml(m.refs.consumes.map((c) => c.replace(':', ' ')).join(', '))}, shown only to people who can already see them</span></li>`] : []),
  ];
  const modeTag = m.runMode === 'page' ? '<span class="pill warn">In the page</span>' : '<span class="pill">Sandboxed</span>';
  const state = modeTag + ' ' + (m.outdated ? '<span class="pill warn">Needs an update</span>' : m.enabled ? '<span class="pill on">Enabled</span>' : m.needsApproval ? '<span class="pill warn">Needs approval</span>' : '<span class="pill">Disabled</span>');
  const several = m.versions.length > 1; // the picker lists every kept version, the running one selected
  const el = document.createElement('article');
  el.className = 'panel module-card';
  el.dataset.id = m.id;
  el.innerHTML = `
    <div class="module-head">
      <i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw module-icon" aria-hidden="true"></i>
      <div class="grow"><h2>${escapeHtml(shownName(m))} <span class="hint">${m.displayName ? `${escapeHtml(m.name)} ` : ''}v${escapeHtml(m.version)}${m.author ? ' by ' + escapeHtml(m.author) : ''}</span></h2>
        <div class="hint">${escapeHtml(scopes)}</div></div>
      ${state}
    </div>
    ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ''}
    ${shownAsLink(m)}
    <p class="hint">${asks.length ? (m.needsApproval ? 'Asks for these -- enabling approves them:' : 'Approved to:') : 'Asks for nothing beyond showing itself.'}</p>
    ${asks.length ? `<ul class="module-asks">${asks.join('')}</ul>` : ''}
    <div class="module-runmode">
      <p class="hint"><strong>${m.runMode === 'page' ? 'Runs in the page' : 'Runs sandboxed'}</strong>${m.source === 'bundled' ? ', ships with this server' : ', uploaded'}. ${m.runMode === 'page' ? `It can read and change anything on the page, including what you can see and do. Only allow that for ${escapeHtml(word('module', { a: true }))} you trust.` : `It is walled off in its own frame and can only reach the host through its approved permissions. ${escapeHtml(word('module', { a: true, cap: true }))} in a frame cannot take part in drag and drop between ${escapeHtml(word('module', { many: true }))}.`}</p>
      ${m.source === 'bundled' || m.outdated || hostOnlyHidden() ? '' : `<button class="btn" data-module-runmode="${m.runMode === 'page' ? 'sandbox' : 'page'}" type="button">${m.runMode === 'page' ? 'Switch back to sandboxed' : 'Run in the page...'}</button>`}
    </div>
    ${m.scope.includes('space') && !m.outdated ? `<label class="check"><input type="checkbox" data-module-all-spaces ${m.allSpaces ? 'checked' : ''}> Available in every ${escapeHtml(word('space'))}${m.lobby === false ? ` <span class="hint">${escapeHtml(notInLobby())}</span>` : ''}</label>` : ''}
    <div class="row">
      ${m.outdated || m.needsUpdate?.length ? '' : isConfigurable(m) ? `<a class="btn" href="/module-config.html?id=${encodeURIComponent(m.id)}" title="Change what ${escapeHtml(shownName(m))} does in this ${escapeHtml(word('environment'))}"><i class="fa-solid fa-sliders fa-fw" aria-hidden="true"></i> ${escapeHtml(word('module', { cap: true }))} Configuration</a>` : `<button class="btn" type="button" disabled title="${escapeHtml(shownName(m))} has no settings"><i class="fa-solid fa-sliders fa-fw" aria-hidden="true"></i> ${escapeHtml(word('module', { cap: true }))} Configuration</button><span class="hint">No settings.</span>`}
      ${m.outdated ? '' : `<button class="btn ${m.enabled ? '' : 'btn-primary'}" data-module-action="toggle" type="button" ${!m.enabled && (m.missing?.length || m.needsUpdate?.length) ? 'disabled' : ''}>${m.enabled ? 'Disable' : m.needsApproval ? 'Approve and enable' : 'Enable'}</button>`}
      ${!m.outdated && !m.enabled && m.missing?.length ? `<span class="hint">Needs ${m.missing.map(needsText).join(', and ')} first.</span>` : ''}
      ${!m.outdated && m.needsUpdate?.length ? `<span class="hint">Needs ${m.needsUpdate.map(nameOf).join(' and ')}, which ${m.needsUpdate.length === 1 ? 'needs' : 'need'} an update from ${m.needsUpdate.length === 1 ? 'its author' : 'their authors'}.</span>` : ''}
      ${several ? `<select data-module-version aria-label="Version">${m.versions.map((v) => `<option value="${escapeHtml(v)}"${v === m.version ? ' selected' : ''}${staleVersions.has(v) && v !== m.version ? ' disabled' : ''}>${escapeHtml(v)}${v === m.version ? ' (current)' : ''}${staleVersions.has(v) ? ' (needs an update)' : ''}</option>`).join('')}</select><button class="btn" data-module-action="rollback" type="button" disabled>Switch to this version</button>` : ''}
      <button class="btn btn-danger" data-module-action="uninstall" type="button">Uninstall</button>
    </div>`;
  // Built for an older Magpie (its module.json uses a name that has since changed): it can't be turned on until its author
  // updates it. Say so plainly, and what exactly, and offer no Enable; Update, another version and Uninstall still work.
  if (m.outdated) {
    const why = document.createElement('div');
    why.className = 'module-outdated';
    why.setAttribute('role', 'note');
    why.innerHTML = `<i class="fa-solid fa-triangle-exclamation fa-fw" aria-hidden="true"></i> <div><strong>${escapeHtml(m.outdated)}</strong>${m.outdatedWhy ? `<div class="hint">${escapeHtml(m.outdatedWhy)}</div>` : ''}</div>`;
    el.querySelector('.module-head').after(why);
  }
  // A newer version ships with this server: offer it, no zip to upload.
  const newer = bundledModules.find((b) => b.id === m.id && b.update);
  if (newer) {
    const note = document.createElement('div');
    note.className = 'module-update';
    note.innerHTML = `<span class="pill warn">Update available</span> <strong>Version ${escapeHtml(newer.version)}</strong> comes with this server. <button class="btn btn-primary btn-small" data-bundled-action="install" data-bundled-id="${escapeHtml(newer.id)}" type="button">Update to ${escapeHtml(newer.version)}</button> <span class="hint">Your data stays as it is, and you can switch back below. If it asks for anything new you approve it first.</span>`;
    (el.querySelector('.module-outdated') || el.querySelector('.module-head')).after(note);
  }
  return el;
}

// What this environment calls a module and the icon it wears (plan-environment-templates.md, "Module display names and
// icons"), on each card, built-in modules too: a name (blank for the module's own), an icon from the same list as the
// home icon, Save, and Reset back to the module's own. The server checks both and says why it refused one; a refused
// save changes nothing. Its own name and version stay beside the display name in the card's heading.
// The icons offered: this environment's (Theme tab) that draw as a plain solid Font Awesome icon, as every module icon
// does, then every module's own icon.
function displayIconChoices() {
  const out = new Map();
  for (const i of getIcons()) {
    const tokens = String(i.classes || '').split(/\s+/).filter((t) => t && !/^fa-(fw|lg|xs|sm|2x|3x)$/.test(t));
    if (tokens.length === 2 && tokens.includes('fa-solid') && tokens.includes(`fa-${i.id}`)) out.set(i.id, i.label || i.id.replace(/-/g, ' '));
  }
  for (const m of [...builtinModules, ...installedModules]) if (m.icon && !out.has(m.icon)) out.set(m.icon, m.icon.replace(/-/g, ' '));
  return [...out];
}
// What the template gives a module (`templateDisplayName`, `templateDisplayIcon`): { name, icon }, each null for none.
const templateDisplay = (m) => ({ name: m.templateDisplayName || null, icon: m.templateDisplayIcon || null });
function displayEditor(m) {
  // What a blank field and "its own icon" mean: the template's name and icon where it gives them, else the module's own.
  const t = templateDisplay(m);
  const fallbackName = m.ownDisplayName ? t.name || m.name : shownName(m);
  const fallbackIcon = m.ownDisplayIcon ? t.icon || m.icon : shownIcon(m);
  const chosen = m.ownDisplayIcon || '';
  const own = Boolean(m.ownDisplayName || m.ownDisplayIcon);
  const fromT = Boolean(t.name || t.icon);
  const back = fromT ? "Back to the template's name and icon" : 'Back to its own name and icon';
  const note = !fromT ? '' : own ? (t.name ? `The template's: ${t.name}` : '') : 'From the template';
  const firstIcon = t.icon ? "The template's icon" : 'Its own icon';
  const iconButton = (id, label, pressed) => `<button type="button" data-display-icon="${escapeHtml(id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${pressed}"${pressed ? ' class="selected"' : ''}><i class="fa-solid fa-${escapeHtml(id || fallbackIcon)} fa-fw" aria-hidden="true"></i></button>`;
  return `<div class="module-display" data-display-id="${escapeHtml(m.id)}" data-display-chosen="${escapeHtml(chosen)}" data-display-fallback="${escapeHtml(fallbackIcon)}" data-display-was-name="${escapeHtml(m.ownDisplayName || '')}" data-display-was-icon="${escapeHtml(chosen)}"${own ? ' data-display-own="1"' : ''} role="group" aria-label="What this ${escapeHtml(word('environment'))} calls it">
      <div class="module-display-head"><span class="field-label">Shown as</span>${note ? `<span class="from-template">${escapeHtml(note)}</span>` : ''}</div>
      <div class="module-display-row">
        <details class="icon-pick"><summary title="Icon" aria-label="Icon: ${escapeHtml(chosen || (t.icon ? "the template's" : 'its own'))}"><i class="fa-solid fa-${escapeHtml(chosen || fallbackIcon)} fa-fw" aria-hidden="true"></i></summary><div class="icon-grid" role="group" aria-label="Icon">${iconButton('', firstIcon, !chosen)}${displayIconChoices().map(([id, label]) => iconButton(id, label, id === chosen)).join('')}</div></details>
        <input type="text" data-display-name maxlength="40" autocomplete="off" spellcheck="false" value="${escapeHtml(m.ownDisplayName || '')}" placeholder="${escapeHtml(fallbackName)}" aria-label="Display name (blank for ${escapeHtml(fallbackName)})">
        <button class="btn btn-small" type="button" data-display-save>Save</button>
        <button class="btn btn-small" type="button" data-display-reset ${own ? '' : 'disabled'} title="${escapeHtml(back)}" data-display-back="${escapeHtml(back)}">Reset</button>
      </div>
      <span class="status" data-display-status aria-live="polite"></span>
    </div>`;
}
// The Lobby's own name here ("Home base" under the travel template), and the hint beside "every space" for a module
// not made for it (plan-modules, "the Lobby is for being together": the server keeps it out of the Lobby).
const lobbyName = () => spaces.find((sp) => sp.isLobby)?.name || 'the Lobby';
const notInLobby = () => `(not in ${lobbyName()})`;
// On a Modules card: the name and icon it is shown as, and a link to its row on the Template tab, where they change.
function shownAsLink(m) {
  return `<div class="module-shown-as"><span class="field-label">Shown as</span> <span><i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw" aria-hidden="true"></i> ${escapeHtml(shownName(m))}</span> <a href="#template-module-${escapeHtml(m.id)}" aria-label="Change the name and icon of ${escapeHtml(shownName(m))}">Change</a></div>`;
}
// The Template tab's list (addendum 2): every module, built-in ones first, with its own name and version beside the
// editor. Each row's id is what the Modules cards link to.
function renderModuleNames() {
  const list = $('module-names');
  const row = (m, about) => `<div class="module-name-row" id="template-module-${escapeHtml(m.id)}"><div class="module-name-head"><i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw module-icon" aria-hidden="true"></i> <strong>${escapeHtml(shownName(m))}</strong> <span class="hint">${escapeHtml(about)}</span></div>${displayEditor(m)}</div>`;
  list.innerHTML = [
    ...builtinModules.map((b) => row(b, `${b.name}, built in`)),
    ...installedModules.map((m) => row(m, `${m.name} v${m.version}`)),
  ].join('');
}
const displayBox = (id) => $('module-names').querySelector(`.module-display[data-display-id="${CSS.escape(id)}"]`);
async function saveDisplay(box, patch, done) {
  const id = box.dataset.displayId;
  for (const b of box.querySelectorAll('button')) b.disabled = true;
  try {
    const { module } = await api('PATCH', `/api/modules/${encodeURIComponent(id)}`, patch);
    await loadModules();
    loadRoles().catch(() => {}); // the Roles grid's group is named by it
    refreshModuleNav(); // and so is the header's link to its page
    const again = displayBox(id);
    if (again) {
      say(again.querySelector('[data-display-status]'), done(module));
      again.querySelector('[data-display-name]').focus();
    }
  } catch (err) {
    for (const b of box.querySelectorAll('button')) b.disabled = false;
    box.querySelector('[data-display-reset]').disabled = !box.dataset.displayOwn; // as it was: only a saved one resets
    say(box.querySelector('[data-display-status]'), err.message, true); // the server's own sentence; nothing was changed
  }
}
function closeIconPicks(except) {
  for (const d of $('module-names').querySelectorAll('.module-display details[open]')) if (d !== except) d.open = false;
}
$('module-names').addEventListener('click', (event) => {
  const box = event.target.closest('.module-display');
  if (!box) { closeIconPicks(); return; }
  const choice = event.target.closest('[data-display-icon]');
  if (choice) {
    // Picked, not saved yet: Save sends it with the name.
    box.dataset.displayChosen = choice.dataset.displayIcon;
    for (const b of box.querySelectorAll('[data-display-icon]')) {
      const on = b === choice;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const summary = box.querySelector('summary');
    summary.querySelector('i').className = `fa-solid fa-${choice.dataset.displayIcon || box.dataset.displayFallback} fa-fw`;
    summary.setAttribute('aria-label', `Icon: ${choice.dataset.displayIcon || choice.getAttribute('aria-label').replace(/ icon$/, '').toLowerCase()}`);
    box.querySelector('details').open = false;
    summary.focus();
    return;
  }
  if (event.target.closest('summary')) { closeIconPicks(box.querySelector('details')); return; }
  if (event.target.closest('[data-display-save]')) {
    // Only what the owner changed here, so a stored choice this page can't show (an icon it doesn't offer) is kept.
    const name = box.querySelector('[data-display-name]').value.trim().replace(/\s+/g, ' ');
    const patch = {};
    if (name !== box.dataset.displayWasName) patch.displayName = name || null;
    if (box.dataset.displayChosen !== box.dataset.displayWasIcon) patch.displayIcon = box.dataset.displayChosen || null;
    if (!Object.keys(patch).length) { say(box.querySelector('[data-display-status]'), 'Nothing to save'); return; }
    saveDisplay(box, patch, (m) => `Saved. Shown as ${shownName(m)}`);
    return;
  }
  if (event.target.closest('[data-display-reset]')) {
    const back = event.target.closest('[data-display-reset]').dataset.displayBack || 'Back to its own name and icon';
    saveDisplay(box, { displayName: null, displayIcon: null }, () => back);
  }
});
$('module-names').addEventListener('keydown', (event) => {
  const box = event.target.closest('.module-display');
  if (!box) return;
  if (event.key === 'Enter' && event.target.matches('[data-display-name]')) {
    event.preventDefault();
    box.querySelector('[data-display-save]').click();
  } else if (event.key === 'Escape' && box.querySelector('details[open]')) {
    event.preventDefault();
    box.querySelector('details').open = false;
    box.querySelector('summary').focus();
  }
});
document.addEventListener('click', (event) => { if (!event.target.closest('#module-names')) closeIconPicks(); });

// Recent activity, in the box at the top of the tab: one row per thing a module did (when, which module, what, by whom), newest
// first. Redrawn in place when it changes, keeping the scroll position, and refreshed while the tab is open.
const activityWhen = (at) => {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
// Something the server refused or slowed shows as a warning (no colour alone: a small icon too).
const activityLevel = (what) => (/slowed|too many|over the limit|refused|denied|failed|error/i.test(what || '') ? 'warn' : 'info');
let activityKey = '';
async function loadActivity() {
  const list = $('module-activity');
  if (!list) return;
  let items = [];
  try {
    items = (await api('GET', '/api/modules/activity')).activity || [];
  } catch {
    $('module-activity-empty').textContent = 'Recent activity is unavailable.';
    $('module-activity-empty').hidden = false;
    return;
  }
  const key = items.length + ':' + (items[0] ? items[0].at : '');
  if (key === activityKey) return;
  activityKey = key;
  const box = $('activity-box');
  const top = box.scrollTop;
  list.replaceChildren(...items.map((a) => {
    const li = document.createElement('li');
    li.className = 'activity-row';
    li.dataset.level = activityLevel(a.what);
    li.innerHTML = `<span class="activity-time" title="${escapeHtml(new Date(a.at).toLocaleString())}">${escapeHtml(activityWhen(a.at))}</span><span class="activity-source">${escapeHtml(a.moduleName)}</span><span class="activity-event">${li.dataset.level === 'warn' ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' : ''}${escapeHtml(a.what)}${a.byName ? ` <span class="hint">by ${escapeHtml(a.byName)}</span>` : ''}</span>`;
    return li;
  }));
  $('module-activity-empty').textContent = 'No activity yet.';
  $('module-activity-empty').hidden = items.length > 0;
  box.scrollTop = top;
}
setInterval(() => { if (!document.hidden && !$('tab-modules').hidden) loadActivity(); }, 15000);

// The AI service: a summary card here (which service and model, and this month's use); the setup is its own page, /ai-config.html.
let aiCard = { saved: false, on: false, dependents: [] };
// Whether the AI service card has anything to show at all (false only when its API call fails, e.g. not an admin);
// separate from moduleFilter, which decides whether it is worth showing under the current filter.
let aiAvailable = true;
function syncAiVisibility() {
  $('ai-panel').hidden = !aiAvailable || moduleFilter === 'updates';
}
// Enabling and disabling is here, on the card, like every module's; the setup is on its own page.
$('ai-toggle').addEventListener('click', async () => {
  const name = AI_NAMES[aiCard.provider] || 'the service';
  let force = false;
  if (aiCard.on) {
    let msg = 'Disable AI for everyone?\n\nModules that use it are told AI is not available. Your setup is kept.';
    if (aiCard.dependents?.length) {
      const names = aiCard.dependents.map((d) => d.name).join(' and ');
      msg = `${names} need${aiCard.dependents.length === 1 ? 's' : ''} the AI service. Turn ${aiCard.dependents.length === 1 ? 'it' : 'them'} off too?`;
      force = true;
    }
    if (!window.confirm(msg)) return;
  } else if (!window.confirm(`Enable AI?\n\nModules that use it can send what a person selects, and their question, to ${name} under your account. Only people whose role allows it (Roles tab) can use it.`)) return;
  $('ai-toggle').disabled = true;
  try {
    const wasOn = aiCard.on;
    await api('PUT', '/api/ai', { enabled: !wasOn, ...(force ? { force: true } : {}) });
    await loadModules(); // refreshes both the module list (a forced cascade may have disabled some) and the AI card
    say($('modules-status'), wasOn ? 'AI disabled' : 'AI enabled');
  } catch (err) {
    $('ai-toggle').disabled = false;
    say($('modules-status'), err.message, true);
  }
});
const AI_NAMES = { openai: 'OpenAI', anthropic: 'Anthropic', compatible: 'Other (OpenAI-compatible)' };
async function loadAi() {
  try {
    const { ai, usage, dependents } = await api('GET', '/api/ai');
    // The service in use: the host's managed one or this environment's own (ai.provider is only the latter).
    const custom = ai.source !== 'managed';
    const provider = custom && ai.provider === 'openai' && ai.address && !/api\.openai\.com/.test(ai.address) ? 'compatible' : ai.active.provider;
    const saved = provider !== 'none';
    const on = saved && ai.enabled !== false;
    aiCard = { saved, on, provider, model: ai.active.model, dependents: dependents || [] };
    $('ai-state').textContent = on ? 'Enabled' : saved ? 'Disabled' : 'Off';
    $('ai-state').classList.toggle('on', on);
    $('ai-toggle').textContent = on ? 'Disable' : 'Approve and enable';
    $('ai-toggle').classList.toggle('btn-primary', !on && saved);
    $('ai-toggle').disabled = !saved;
    $('ai-toggle-hint').textContent = saved ? '' : 'Set up a service first (AI Configuration).';
    $('ai-summary').textContent = on ? `${AI_NAMES[provider] || provider}, ${aiCard.model || 'no model chosen'}. ${on ? `${Number(usage.tokens || 0).toLocaleString()} tokens this month${usage.monthlyTokens ? ' of ' + usage.monthlyTokens.toLocaleString() : ''}.` : 'Set up, and switched off.'}` : 'Not set up.';
    aiAvailable = true;
  } catch {
    aiAvailable = false;
  }
  syncAiVisibility();
}

// Which modules the tab lists: all of them, or only those with an update waiting.
let moduleFilter = 'all';
const hasUpdate = (id) => bundledModules.some((b) => b.id === id && b.update);
// A module can be configured when it has settings the admin chooses for the server (what Module Configuration shows).
const isConfigurable = (m) => !m.outdated && !m.needsUpdate?.length && (m.settings || []).some((d) => d.scope === 'environment');
const moduleMatches = (m) => moduleFilter === 'updates' ? hasUpdate(m.id) : moduleFilter === 'configurable' ? isConfigurable(m) : true;
function syncModuleFilters() {
  const updates = installedModules.filter((m) => hasUpdate(m.id)).length;
  for (const b of document.querySelectorAll('[data-module-filter]')) {
    const on = b.dataset.moduleFilter === moduleFilter;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const all = $('module-filters').querySelector('[data-count="all"]');
  const up = $('module-filters').querySelector('[data-count="updates"]');
  all.textContent = String(builtinModules.length + installedModules.length);
  up.textContent = String(updates);
  up.hidden = !updates;
  const conf = $('module-filters').querySelector('[data-count="configurable"]');
  conf.textContent = String(installedModules.filter(isConfigurable).length);
  const avail = $('module-filters').querySelector('[data-count="available"]');
  avail.textContent = String(bundledModules.filter((b) => !b.installed).length);
}
$('module-filters').addEventListener('click', (event) => {
  const b = event.target.closest('[data-module-filter]');
  if (!b || b.dataset.moduleFilter === moduleFilter) return;
  moduleFilter = b.dataset.moduleFilter;
  renderModules();
});

function renderModules() {
  const list = $('modules-list');
  list.textContent = '';
  syncModuleFilters();
  // The AI service card is not a versioned module, so it has no update to offer; it does have its own
  // configuration page, so it stays visible under Configurable.
  syncAiVisibility();
  // "Available" isolates the not-yet-installed list below; every other filter hides it and works on what is installed.
  const showAvailableOnly = moduleFilter === 'available';
  const updatesOnly = moduleFilter !== 'all' && !showAvailableOnly;
  // The built-in modules first: always on, and not removable.
  for (const b of updatesOnly || showAvailableOnly ? [] : builtinModules) {
    const el = document.createElement('article');
    el.className = 'panel module-card';
    el.innerHTML = `
      <div class="module-head">
        <i class="fa-solid fa-${escapeHtml(shownIcon(b))} fa-fw module-icon" aria-hidden="true"></i>
        <div class="grow"><h2>${escapeHtml(shownName(b))} <span class="hint">${b.displayName ? `${escapeHtml(b.name)}, ` : ''}built in</span></h2>
          <div class="hint">On ${escapeHtml(word('space', { a: true }))}'s ${escapeHtml(word('canvas'))}</div></div>
        <span class="pill ${b.switchable ? (b.enabled ? 'on' : '') : 'on'}">${b.switchable ? (b.enabled ? 'Enabled' : 'Disabled') : 'Always on'}</span>
      </div>
      <p>${escapeHtml(b.description)}</p>
      ${shownAsLink(b)}
      <p class="hint">It comes with the server and can't be removed. Its permissions are on the Roles tab: ${escapeHtml(b.permissions)}.</p>
      ${b.switchable ? `<div class="row"><button class="btn ${b.enabled ? '' : 'btn-primary'}" type="button" data-builtin-toggle="${escapeHtml(b.id)}">${b.enabled ? 'Disable' : 'Approve and enable'}</button>${b.needs ? `<span class="hint">${escapeHtml(b.needs)}</span>` : ''}</div>` : ''}`;
    list.appendChild(el);
  }
  if (!showAvailableOnly && (updatesOnly ? !installedModules.some(moduleMatches) : !installedModules.length)) {
    const none = document.createElement('div');
    none.className = 'panel';
    none.innerHTML = updatesOnly ? `<p class="hint">${moduleFilter === 'configurable' ? `No installed ${escapeHtml(word('module'))} has settings.` : 'Everything is up to date.'}</p>` : `<p class="hint">No other ${escapeHtml(word('module', { many: true }))} installed yet.</p>`;
    list.appendChild(none);
  }
  if (!showAvailableOnly) for (const m of installedModules) if (moduleMatches(m)) list.appendChild(moduleCard(m));
  // Modules that ship with this server and are not installed yet: shown under All, and on their own under Available.
  const available = updatesOnly ? [] : bundledModules.filter((b) => !b.installed);
  if (available.length) {
    const box = document.createElement('div');
    box.className = 'panel';
    box.innerHTML = `<h2>Available with this server</h2><p class="hint">These come with the server, so there is nothing to upload.</p>${available.map((b) => `
      <div class="row module-available">
        <i class="fa-solid fa-${escapeHtml(shownIcon(b))} fa-fw module-icon" aria-hidden="true"></i>
        <div class="grow"><strong>${escapeHtml(shownName(b))}</strong> <span class="hint">${b.displayName ? `${escapeHtml(b.name)} ` : ''}v${escapeHtml(b.version)}</span><div class="hint">${escapeHtml(b.description || '')}</div>${b.notInPlan ? '<div class="hint module-needs"><i class="fa-solid fa-circle-info fa-fw" aria-hidden="true"></i> Not in your plan.</div>' : bundledNeeds(b)}</div>
        <button class="btn btn-primary" data-bundled-action="install" data-bundled-id="${escapeHtml(b.id)}" type="button" ${b.notInPlan ? `disabled title="Your plan does not include this ${escapeHtml(word('module'))}"` : ''}>Install</button>
      </div>`).join('')}`;
    list.appendChild(box);
  } else if (showAvailableOnly) {
    const none = document.createElement('div');
    none.className = 'panel';
    none.innerHTML = '<p class="hint">Nothing new to install right now.</p>';
    list.appendChild(none);
  }
}

// A built-in feature the admin may switch off (the conference): it goes through the same enable step as a module.
$('modules-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-builtin-toggle]');
  if (!button) return;
  const b = builtinModules.find((x) => x.id === button.dataset.builtinToggle);
  if (!b) return;
  const enable = !b.enabled;
  if (!enable && !window.confirm(`Turn off ${shownName(b)} for everyone?\n\n${b.turnOff || `It stops working in every ${word('space')} until you enable it again.`}`)) return;
  if (enable && !window.confirm(`Enable ${shownName(b)}?\n\n${b.turnOn || b.description}`)) return;
  button.disabled = true;
  try {
    await api('PATCH', '/api/settings', { [b.setting || `${b.id}Enabled`]: enable });
    await loadModules();
    say($('modules-status'), `${shownName(b)} ${enable ? 'enabled' : 'disabled'}`);
  } catch (err) {
    button.disabled = false;
    say($('modules-status'), err.message, true);
  }
});

// Install or update a module that ships with this server, by building it here.
$('modules-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-bundled-action]');
  if (!button) return;
  button.disabled = true;
  say($('modules-status'), 'installing...');
  try {
    const { module } = await api('POST', `/api/modules/bundled/${encodeURIComponent(button.dataset.bundledId)}/install`);
    await loadModules();
    await loadRoles();
    say($('modules-status'), `${shownName(module)} ${module.version} installed${module.enabled ? '' : ' -- review it below, then enable'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
    button.disabled = false;
  }
});

$('module-install').addEventListener('click', async () => {
  const file = $('module-file').files[0];
  if (!file) return say($('modules-status'), 'choose a zip file first', true);
  say($('modules-status'), 'installing...');
  try {
    const { module } = await api('POST', '/api/modules', file, 'application/zip');
    $('module-file').value = '';
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    say($('modules-status'), `${shownName(module)} ${module.version} installed${module.enabled ? '' : ' -- review it below, then enable'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('click', async (event) => {
  const mode = event.target.closest('[data-module-runmode]');
  if (!mode) return;
  const m = installedModules.find((x) => x.id === mode.closest('.module-card').dataset.id);
  const to = mode.dataset.moduleRunmode;
  try {
    if (to === 'page' && !window.confirm(`Run ${shownName(m)} in the page?\n\n${word('module', { a: true, cap: true })} in the page is not walled off. It can read and change everything on the page, act as you, and reach anything you can. the host cannot hold it to its approved permissions.\n\nOnly continue if you trust whoever wrote it.`)) return;
    await api('PATCH', `/api/modules/${m.id}`, { runMode: to, acceptRisk: to === 'page' });
    await loadModules();
    say($('modules-status'), `${shownName(m)} now runs ${to === 'page' ? 'in the page' : 'sandboxed'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-module-action]');
  if (!button) return;
  const card = button.closest('.module-card');
  const m = installedModules.find((x) => x.id === card.dataset.id);
  try {
    if (button.dataset.moduleAction === 'toggle') {
      let force = false;
      if (m.enabled && m.dependents?.length) {
        const names = m.dependents.map(shownNameOf).join(' and ');
        if (!window.confirm(`${names} needs ${shownName(m)}. Turn ${m.dependents.length === 1 ? 'it' : 'them'} off too?`)) return;
        force = true;
      }
      await api('PATCH', `/api/modules/${m.id}`, { enabled: !m.enabled, ...(force ? { force: true } : {}) });
    } else if (button.dataset.moduleAction === 'rollback') {
      const version = card.querySelector('[data-module-version]').value;
      if (version === m.version) return;
      if (!window.confirm(`Switch ${shownName(m)} to version ${version}? Its data stays as it is.`)) return;
      await api('POST', `/api/modules/${m.id}/rollback`, { version });
    } else if (button.dataset.moduleAction === 'uninstall') {
      if (!window.confirm(`Uninstall ${shownName(m)}?${m.dependents?.length ? ' ' + m.dependents.map(shownNameOf).join(' and ') + ' needs it and will be turned off.' : ''}`)) return;
      const wipe = window.confirm(`Also delete ${shownName(m)}'s saved data?\n\nOK deletes it for good. Cancel keeps it, so a later reinstall picks up where it left off.\n\nFiles you placed in the ${word('module')}'s own folder (a map file, say) are never deleted.`);
      await api('DELETE', `/api/modules/${m.id}?keepData=${wipe ? 0 : 1}`);
    }
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    say($('modules-status'), '');
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('change', async (event) => {
  if (event.target.matches('[data-module-version]')) {
    // Switching is only offered for a version that is not the running one.
    const card = event.target.closest('.module-card');
    const m = installedModules.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-module-action="rollback"]').disabled = event.target.value === m.version;
    return;
  }
  if (!event.target.matches('[data-module-all-spaces]')) return;
  const id = event.target.closest('.module-card').dataset.id;
  try {
    await api('PATCH', `/api/modules/${id}`, { allSpaces: event.target.checked });
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

// --- Font Awesome icons -----------------------------------------------------
// Paste the HTML Font Awesome gives you; we keep just its classes.
function parseIconClasses(text) {
  const raw = String(text || '');
  const m = raw.match(/class\s*=\s*["']([^"']+)["']/i);
  const tokens = (m ? m[1] : raw).split(/\s+/).filter((t) => /^fa-[a-z0-9-]+$/.test(t));
  const hasStyle = tokens.some((t) => /^fa-(solid|regular|brands|light|thin|duotone|sharp)$/.test(t));
  return tokens.length > (hasStyle ? 1 : 0) ? tokens.join(' ') : '';
}

function iconRow(icon) {
  const row = $('icon-row').content.firstElementChild.cloneNode(true);
  const html = row.querySelector('.icon-html');
  const preview = row.querySelector('.icon-preview');
  row.dataset.id = icon?.id || '';
  row.querySelector('.icon-label').value = icon?.label || '';
  if (icon?.classes) html.value = `<i class="${icon.classes}"></i>`;
  const show = () => {
    const classes = parseIconClasses(html.value);
    preview.textContent = '';
    if (classes) {
      const i = document.createElement('i');
      i.className = classes + ' fa-fw';
      preview.appendChild(i);
    }
    html.classList.toggle('invalid', Boolean(html.value.trim()) && !classes);
  };
  html.addEventListener('input', show);
  show();
  return row;
}

function renderIconRows(icons) {
  const list = $('icons-list');
  list.textContent = '';
  for (const icon of icons || []) list.appendChild(iconRow(icon));
}

$('icons-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.icon-row');
  if (button.dataset.action === 'icon-remove') row.remove();
  else if (button.dataset.action === 'icon-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'icon-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('icon-add').addEventListener('click', () => $('icons-list').appendChild(iconRow()));

$('save-icons').addEventListener('click', async () => {
  const icons = [...$('icons-list').querySelectorAll('.icon-row')]
    .map((row) => ({ id: row.dataset.id, classes: parseIconClasses(row.querySelector('.icon-html').value), label: row.querySelector('.icon-label').value.trim() }))
    .filter((i) => i.classes);
  try {
    const { settings } = await api('PATCH', '/api/settings', { icons });
    renderIconRows(settings.icons);
    await loadBranding();
    buildHomeIconGrid();
    renderHomeIconSelection();
    say($('icons-status'), 'saved');
  } catch (err) {
    say($('icons-status'), err.message, true);
  }
});

// Site images (icon, sign-in background): click the picture to change it,
// Remove to clear it. The icon falls back to the built-in one when unset.
function renderSiteImages(b) {
  for (const slot of document.querySelectorAll('#tab-environment [data-site]')) {
    const name = slot.dataset.site;
    const has = name === 'icon' ? b.hasIcon : b.hasBackground;
    const img = slot.querySelector('img');
    const showImage = has || name === 'icon';
    img.hidden = !showImage;
    if (showImage) img.src = `/img/site/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = showImage;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="site-clear"]').hidden = !has;
  }
}

// A site image (the icon, the sign-in background) from a file the person chose or a pre-made one from the library.
async function saveSiteImage(name, file) {
  try {
    await api('PUT', `/api/settings/${name}`, file, file.type);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} saved`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
}
$('tab-environment').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-site]')) return;
  const file = input.files[0];
  if (!file) return;
  await saveSiteImage(input.closest('[data-site]').dataset.site, file);
  input.value = '';
});
$('tab-environment').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="site-library"]');
  if (!button) return;
  const file = await pickBackground({ title: 'Choose the sign-in background' });
  if (file) await saveSiteImage(button.closest('[data-site]').dataset.site, file);
});

$('tab-environment').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="site-clear"]');
  if (!button) return;
  const name = button.closest('[data-site]').dataset.site;
  try {
    await api('DELETE', `/api/settings/${name}`);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} removed`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

// The shared guest Participant picture set, same click-to-change/Clear
// shape as every other image slot in the app.
function renderGuestImages(b) {
  for (const slot of document.querySelectorAll('#guest-images [data-guest-slot]')) {
    const name = slot.dataset.guestSlot;
    const has = !!b.guestImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/guest/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="guest-image-clear"]').hidden = !has;
  }
}

$('guest-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-guest-slot]')) return;
  const slot = input.closest('[data-guest-slot]').dataset.guestSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/guest-images/${slot}`, file, file.type);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
  input.value = '';
});
$('guest-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="guest-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-guest-slot]').dataset.guestSlot;
  try {
    await api('DELETE', `/api/settings/guest-images/${slot}`);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});

// The server-wide Default Images set -- what a member's own Participant
// box falls back to once neither they nor their space has set a picture.
// Same click-to-change/Clear shape as every other image slot in the app.
function renderDefaultImages(b) {
  for (const slot of document.querySelectorAll('#default-images [data-default-slot]')) {
    const name = slot.dataset.defaultSlot;
    const has = !!b.defaultImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/default/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="default-image-clear"]').hidden = !has;
  }
}

$('default-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-default-slot]')) return;
  const slot = input.closest('[data-default-slot]').dataset.defaultSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/default-images/${slot}`, file, file.type);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
  input.value = '';
});
$('default-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="default-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-default-slot]').dataset.defaultSlot;
  try {
    await api('DELETE', `/api/settings/default-images/${slot}`);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});

function showStreamKey() {
  $('stream-key').textContent = streamShown ? streamKey : '••••••••';
  $('stream-show').textContent = streamShown ? 'Hide' : 'Show';
}
$('stream-show').addEventListener('click', () => {
  streamShown = !streamShown;
  showStreamKey();
});
$('stream-copy').addEventListener('click', () => copy(streamKey, $('settings-status')));
$('stream-regen').addEventListener('click', async () => {
  if (!window.confirm('Regenerate the access key? Every link made with it and the Studio app need the new one.')) return;
  try {
    ({ streamKey } = await api('POST', '/api/stream-key/regenerate'));
    showStreamKey();
    for (const user of users) fill(cardFor(user), user);
    say($('settings-status'), 'new access key');
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

// The server's admin lockout bypass is on: say so on Manage until it is turned off (plans/plan-mfa.md, "The server's two switches").
function mfaBypassBanner() {
  if (document.querySelector('.env-page-banner[data-mfa-bypass]')) return;
  const b = document.createElement('div');
  b.className = 'env-page-banner';
  b.dataset.mfaBypass = '1';
  b.setAttribute('role', 'status');
  b.textContent = `The lockout bypass is on: ${word('owner', { many: true })} and the admin are not asked for their two-step code. Reset your factor on your profile if you need to, then turn ADMIN_MFA_LOCKOUT_BYPASS off on the server.`;
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.after(b); else document.body.prepend(b);
}

// --- the environment on a hosted server -----------------------------------------------------------------------------
// What only the host does (uploading a module zip, running a module in the page) is not offered to an owner. The host's
// own sign-in (the stand-in) sees everything.
function applyHosted() {
  if (!environment.hosted) return;
  for (const el of document.querySelectorAll('[data-host-only]')) el.hidden = hostOnlyHidden();
}

// --- the Template tab (plan-environment-templates.md, the switching addendum and addendum 2) ------------------------
// The templates it can switch to (GET /api/environment/template's `choices`: [{ id, name, description, source, version }]),
// the open offer after a switch (the same answer's `offer`, or the switch's), and whether "Not now" put it away for now.
let templateChoices = [];
let templateOffer = null;
let offerPutAway = false;
const templateName = (t) => (t && (t.name || t.id)) || '';
async function loadTemplate() {
  try {
    const answer = await api('GET', '/api/environment/template');
    templateChoices = answer.choices || [];
    madeFrom = answer.template || null;
    templateOffer = answer.offer || null;
  } catch (err) {
    // the tab still shows what the settings said
  }
  renderTemplateNote();
}
// The Template tab's own badge while the offer is open: it waits for the owner's Apply, even after "Not now".
function renderTemplateBadge() {
  const tab = $('template-tab');
  const open = Boolean(madeFrom && madeFrom.offerOpen);
  tab.textContent = 'Template';
  tab.title = open ? `The ${templateName(madeFrom)} template can turn on more` : '';
  if (open) {
    const badge = document.createElement('span');
    badge.className = 'badge update-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = '1';
    tab.append(badge);
  }
}
// The chooser: "No template", then each template this environment can switch to; Switch only once another is chosen.
function renderTemplateSwitch() {
  const select = $('template-select');
  const current = madeFrom ? madeFrom.id : 'none';
  const keep = select.dataset.filled ? select.value : current;
  const options = [new Option('No template', 'none'), ...templateChoices.map((c) => new Option(c.name || c.id, c.id))];
  // The template in use, even one this server no longer offers, so the chooser always says what is in use.
  if (madeFrom && !templateChoices.some((c) => c.id === madeFrom.id)) options.push(new Option(templateName(madeFrom), madeFrom.id));
  select.replaceChildren(...options);
  select.value = options.some((o) => o.value === keep) ? keep : current;
  select.dataset.filled = '1';
  syncTemplateSwitch();
}
function syncTemplateSwitch() {
  const select = $('template-select');
  const current = madeFrom ? madeFrom.id : 'none';
  const other = select.value !== current;
  $('template-switch').disabled = !other;
  $('template-switch').classList.toggle('btn-primary', other);
  const chosen = templateChoices.find((c) => c.id === select.value);
  const about = $('template-choice-about');
  about.textContent = !other ? '' : chosen ? chosen.description || '' : 'The default words and icons.';
  about.hidden = !about.textContent;
}
$('template-select').addEventListener('change', syncTemplateSwitch);
$('template-switch').addEventListener('click', async () => {
  const value = $('template-select').value;
  const chosen = templateChoices.find((c) => c.id === value);
  if (!window.confirm(switchQuestion(value === 'none' ? null : chosen ? chosen.name || chosen.id : value))) return;
  const button = $('template-switch');
  button.disabled = true;
  say($('template-status'), 'Switching...');
  try {
    const answer = await api('PATCH', '/api/settings', { template: value });
    templateOffer = answer.offer || null;
    offerPutAway = false;
    useOwnerSettings(answer.settings);
    madeFrom = answer.template || null;
    selectedHomeIcon = madeFrom ? ownHomeIcon : answer.settings.homeIcon || DEFAULT_HOME_ICON;
    renderHomeIconSelection();
    await wordsChanged(); // the words, the module names and icons, and every place that shows them
    renderTemplateNote();
    say($('template-status'), madeFrom ? `Switched to ${templateName(madeFrom)}` : 'Switched to no template');
    const first = $('template-offer').querySelector('input:not(:disabled), button');
    (first && !$('template-offer').hidden ? first : $('template-select')).focus(); // Switch is off again: never lose focus
  } catch (err) {
    say($('template-status'), err.message, true); // the server's own sentence; nothing was changed
    syncTemplateSwitch();
  }
});
// The offer: drawn while it is open and not put away; put away, a line says it waits, with Review to bring it back.
function renderTemplateOffer() {
  const box = $('template-offer');
  const open = Boolean(madeFrom && madeFrom.offerOpen && templateOffer);
  $('template-offer-note').hidden = !(open && offerPutAway);
  $('template-offer-note-text').textContent = open ? `The ${templateName(madeFrom)} template can turn on more.` : '';
  if (!open || offerPutAway) { box.hidden = true; box.replaceChildren(); return; }
  if (box.dataset.drawnFor === madeFrom.id && !box.hidden && box.childElementCount) return; // keep what is ticked
  box.dataset.drawnFor = madeFrom.id;
  renderOffer(box, {
    templateName: templateName(madeFrom),
    offer: templateOffer,
    lobbyName: spaces.find((sp) => sp.isLobby)?.name || '',
    later: () => {
      offerPutAway = true;
      renderTemplateOffer();
      $('template-offer-open').focus();
    },
    apply: async (body) => {
      const answer = await api('POST', '/api/environment/template/apply', body);
      madeFrom = answer.template || null;
      templateOffer = answer.offer || null;
      box.dataset.drawnFor = '';
      await loadModules(); // what was turned on (and renders the note, with what was left out)
      await loadUsers(); // the Lobby's name, if it was taken
      await loadRoles().catch(() => {});
      refreshModuleNav();
      const skipped = (madeFrom && madeFrom.skipped) || [];
      say($('template-status'), skipped.length ? `Applied. ${skipped.length} left out, listed below` : 'Applied');
      $('template-select').focus();
    },
  });
}
$('template-offer-open').addEventListener('click', () => {
  offerPutAway = false;
  renderTemplateOffer();
  $('template-offer').querySelector('input:not(:disabled), button')?.focus();
});

// The template in use: "Uses the <name> template", its description, the switch and the offer, and what it left out
// that is still left out, each with why and where to put it right. A module turned on since is no longer listed.
const sentence = (text) => { const t = String(text || '').trim(); return t ? capitalOf(t) + (/[.!?]$/.test(t) ? '' : '.') : ''; };
function renderTemplateNote() {
  renderTemplateBadge();
  renderTemplateSwitch();
  renderTemplateOffer();
  $('template-hint').hidden = !madeFrom;
  const about = madeFrom && templateChoices.find((c) => c.id === madeFrom.id)?.description;
  $('template-about').textContent = about || '';
  $('template-about').hidden = !about;
  if (!madeFrom) {
    $('template-made').innerHTML = `<strong>No template.</strong> This ${escapeHtml(word('environment'))} uses the default words and icons.`;
    $('template-skipped').hidden = true;
    return;
  }
  $('template-made').innerHTML = `<strong>Uses the ${escapeHtml(templateName(madeFrom))} template.</strong>${madeFrom.version ? ` <span class="hint">Version ${escapeHtml(String(madeFrom.version))}</span>` : ''}`;
  const modulesTab = '#modules'; // the Modules tab's address
  const modulesLink = `<a href="${modulesTab}">${escapeHtml(word('module', { many: true, cap: true }))}</a>`;
  const item = (icon, title, detail) => `<li><i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i><div><strong>${title}</strong>${detail ? `<div class="hint">${detail}</div>` : ''}</div></li>`;
  const items = (madeFrom.skipped || []).map((x) => {
    const installed = installedModules.find((m) => m.id === x.id);
    if (installed && installed.enabled) return ''; // turned on since: nothing left to do
    const name = escapeHtml(x.name || shownNameOf(x.id));
    // Installed and in every space, but off until what it needs is set up.
    if (installed) {
      const missing = (installed.missing || []).map((r) => (r === 'ai' ? '<a href="/ai-config.html">the AI service</a>' : escapeHtml(shownNameOf(r))));
      const then = missing.length ? `Once ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} ready, turn it on under ${modulesLink}.` : `Once that is done, turn it on under ${modulesLink}.`;
      return item('circle-pause', `${name}: not on yet`, `${escapeHtml(sentence(x.why))} ${then}`);
    }
    if (x.why === 'not in the plan') {
      const bundled = bundledModules.find((b) => b.id === x.id);
      // The plan may have been widened since: then it was left out when it was made, and can be installed now.
      if (bundled && !bundled.notInPlan) return item('circle-plus', `${name}: can be installed now`, `Your plan includes it now: install it under ${modulesLink}.`);
      return item('lock', `${name}: not in your plan`, `Ask the ${escapeHtml(word('host'))} for a plan that includes it.`);
    }
    return item('circle-minus', `${name}: left out`, escapeHtml(sentence(x.why)));
  }).filter(Boolean);
  const box = $('template-skipped');
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<p class="hint">Left out:</p><ul>${items.join('')}</ul>` : '';
}

// The plan and its use (GET /api/environment): each cap as a bar, the past-due banner with its date, the way to a bigger
// plan (the product page's plans), a copy of the environment, and a request to delete it.
let envInfo = null;
const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
async function loadEnvironment() {
  const card = $('env-panel');
  if (!environment.hosted) { card.hidden = true; return; }
  try {
    envInfo = await api('GET', '/api/environment');
    // The product page's address (Upgrade goes to its plans): the public product facts carry the base domain.
    if (!envInfo.baseDomain) envInfo.baseDomain = (await api('GET', '/api/product').catch(() => ({}))).baseDomain || '';
  } catch (err) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  renderEnvironment();
}
function renderEnvironment() {
  const e = envInfo;
  const plan = e.plan || {};
  const use = e.usage || {};
  $('env-plan-pill').textContent = plan.name ? `${plan.name} plan` : 'no plan';
  $('env-hint').textContent = `${e.name || environment.name} is at ${environment.slug}: its people, ${word('space', { many: true })}, settings and ${word('module', { many: true })} are its own. What the plan allows, and what is used:`;
  const rows = [
    [word('member', { many: true, cap: true }), use.members ?? 0, plan.members, (n) => `${n}`],
    ['Storage', use.storageBytes ?? 0, plan.storageBytes, gb],
    ['Assistant calls this month', use.aiCallsThisMonth ?? 0, plan.aiCallsPerMonth, (n) => `${n}`],
    ['Calls at once', use.callsNow ?? 0, plan.calls, (n) => `${n}`],
    [word('module', { many: true, cap: true }), Array.isArray(plan.modules) ? plan.modules.length : null, null, (n) => (n === null ? `every ${word('module')}` : `${n} allowed`), 'modules'],
  ];
  $('env-caps').innerHTML = rows.map(([label, used, cap, fmt, kind]) => {
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const text = kind === 'modules' ? fmt(used) : cap ? `${fmt(used)} of ${fmt(cap)}` : `${fmt(used)}, no cap`;
    return `<dt>${escapeHtml(label)}</dt><dd><span class="env-cap-text">${escapeHtml(text)}</span>${cap ? `<span class="env-cap-bar${pct >= 90 ? ' warn' : ''}"><span style="width:${pct}%"></span></span>` : ''}</dd>`;
  }).join('');
  const banner = $('env-banner');
  if (e.status === 'pastDue') {
    const until = e.graceEndsAt ? new Date(e.graceEndsAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'soon';
    banner.textContent = `Payment for this ${word('environment')} is overdue. It goes to the free plan on ${until}; nothing is deleted.`;
    banner.hidden = false;
  } else if (e.status === 'suspended') {
    banner.textContent = `This ${word('environment')} is suspended by the ${word('host')}.`;
    banner.hidden = false;
  } else banner.hidden = true;
  const up = $('env-upgrade');
  if (e.baseDomain) { up.href = `${location.protocol}//${e.baseDomain}${location.port ? ':' + location.port : ''}/#plans`; up.hidden = false; } else up.hidden = true;
  const requested = Boolean(e.deleteRequestedAt);
  $('env-delete').hidden = requested;
  $('env-delete-cancel').hidden = !requested;
  if (requested) say($('env-status'), `Deletion asked for on ${new Date(e.deleteRequestedAt).toLocaleDateString()}; the host carries it out.`);
}
$('env-export').addEventListener('click', async () => {
  const b = $('env-export');
  b.disabled = true;
  say($('env-status'), 'packing...');
  try {
    const res = await fetch('/api/environment/export');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `could not export (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${environment.slug || 'environment'}-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say($('env-status'), 'downloaded');
  } catch (err) { say($('env-status'), err.message, true); }
  b.disabled = false;
});
$('env-delete').addEventListener('click', () => { $('env-delete-form').hidden = false; $('env-delete-reason').focus(); });
$('env-delete-back').addEventListener('click', () => { $('env-delete-form').hidden = true; });
$('env-delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('POST', '/api/environment/delete-request', { reason: $('env-delete-reason').value.trim() });
    $('env-delete-form').hidden = true;
    await loadEnvironment();
  } catch (err) { say($('env-status'), err.message, true); }
});
$('env-delete-cancel').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/environment/delete-request');
    say($('env-status'), 'request withdrawn');
    await loadEnvironment();
  } catch (err) { say($('env-status'), err.message, true); }
});

async function init() {
  renderTopbar({ location: crumbLink('gear', 'Manage', '/admin') });
  await loadBranding();
  buildHomeIconGrid(); // after the branding: the choices are its icon list
  wireOverlayBack(word('space', { many: true, cap: true }));
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (!hasOwnerRights(me)) {
      location.href = '/';
      return;
    }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    $('admin-link').hidden = false;
    streamKey = info.streamKey;
    environment = { ...environment, ...(info.environment || {}) };
    applyHosted();
    if (info.mfaBypass) mfaBypassBanner();
    $('set-mfa-row').hidden = info.mfaOffered === false;
    const { settings } = await api('GET', '/api/settings');
    $('set-environment-name').value = settings.environmentName;
    $('set-language').value = settings.language || 'en';
    $('set-clock').value = settings.clock === '24' ? '24' : '12';
    fillCurrencies(settings.currency || 'USD');
    useOwnerSettings(settings);
    // With a template, no icon of the owner's is the template's own (null); without one, as before.
    selectedHomeIcon = madeFrom ? ownHomeIcon : settings.homeIcon || DEFAULT_HOME_ICON;
    renderHomeIconSelection();
    setWords(settings.words);
    renderWords();
    renderTemplateNote();
    await loadThemes();
    await loadRoles();
    await loadModules();
    $('set-max-quality').value = String(settings.maxQuality || 720);
    $('set-allow-screen-share').checked = settings.allowScreenShare !== false;
    $('set-allow-asides').checked = settings.allowAsides !== false;
    $('set-allow-private').checked = settings.allowPrivate !== false;
    $('set-allow-reactions').checked = settings.allowReactions !== false;
    $('set-login-text').value = settings.loginText;
    $('set-mfa-required').checked = Boolean(settings.mfaRequired);
    $('set-allow-registration').checked = Boolean(settings.allowRegistration);
    renderReactionRows(settings.reactions);
    renderIconRows(settings.icons);
    renderSiteImages(settings);
    renderGuestImages(settings);
    renderDefaultImages(settings);
    showStreamKey();
    await loadUsers();
    await loadEnvironment();
    await loadTemplate();
    if (firstHash && !TABS.includes(firstHash) && !OLD_TABS[firstHash]) selectTab(firstHash); // a section drawn just now
    setInterval(refreshLive, 5000);
  } catch (err) {
    location.href = '/login?next=/admin';
  }
}
init();
