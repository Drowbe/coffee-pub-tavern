// The owner's banner on every page of a hosted environment whose payment has lapsed (or that the host suspended):
// a line under the header saying so and when the environment goes to the free plan. Only the owner (or the host admin) sees
// it, and only on a host with environments; everyone else, and every single-environment server, costs nothing here.
// brand.js calls this once the header is drawn.
import { word } from '/words.js';

export async function mountEnvironmentBanner() {
  if (document.querySelector('.env-page-banner')) return;
  let me;
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    me = await res.json();
  } catch (err) {
    return;
  }
  const env = me && me.environment;
  if (!env || !env.hosted || !(env.owner || env.hostAdmin)) return;
  let info;
  try {
    const res = await fetch('/api/environment');
    if (!res.ok) return;
    info = await res.json();
  } catch (err) {
    return;
  }
  if (info.status !== 'pastDue' && info.status !== 'suspended') return;
  const banner = document.createElement('div');
  banner.className = 'env-page-banner';
  banner.setAttribute('role', 'status');
  if (info.status === 'pastDue') {
    const until = info.graceEndsAt ? new Date(info.graceEndsAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'soon';
    banner.textContent = `Payment for this ${word('environment')} is overdue. It goes to the free plan on ${until}; nothing is deleted. `;
  } else {
    banner.textContent = `This ${word('environment')} is suspended by the ${word('host')}. `;
  }
  const link = document.createElement('a');
  link.href = '/admin';
  link.textContent = 'Manage';
  banner.appendChild(link);
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.after(banner); else document.body.prepend(banner);
}
