import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
loadBranding();

$('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('error').hidden = true;
  try {
    await api('POST', '/api/login', { login: $('login-name').value.trim(), password: $('password').value });
    const next = new URLSearchParams(location.search).get('next') || '/';
    location.href = next.startsWith('/') ? next : '/';
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  }
});
