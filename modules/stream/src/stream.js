// Stream: the module's own page. Every player's links for a streaming program (each carries the server's
// access key, so this page is for owners and whoever is given "See the stream links"), and the key itself
// with show, copy and regenerate. The views themselves are the keyed page (stream-keyed.js). The SDK
// (window.host) is injected by the host.
(async () => {
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { esc } = host.util;
  /*__LIB__*/

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('note').textContent = `Could not start: ${err.message}`;
    $('note').hidden = false;
    return;
  }
  $('app').hidden = false;

  // The links are only worth showing with the key in them; without it, say why. The server hands the key only to
  // someone who runs the environment (an owner, or the host admin), so having it is what shows the key panel too.
  let accessKey = null;
  try {
    accessKey = await host.access.key();
  } catch {
    accessKey = null;
  }
  const origin = location.origin;
  const link = (key, kind) => `${origin}/view/${encodeURIComponent(key)}?s=${encodeURIComponent(accessKey || '')}&kind=${kind}`;

  // --- the access key ---
  let shown = false;
  const say = (text) => { $('key-status').textContent = text; if (text) setTimeout(() => { if ($('key-status').textContent === text) $('key-status').textContent = ''; }, 2500); };
  const drawKey = () => { $('key-text').textContent = shown ? accessKey || '' : '••••••••'; $('key-show').textContent = shown ? 'Hide' : 'Show'; };
  if (accessKey) {
    $('key-panel').hidden = false;
    drawKey();
    $('key-show').addEventListener('click', () => { shown = !shown; drawKey(); });
    $('key-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(accessKey); say('copied'); } catch { say('could not copy'); }
    });
    $('key-regen').addEventListener('click', async () => {
      if (!window.confirm('Regenerate the access key? Every existing link and the Studio app need the new one.')) return;
      try {
        accessKey = await host.access.regenerate();
        drawKey();
        drawPeople(lastPresence);
        say('new access key');
      } catch (err) {
        say(err.message);
      }
    });
  }

  // --- the people and their links ---
  let lastPresence = null;
  const avatars = new Map(); // key -> blob url
  async function avatarFor(key) {
    if (avatars.has(key)) return avatars.get(key);
    let url = null;
    try { url = await host.images.get(key, 'profile'); } catch { url = null; }
    avatars.set(key, url);
    return url;
  }
  function drawPeople(p) {
    lastPresence = p;
    const list = $('people');
    list.replaceChildren();
    if (!accessKey) {
      $('links-note').textContent = 'Only an owner sees the links, since each one carries the access key.';
      $('links-note').hidden = false;
      return;
    }
    $('links-note').hidden = true;
    const people = [...(p ? p.people : [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const person of people) {
      const li = $('tpl-person').content.firstElementChild.cloneNode(true);
      li.dataset.key = person.key;
      li.querySelector('.name').textContent = person.name;
      li.querySelector('.online').hidden = !person.online;
      li.querySelector('[data-open]').href = link(person.key, 'player');
      const img = li.querySelector('.avatar');
      avatarFor(person.key).then((url) => { if (url) img.src = url; else img.hidden = true; });
      list.appendChild(li);
    }
    if (!people.length) list.innerHTML = `<li class="hint">${esc('Nobody has an account yet.')}</li>`;
  }
  $('people').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const key = button.closest('.person').dataset.key;
    try {
      await navigator.clipboard.writeText(link(key, button.dataset.copy));
      const was = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = was; }, 1500);
    } catch {
      window.prompt('Copy this link', link(key, button.dataset.copy));
    }
  });
  host.presence.onChange(drawPeople, { every: 10000 });
})();
