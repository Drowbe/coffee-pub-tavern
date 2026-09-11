// Your profile: change your player image, see everything else your admin set.
import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
let me = null;

function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function imgUrl(slot) {
  return `/img/${encodeURIComponent(me.key)}/${slot}?v=${Date.now()}`;
}

function render() {
  const has = !!me.images.player;
  $('portrait').src = imgUrl('player'); // the server draws initials when unset
  $('portrait-slot').classList.toggle('set', has);
  $('portrait-clear').hidden = !has;
  document.querySelector('#portrait-slot .unset').hidden = true;
  $('whoami-img').src = imgUrl('player');
  $('whoami-img').hidden = false;
  $('whoami').textContent = me.displayName;
  $('name').textContent = me.displayName;
  $('admin-link').hidden = me.role !== 'admin';

  $('f-name').textContent = me.displayName;
  $('f-login').textContent = me.login;
  $('f-role').textContent = me.role === 'admin' ? 'Admin: runs the table' : 'Player';
  $('f-password').textContent = me.hasPassword ? 'Set. Only an admin can change it.' : 'None. You sign in with your personal link.';
  $('f-link').textContent = me.link ? 'On. Your admin can send it to you again or turn it off.' : 'Off. You sign in with your login and password.';

  const p = me.player.effective;
  $('f-border').textContent = p.border ? `On, in ${p.borderColor}` : 'Off';
  $('f-badge').textContent = p.badge ? 'On' : 'Off';
  $('f-plate').textContent = p.plate ? 'On, your name in the corner' : 'Off';
  for (const el of document.querySelectorAll('#f-border')) el.style.setProperty('--swatch', p.borderColor);

  for (const slot of document.querySelectorAll('#other-images .slot')) {
    const name = slot.dataset.slot;
    const set = !!me.images[name];
    const img = slot.querySelector('img');
    img.hidden = !set;
    if (set) img.src = imgUrl(name);
    slot.querySelector('.unset').hidden = set;
    slot.classList.toggle('set', set);
  }
}

$('portrait-file').addEventListener('change', async () => {
  const file = $('portrait-file').files[0];
  if (!file) return;
  try {
    say('uploading...');
    await api('PUT', '/api/me/images/player', file, file.type);
    me = (await api('GET', '/api/me')).user;
    render();
    say('image saved');
  } catch (err) {
    say(err.message, true);
  }
  $('portrait-file').value = '';
});

$('portrait-clear').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/me/images/player');
    me = (await api('GET', '/api/me')).user;
    render();
    say('image removed');
  } catch (err) {
    say(err.message, true);
  }
});

async function init() {
  await loadBranding();
  try {
    me = (await api('GET', '/api/me')).user;
  } catch (err) {
    location.href = '/login?next=/profile';
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${me.displayName}`;
  render();
}
init();
