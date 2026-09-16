// Fills in the server name and icon on every page from /api/branding.
export async function loadBranding() {
  let b = { serverName: 'Coffee Pub Tavern', tableName: 'The Table', loginText: '', hasIcon: false };
  try {
    const res = await fetch('/api/branding');
    if (res.ok) b = await res.json();
  } catch (err) {
    // keep the defaults
  }
  document.querySelectorAll('[data-brand="serverName"]').forEach((el) => (el.textContent = b.serverName));
  document.querySelectorAll('[data-brand="tableName"]').forEach((el) => (el.textContent = b.tableName));
  document.querySelectorAll('[data-brand="loginText"]').forEach((el) => (el.textContent = b.loginText));
  document.querySelectorAll('[data-brand="version"]').forEach((el) => (el.textContent = b.version || ''));
  const suffix = document.title.split(' - ').slice(1).join(' - ');
  document.title = suffix ? `${b.serverName} - ${suffix}` : b.serverName;
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.href = `/img/site/icon?v=${Date.now()}`;
  document.querySelectorAll('img[data-brand="icon"]').forEach((el) => (el.src = icon.href));
  // A page marked data-brand="background" (the sign-in page) gets the
  // background picture when one is set. It goes on the root element: the
  // root has its own colour, so a picture on the body would stop at the
  // body's box and leave the collapsed margin above the sign-in box bare.
  if (document.querySelector('[data-brand="background"]')) {
    const root = document.documentElement;
    root.classList.toggle('has-background', Boolean(b.hasBackground));
    root.style.backgroundImage = b.hasBackground ? `url("/img/site/background?v=${Date.now()}")` : '';
  }
  return b;
}

export async function api(method, url, body, contentType) {
  const headers = {};
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof Blob) {
    headers['content-type'] = contentType || body.type;
  }
  const res = await fetch(url, { method, headers, body: payload });
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Your profile or Manage, opened from inside a call (room.js loads either
// one in an iframe rather than navigating away, so the call underneath
// keeps running). Adds a "Back to [room]" link to this page's own header,
// which closes the overlay via the parent window -- same origin, so a
// direct call, no postMessage plumbing needed. A page that isn't "about"
// the room itself (Manage, say) can pass its own label instead of the
// room's name.
export function wireOverlayBack(label) {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'room' || window.parent === window) return;
  const nav = document.querySelector('.topbar nav.links');
  if (!nav) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-small';
  const room = params.get('room');
  back.textContent = label ? `← Back to ${label}` : room ? `← Back to ${room}` : '← Back to the table';
  back.addEventListener('click', () => {
    try {
      window.parent.closeProfileOverlay?.();
    } catch (err) {
      // not actually framed by our own page for some reason; nothing to do
    }
  });
  nav.prepend(back);
}

export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}
