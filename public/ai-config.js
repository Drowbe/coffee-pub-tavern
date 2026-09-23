// The AI service's configuration page (Manage > Modules > AI service > AI Configuration): /ai-config.html. Admins only.
// The choice is the host's managed service (its own provider, model and key, set on the host console or by the
// server's environment variables) or a custom one for this environment; the form itself is public/ai-form.js.
import { loadBranding, api, renderTopbar, crumbLink, wireOverlayBack } from '/brand.js';
import { mountAiForm } from '/ai-form.js';

renderTopbar({ location: crumbLink('gear', 'Server Settings', '/admin') });
await loadBranding();
wireOverlayBack();

const form = mountAiForm({ get: '/api/ai', put: '/api/ai', models: '/api/ai/models', source: true, cap: true, usage: true });

try {
  const me = (await api('GET', '/api/me')).user;
  if (me.role !== 'admin') location.href = '/';
  else await form.load();
} catch {
  location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
}
