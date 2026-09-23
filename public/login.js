import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
loadBranding().then((b) => { $('register-note').hidden = !b.allowRegistration; });

// Sent back here by the product page's own sign-in form (a form post to this environment's /login that was refused):
// the login it tried is filled in and the usual message shown, so the person only retypes the password.
{
  const params = new URLSearchParams(location.search);
  if (params.get('login')) $('login-name').value = params.get('login').slice(0, 40);
  if (params.get('error')) {
    $('error').textContent = 'That login or password is not right.';
    $('error').hidden = false;
    $('password').focus();
  }
}

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
