// Your own profile: change your own photo, see everything else your admin
// set. An admin visiting /profile/<key> gets the same page in edit mode
// for that person instead -- the one place any of a user's settings are
// changed, rather than a flat table of everyone on the Manage page.
import { loadBranding, api, wireOverlayBack } from '/brand.js';

const $ = (id) => document.getElementById(id);
const editingKey = decodeURIComponent(location.pathname.split('/')[2] || '') || null;
let me = null; // the signed-in admin, only used for the "last admin" check
let user = null; // whose profile this is: me, or the person being edited
let streamKey = '';

function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function sayField(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    sayField(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function imgUrl(slot) {
  return `/img/${encodeURIComponent(user.key)}/${slot}?v=${Date.now()}`;
}

function viewLink() {
  const q = new URLSearchParams({ s: streamKey, kind: $('view-kind').value });
  return `${user.viewUrl}?${q}`;
}

async function reload() {
  user = editingKey ? (await api('GET', `/api/users/${editingKey}`)).user : (await api('GET', '/api/me')).user;
}

function render() {
  const editing = !!editingKey;

  const has = !!user.images.profile;
  $('portrait').src = imgUrl('profile'); // the server draws initials when unset
  $('portrait-slot').classList.toggle('set', has);
  $('portrait-clear').hidden = !has || editing; // self-service only, even for an admin viewing it
  $('portrait-slot').querySelector('.slot-pick').classList.toggle('still', editing);
  document.querySelector('#portrait-slot .unset').hidden = true;
  $('whoami-img').src = `/img/${encodeURIComponent(me ? me.key : user.key)}/profile?v=${Date.now()}`;
  $('whoami-img').hidden = false;
  $('whoami').textContent = me ? me.displayName : user.displayName;
  $('name').textContent = user.displayName;
  $('admin-link').hidden = !(me ? me.role === 'admin' : user.role === 'admin');
  $('editing-tag').hidden = !editing;
  $('portrait-hint').textContent = editing
    ? `${user.displayName}'s own photo: it shows next to their name in the header and on their tile at the table. Only they can change it -- it is not the picture used in the recording, that's below.`
    : 'Your own photo: it shows next to your name in the header and on your tile at the table. Click it to change it; square images look best. It is not the picture used in the recording — your admin sets that.';

  // Account: read-only facts normally, editable fields for an admin.
  $('account-facts').hidden = editing;
  $('account-fields').hidden = !editing;
  $('account-save-row').hidden = !editing;
  $('link-row').hidden = !editing;
  $('account-hint').hidden = editing;
  if (!editing) {
    $('f-name').textContent = user.displayName;
    $('f-login').textContent = user.login;
    $('f-role').textContent = user.role === 'admin' ? 'Admin: runs the table' : 'Player';
    $('f-password').textContent = user.hasPassword ? 'Set. Only an admin can change it.' : 'None. You sign in with your personal link.';
    $('f-link').textContent = user.link ? 'On. Your admin can send it to you again or turn it off.' : 'Off. You sign in with your login and password.';
  } else if (document.activeElement?.closest?.('#account-fields') == null) {
    $('e-name').value = user.displayName;
    $('e-login').value = user.login;
    $('e-role').value = user.role;
    // The last admin cannot be demoted, and neither can the admin editing
    // their own account here -- say so before the click.
    const self = me && user.key === me.key;
    $('e-role').querySelector('option[value="user"]').disabled = self;
    $('e-role-note').hidden = !self;
    if (self) $('e-role-note').textContent = 'Another admin has to change your role.';
    $('account-clear-password').hidden = !user.hasPassword;
    $('link-value').textContent = user.link || 'off';
    $('link-value').classList.toggle('dim', !user.link);
    $('link-copy').hidden = !user.link;
    $('link-off').hidden = !user.link;
    $('link-new').textContent = user.link ? 'Regenerate' : 'Create';
  }

  const p = user.player.effective;
  $('f-border').textContent = p.border ? `On, in ${p.borderColor}` : 'Off';
  $('f-muted').textContent = p.mutedBorder ? `On, in ${p.mutedColor}` : 'Off';
  $('f-plate').textContent = p.plate ? 'On, your name in the corner' : 'Off';
  for (const el of document.querySelectorAll('#f-border')) el.style.setProperty('--swatch', p.borderColor);

  $('images-heading').textContent = editing ? 'Video box in the recording' : 'Your video box in the recording';
  $('player-images-hint').textContent = editing
    ? "The player's video box. Offline shows the Offline picture (or nothing). Online shows the camera, or the Online picture when the camera is off. Talking and muted lay their pictures on top, and draw the borders set under Settings."
    : 'Your video box. Offline shows the Offline picture (or nothing). Online shows your camera, or the Online picture when your camera is off. Talking and muted lay their pictures on top, and draw the borders set under Settings.';
  $('character-images-hint').textContent = editing
    ? 'A second box for OBS. Offline shows the Offline picture, Online the character picture, with Talking and Muted laid on top while they speak or while their microphone is off. Any picture left unset is transparent, so with no Online picture the box can sit over a character bar.'
    : 'A second box for OBS. Offline shows the Offline picture, Online the character picture, with Talking and Muted laid on top while you speak or while your microphone is off. Any picture left unset is transparent, so with no Online picture the box can sit over a character bar.';
  for (const slot of document.querySelectorAll('#other-images .slot')) {
    const name = slot.dataset.slot;
    const set = !!user.images[name];
    const img = slot.querySelector('img');
    img.hidden = !set;
    if (set) img.src = imgUrl(name);
    slot.querySelector('.unset').hidden = set;
    slot.classList.toggle('set', set);
    slot.querySelector('.slot-pick').classList.toggle('still', !editing);
    slot.querySelector('[data-action="slot-clear"]').hidden = !editing || !set;
  }

  $('obs-link-row').hidden = !editing;
  if (editing) $('view-open').href = viewLink();

  $('danger-row').hidden = !editing;
  if (editing) {
    const self = me && user.key === me.key;
    $('delete-btn').hidden = self;
  }
}

// --- self-service portrait -------------------------------------------------

$('portrait-file').addEventListener('change', async () => {
  if (editingKey) return; // admin view: read-only, see the CSS/pointer-events guard too
  const file = $('portrait-file').files[0];
  if (!file) return;
  try {
    say('uploading...');
    await api('PUT', '/api/me/images/profile', file, file.type);
    await reload();
    render();
    say('image saved');
  } catch (err) {
    say(err.message, true);
  }
  $('portrait-file').value = '';
});

$('portrait-clear').addEventListener('click', async () => {
  if (editingKey) return;
  try {
    await api('DELETE', '/api/me/images/profile');
    await reload();
    render();
    say('image removed');
  } catch (err) {
    say(err.message, true);
  }
});

// --- admin editing someone else -----------------------------------------

async function run(fn, statusEl) {
  try {
    await fn();
  } catch (err) {
    sayField(statusEl, err.message, true);
  }
}

$('account-save').addEventListener('click', () => run(async () => {
  const patch = { displayName: $('e-name').value, login: $('e-login').value, role: $('e-role').value };
  const password = $('e-password').value;
  if (password) patch.password = password;
  user = (await api('PATCH', `/api/users/${user.key}`, patch)).user;
  $('e-password').value = '';
  render();
  sayField($('account-status'), 'saved');
}, $('account-status')));

$('account-clear-password').addEventListener('click', () => run(async () => {
  if (!user.link && !window.confirm(`${user.displayName} has no personal link. Without a password they cannot sign in. Remove it anyway?`)) return;
  user = (await api('PATCH', `/api/users/${user.key}`, { password: '' })).user;
  render();
  sayField($('account-status'), 'password removed');
}, $('account-status')));

$('link-copy').addEventListener('click', () => copy(user.link, $('account-status')));
$('link-new').addEventListener('click', () => run(async () => {
  if (user.link && !window.confirm('Regenerate the link? The old one stops working.')) return;
  user = (await api('POST', `/api/users/${user.key}/link`)).user;
  render();
  sayField($('account-status'), user.link ? 'new link made' : 'link created');
}, $('account-status')));
$('link-off').addEventListener('click', () => run(async () => {
  user = (await api('DELETE', `/api/users/${user.key}/link`)).user;
  render();
  sayField($('account-status'), 'link turned off');
}, $('account-status')));

$('other-images').addEventListener('change', (event) => {
  if (!editingKey || event.target.type !== 'file') return;
  const slot = event.target.closest('.slot').dataset.slot;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    say(`uploading ${slot}...`);
    user = (await api('PUT', `/api/users/${user.key}/images/${slot}`, file, file.type)).user;
    render();
    say('image saved');
  });
});
$('other-images').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="slot-clear"]');
  if (!button || !editingKey) return;
  const slot = button.closest('.slot').dataset.slot;
  run(async () => {
    user = (await api('DELETE', `/api/users/${user.key}/images/${slot}`)).user;
    render();
  });
});

$('view-kind').addEventListener('change', () => { $('view-open').href = viewLink(); });
$('view-copy').addEventListener('click', () => copy(viewLink(), $('status')));

$('mute-btn').addEventListener('click', () => run(async () => {
  await api('POST', `/api/users/${user.key}/mute`, { muted: true });
  say('muted');
}));
$('kick-btn').addEventListener('click', () => run(async () => {
  if (!window.confirm(`Kick ${user.displayName} from the table? They can rejoin.`)) return;
  await api('POST', `/api/users/${user.key}/kick`);
  say('kicked');
}));
$('delete-btn').addEventListener('click', () => run(async () => {
  if (!window.confirm(`Delete ${user.displayName}? Their images and links go with them.`)) return;
  await api('DELETE', `/api/users/${user.key}`);
  location.href = '/admin';
}));

async function init() {
  await loadBranding();
  wireOverlayBack();
  try {
    if (editingKey) {
      const mine = await api('GET', '/api/me');
      me = mine.user;
      if (me.role !== 'admin') { location.href = '/'; return; }
      streamKey = mine.streamKey || '';
    }
    await reload();
  } catch (err) {
    location.href = editingKey ? '/admin' : '/login?next=/profile';
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${user.displayName}`;
  render();
}
init();
