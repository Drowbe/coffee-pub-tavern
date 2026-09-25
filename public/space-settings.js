// One space's own page, the same idea as a user's profile page: click a
// space in Manage > Spaces and land here, instead of editing it inline in
// the list. Admin only.
import { renderModuleSettings } from '/module-settings.js';
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, escapeHtml, crumbLink, getIcons, spaceCrumbIcon, hasOwnerRights } from '/brand.js';

const $ = (id) => document.getElementById(id);
const spaceId = decodeURIComponent(location.pathname.split('/')[2] || '');
let me = null;
let space = null;
let users = [];

// The choices come from the admin's Font Awesome list (Theme tab).
let selectedLinkIcon = 'link';

function buildIconGrid() {
  const grid = $('e-link-icon');
  grid.textContent = '';
  for (const { id, classes, label } of getIcons()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = id;
    btn.title = label || id;
    btn.innerHTML = `<i class="${escapeHtml(classes)} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedLinkIcon = id;
      renderIconGridSelection();
    });
    grid.appendChild(btn);
  }
}

function renderIconGridSelection() {
  for (const btn of $('e-link-icon').children) btn.classList.toggle('selected', btn.dataset.icon === selectedLinkIcon);
}

function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function render() {
  document.title = `${document.title.split(' - ')[0]} - ${space.name}`;
  $('space-title').textContent = space.name;
  $('lobby-tag').hidden = !space.isLobby;

  if (document.activeElement?.closest?.('.fields') == null) {
    $('e-name').value = space.name;
    $('e-description').value = space.description;
    $('e-profile').value = space.profile;
    $('e-link').value = space.link || '';
  }
  if (document.activeElement?.closest?.('.icon-grid') == null) {
    selectedLinkIcon = space.linkIcon;
    renderIconGridSelection();
  }
  $('e-allow-guests').checked = space.allowGuests;
  $('e-ai-off').checked = Boolean(space.aiOff);

  const img = $('space-image');
  img.hidden = !space.hasImage;
  if (space.hasImage) img.src = `/img/space/${space.id}?v=${Date.now()}`;
  $('space-image-slot').querySelector('.unset').hidden = space.hasImage;
  $('space-image-clear').hidden = !space.hasImage;

  $('members-hint').textContent = space.isLobby
    ? 'Everyone belongs to the Lobby.'
    : 'Click a player to add or remove them from this space -- saves as you click.';

  $('danger-row').hidden = space.isLobby;

  renderMembers();
  renderGuestLink();
}

function renderGuestLink() {
  const token = space.guestToken;
  const allowed = space.allowGuests !== false;
  $('guest-link-off-note').hidden = allowed;
  $('guest-link-value').textContent = token ? `${location.origin}/guest/${token}` : 'off';
  $('guest-link-on').hidden = !allowed || !!token;
  $('guest-link-copy').hidden = !token;
  $('guest-link-new').hidden = !allowed || !token;
  $('guest-link-off').hidden = !token;
}

async function setGuestLink(body) {
  try {
    if (body === null) space = (await api('DELETE', `/api/spaces/${space.id}/guest-link`)).space;
    else space = (await api('POST', `/api/spaces/${space.id}/guest-link`, body)).space;
    renderGuestLink();
  } catch (err) {
    say($('guest-link-status'), err.message, true);
  }
}

function renderMembers() {
  const container = $('members');
  const members = new Set(space.members);
  const keep = new Set();
  for (const user of users) {
    keep.add(user.key);
    let label = container.querySelector(`[data-member="${CSS.escape(user.key)}"]`);
    if (!label) {
      // A portrait tile that toggles: lit when the user is in the space.
      label = document.createElement('label');
      label.className = 'member member-toggle';
      label.dataset.member = user.key;
      label.title = 'Click to add or remove';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const thumb = document.createElement('img');
      thumb.alt = '';
      thumb.src = imgUrl(user.key, 'profile');
      const name = document.createElement('span');
      name.className = 'member-name';
      label.append(input, thumb, name);
      container.appendChild(label);
    }
    label.querySelector('.member-name').textContent = user.displayName;
    const input = label.querySelector('input');
    input.checked = space.isLobby || members.has(user.key);
    input.disabled = space.isLobby;
    label.classList.toggle('online', input.checked);
    label.classList.toggle('locked', space.isLobby);
  }
  for (const label of [...container.children]) if (!keep.has(label.dataset.member)) label.remove();
}

// Saves as you click, like Allow Guests -- the Members tab has no Save
// button of its own, and the Space tab's Save shouldn't be what commits it.
$('members').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'checkbox') return;
  input.closest('.member-toggle').classList.toggle('online', input.checked);
  try {
    const members = [...$('members').querySelectorAll('input:checked')].map((i) => i.closest('[data-member]').dataset.member);
    space = (await api('PATCH', `/api/spaces/${space.id}`, { members })).space;
    renderMembers();
  } catch (err) {
    input.checked = !input.checked;
    input.closest('.member-toggle').classList.toggle('online', input.checked);
    say($('members-status'), err.message, true);
  }
});

// The space's modules: the installed, enabled modules that have a space panel,
// each ticked when it is on here (or for every space, which is read-only here).
let spaceModules = [];
async function loadSpaceModules() {
  try {
    spaceModules = (await api('GET', '/api/modules')).modules.filter((m) => m.enabled && m.scope.includes('space'));
  } catch {
    spaceModules = [];
  }
  $('section-modules').hidden = spaceModules.length === 0;
  $('space-modules').innerHTML = spaceModules.map((m) => {
    const everywhere = m.allSpaces;
    const on = everywhere || m.spaces.includes(space.id);
    return `<label class="check"><input type="checkbox" data-module="${escapeHtml(m.id)}" ${on ? 'checked' : ''} ${everywhere ? 'disabled' : ''}> <i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}${everywhere ? ' <span class="hint">(on for every space)</span>' : ''}</label>`;
  }).join('');
}
$('space-modules').addEventListener('change', async (event) => {
  const box = event.target;
  const m = spaceModules.find((x) => x.id === box.dataset.module);
  if (!m) return;
  const spaces = new Set(m.spaces);
  if (box.checked) spaces.add(space.id); else spaces.delete(space.id);
  try {
    const { module } = await api('PATCH', `/api/modules/${m.id}`, { spaces: [...spaces] });
    m.spaces = module.spaces;
    say($('space-modules-status'), 'saved');
    // The module's own settings for this space appear (or go) with it.
    renderModuleSettings($('module-settings'), { scope: 'space', space: spaceId }).then(() => { $('section-module-settings').hidden = $('module-settings').hidden; syncModulesTab(); });
  } catch (err) {
    box.checked = !box.checked;
    say($('space-modules-status'), err.message, true);
  }
});

// Manage > this space, with the space's own icon.
function renderCrumb() {
  setTopbarLocation(
    crumbLink('gear', 'Manage', '/admin#spaces') +
    `<span class="crumb-sep">&rsaquo;</span>` +
    crumbLink(spaceCrumbIcon(space), space.name, location.pathname)
  );
}

$('save-btn').addEventListener('click', async () => {
  try {
    const patch = { name: $('e-name').value, description: $('e-description').value, profile: $('e-profile').value, link: $('e-link').value, linkIcon: selectedLinkIcon };
    space = (await api('PATCH', `/api/spaces/${space.id}`, patch)).space;
    render();
    renderCrumb();
    say($('save-status'), 'saved');
  } catch (err) {
    say($('save-status'), err.message, true);
  }
});

$('e-ai-off').addEventListener('change', async (event) => {
  try {
    space = (await api('PATCH', `/api/spaces/${space.id}`, { aiOff: event.target.checked })).space;
  } catch (err) {
    event.target.checked = Boolean(space.aiOff);
    say($('ai-off-status'), err.message, true);
  }
});

$('e-allow-guests').addEventListener('change', async (event) => {
  try {
    space = (await api('PATCH', `/api/spaces/${space.id}`, { allowGuests: event.target.checked })).space;
    renderGuestLink();
  } catch (err) {
    event.target.checked = space.allowGuests;
    say($('guest-link-status'), err.message, true);
  }
});

$('space-image-file').addEventListener('change', async () => {
  const file = $('space-image-file').files[0];
  $('space-image-file').value = '';
  if (!file) return;
  try {
    say($('status'), 'uploading...');
    space = (await api('PUT', `/api/spaces/${space.id}/image`, file, file.type)).space;
    render();
    say($('status'), 'image saved');
  } catch (err) {
    say($('status'), err.message, true);
  }
});

$('space-image-clear').addEventListener('click', async () => {
  try {
    space = (await api('DELETE', `/api/spaces/${space.id}/image`)).space;
    render();
    say($('status'), 'image removed');
  } catch (err) {
    say($('status'), err.message, true);
  }
});

$('guest-link-on').addEventListener('click', () => setGuestLink({}));
$('guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
$('guest-link-off').addEventListener('click', () => setGuestLink(null));
$('guest-link-copy').addEventListener('click', () => copy($('guest-link-value').textContent, $('guest-link-status')));

$('make-invite').addEventListener('click', async () => {
  try {
    const { invite } = await api('POST', '/api/invites', { spaces: [space.id] });
    $('invite-link').textContent = invite.url;
    $('invite-link-row').hidden = false;
    say($('invite-status'), 'link made');
  } catch (err) {
    say($('invite-status'), err.message, true);
  }
});
$('invite-copy').addEventListener('click', () => copy($('invite-link').textContent, $('invite-status')));

$('delete-btn').addEventListener('click', async () => {
  if (!window.confirm(`Delete the space "${space.name}"? Its members stay in the Lobby.`)) return;
  try {
    await api('DELETE', `/api/spaces/${space.id}`);
    location.href = '/admin#spaces';
  } catch (err) {
    say($('status'), err.message, true);
  }
});

// Space / Members tabs, remembered in the address -- same pattern as
// admin.html's and profile.html's tabs.
let wantedTab = location.hash.slice(1); // what the address asked for, even before the Modules tab exists
function selectTab(name) {
  wantedTab = name;
  // The Modules tab only exists when the space has something to set there (see syncModulesTab).
  const tab = name === 'members' ? 'members' : name === 'modules' && !document.querySelector('[data-tab="modules"]').hidden ? 'modules' : 'space';
  $('tab-space').hidden = tab !== 'space';
  $('tab-members').hidden = tab !== 'members';
  $('tab-modules').hidden = tab !== 'modules';
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
selectTab(location.hash.slice(1));

// Show the Modules tab when either of its panels has something, and open on it when the address asks for it.
function syncModulesTab() {
  const tab = document.querySelector('[data-tab="modules"]');
  tab.hidden = $('section-modules').hidden && $('section-module-settings').hidden && $('section-ai').hidden;
  selectTab(wantedTab);
}

async function init() {
  renderTopbar({ adminHref: '/admin#spaces', location: crumbLink('gear', 'Manage', '/admin#spaces') });
  await loadBranding();
  wireOverlayBack();
  buildIconGrid();
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (!hasOwnerRights(me)) { location.href = '/'; return; }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    $('admin-link').hidden = false;
    const [spaceRes, usersRes] = await Promise.all([api('GET', `/api/spaces/${spaceId}`), api('GET', '/api/users')]);
    space = spaceRes.space;
    users = usersRes.users;
    renderCrumb();
    await loadSpaceModules();
    syncModulesTab();
    // The AI switch is for a server that has an AI service set up.
    api('GET', '/api/ai').then((d) => { $('section-ai').hidden = !d.ai || d.ai.active.provider === 'none'; syncModulesTab(); }).catch(() => {});
    renderModuleSettings($('module-settings'), { scope: 'space', space: spaceId }).then(() => { $('section-module-settings').hidden = $('module-settings').hidden; syncModulesTab(); });
  } catch (err) {
    location.href = '/admin#spaces';
    return;
  }
  render();
}
init();
