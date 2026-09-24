// The second step of signing in (see plans/plan-mfa.md): /login/verify asks for a code and issues the session;
// /login/enrol sets a required account up first, and the enable answer carries the session. Where to go afterwards is
// `next` in the address, the same as the sign-in page's.
import { loadBranding, api } from '/brand.js';
import { mountEnrolment } from '/mfa-enrol.js';

const $ = (id) => document.getElementById(id);
const mode = location.pathname.endsWith('/enrol') ? 'enrol' : 'verify';
const next = (() => { const n = new URLSearchParams(location.search).get('next') || '/'; return n.startsWith('/') ? n : '/'; })();

loadBranding();

if (mode === 'verify') {
  $('verify').hidden = false;
  let recovery = false;
  $('use-recovery').addEventListener('click', () => {
    recovery = !recovery;
    $('code-label').firstChild.textContent = recovery ? 'Recovery code' : 'Code';
    $('verify-lede').textContent = recovery ? 'One of the recovery codes you saved when you set the app up. It works once.' : 'One more step: the six digits your authenticator app shows.';
    $('use-recovery').textContent = recovery ? 'Use the app instead' : 'Use a recovery code instead';
    $('code').value = '';
    $('code').focus();
  });
  $('verify').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('error').hidden = true;
    try {
      await api('POST', '/api/login/verify', { code: $('code').value.trim(), remember: $('remember').checked });
      location.href = next;
    } catch (err) {
      $('error').textContent = err.status === 401 && !/\S/.test(err.message || '') ? 'That code is not right.' : err.message;
      $('error').hidden = false;
      $('code').select();
    }
  });
} else {
  $('enrol').hidden = false;
  mountEnrolment($('enrol-block'), {
    start: '/api/me/mfa/start',
    enable: '/api/me/mfa/enable',
    onDone: () => { location.href = next; },
  });
}
