import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
let me = null;

function refreshPreview() {
  $('preview').src = `/img/${encodeURIComponent(me.key)}/novideo?v=${Date.now()}`;
}

function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    say('uploading...');
    await api('PUT', '/api/me/images/novideo', file, file.type);
    refreshPreview();
    say('saved');
  } catch (err) {
    say(err.message, true);
  }
  $('file').value = '';
});

$('remove').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/me/images/novideo');
    refreshPreview();
    say('removed');
  } catch (err) {
    say(err.message, true);
  }
});

async function init() {
  await loadBranding();
  try {
    me = (await api('GET', '/api/me')).user;
  } catch (err) {
    location.href = '/login?next=/me';
    return;
  }
  $('title').textContent = `${me.displayName}: your image`;
  refreshPreview();
}
init();
