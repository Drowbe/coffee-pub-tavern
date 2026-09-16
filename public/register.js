import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.startsWith('/invite/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : null;

async function init() {
  const branding = await loadBranding();
  if (token) {
    try {
      const { invite } = await api('GET', `/api/invites/${token}`);
      $('invite-note').hidden = false;
      $('invite-note').textContent = invite.rooms.length
        ? `You're invited to join: ${invite.rooms.join(', ')}.`
        : "You're invited to join the table.";
    } catch (err) {
      $('closed-text').textContent = err.message;
      $('register').hidden = true;
      $('closed').hidden = false;
      return;
    }
  } else if (!branding.allowRegistration) {
    $('register').hidden = true;
    $('closed').hidden = false;
    return;
  }
}
init();

$('register').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('error').hidden = true;
  const body = { displayName: $('display-name').value.trim(), login: $('login-name').value.trim(), password: $('password').value };
  try {
    await api('POST', token ? `/api/invites/${token}/accept` : '/api/register', body);
    location.href = '/';
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  }
});
