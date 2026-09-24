import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
loadBranding().then((b) => {
  $('register-note').hidden = !b.allowRegistration;
  // The policy says everyone signs in in two steps: say so before the password is typed.
  if (b.mfa === 'everyone') { $('mfa-note').textContent = 'You will be asked for a code from your authenticator app after this.'; $('mfa-note').hidden = false; }
});

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
    const res = await api('POST', '/api/login', { login: $('login-name').value.trim(), password: $('password').value });
    const next = new URLSearchParams(location.search).get('next') || '/';
    const safeNext = next.startsWith('/') ? next : '/';
    // A second step: the code page, or enrolment first for an account the policy requires to have one (the pending
    // token that says who this is is in a cookie the server just set).
    if (res && res.mfaRequired) { location.href = `/login/${res.enrol ? 'enrol' : 'verify'}?next=${encodeURIComponent(safeNext)}`; return; }
    location.href = safeNext;
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  }
});
