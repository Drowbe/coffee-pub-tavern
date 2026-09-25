// The page a room's moderators use to change the settings modules declare for that room: /module-settings?room=<id>.
import { loadBranding, api, renderTopbar, wireOverlayBack } from '/brand.js';
import { renderModuleSettings } from '/module-settings.js';

const $ = (id) => document.getElementById(id);
const roomId = new URLSearchParams(location.search).get('room') || '';

renderTopbar({ location: '' });
await loadBranding();
wireOverlayBack();
try {
  const me = (await api('GET', '/api/me')).user;
  $('whoami').textContent = me.displayName;
  const { spaces: rooms } = await api('GET', '/api/presence');
  const r = rooms.find((x) => x.id === roomId);
  if (r) $('title').textContent = `${r.name}: module settings`;
} catch {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}
await renderModuleSettings($('settings'), { scope: 'room', room: roomId });
$('none').hidden = !$('settings').hidden;
