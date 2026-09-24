// Enrolling a second factor: one block, the same wherever it is shown (the profile page, the enrolment page a required
// account lands on, the host console for a host admin). Two steps: scan the QR (or type the secret) and confirm with a
// code; then the recovery codes, shown once, with a step that says they are saved. `start` and `enable` are the API
// paths for whoever is enrolling; `onDone(result)` gets the enable answer (the recovery codes, and a session for a
// pending enrolment). Text nobody here wrote goes in with textContent; the QR is an SVG the server drew, so it may be
// placed as markup.
import { api } from '/brand.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function mountEnrolment(root, { start, enable, onDone, who = 'you' }) {
  root.hidden = false;
  root.innerHTML = '<p class="hint">Getting a code ready...</p>';
  let began;
  try {
    began = await api('POST', start);
  } catch (err) {
    root.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
    return;
  }
  root.innerHTML = `
    <div class="mfa-step" data-step="scan">
      <p class="hint">Open your authenticator app, add an account, and scan this. If you cannot scan, type the key under it instead.</p>
      <div class="mfa-scan">
        <div class="mfa-qr" aria-label="The QR code to scan"></div>
        <div class="mfa-key">
          <span class="fact-key">The key, if you cannot scan</span>
          <code class="key" data-secret></code>
          <span class="fact-key">Then the six digits the app shows</span>
          <form class="row" data-confirm>
            <input type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required aria-label="The code from the app">
            <button class="btn btn-primary btn-small" type="submit">Turn on</button>
            <span class="status" data-status role="status"></span>
          </form>
        </div>
      </div>
    </div>
    <div class="mfa-step" data-step="codes" hidden>
      <p class="hint">Two-step sign-in is on${who === 'you' ? '' : ` for ${esc(who)}`}. These recovery codes each sign in once if the app is ever gone. They are shown only now: keep them somewhere safe.</p>
      <ul class="mfa-codes" data-codes></ul>
      <div class="row">
        <button class="btn btn-small" type="button" data-copy>Copy them</button>
        <button class="btn btn-primary btn-small" type="button" data-saved>I have saved them</button>
      </div>
    </div>`;
  root.querySelector('.mfa-qr').innerHTML = began.qr || '';
  root.querySelector('[data-secret]').textContent = began.secret || '';
  const form = root.querySelector('[data-confirm]');
  const status = root.querySelector('[data-status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = form.querySelector('input').value.trim();
    status.classList.remove('error');
    status.textContent = 'checking...';
    let result;
    try {
      result = await api('POST', enable, { code });
    } catch (err) {
      status.classList.add('error');
      status.textContent = err.message;
      form.querySelector('input').select();
      return;
    }
    status.textContent = '';
    root.querySelector('[data-step="scan"]').hidden = true;
    const codesStep = root.querySelector('[data-step="codes"]');
    const list = codesStep.querySelector('[data-codes]');
    list.replaceChildren(...(result.recoveryCodes || []).map((c) => { const li = document.createElement('li'); li.textContent = c; return li; }));
    codesStep.hidden = false;
    codesStep.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText((result.recoveryCodes || []).join('\n')); } catch (err) { /* the list is on screen */ }
    });
    codesStep.querySelector('[data-saved]').addEventListener('click', () => {
      root.hidden = true;
      root.replaceChildren();
      if (onDone) onDone(result);
    });
  });
  form.querySelector('input').focus();
}

// Turning it off, or resetting someone's: a code is asked inline, never with a browser prompt.
export function mountDisable(root, { disable, onDone, label = 'Turn off' }) {
  root.hidden = false;
  root.innerHTML = `
    <form class="row" data-disable>
      <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="a code from the app, or a recovery code" required aria-label="A code">
      <button class="btn btn-danger btn-small" type="submit">${esc(label)}</button>
      <button class="btn btn-small" type="button" data-cancel>Cancel</button>
      <span class="status" data-status role="status"></span>
    </form>`;
  const form = root.querySelector('[data-disable]');
  const status = root.querySelector('[data-status]');
  root.querySelector('[data-cancel]').addEventListener('click', () => { root.hidden = true; root.replaceChildren(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.classList.remove('error');
    status.textContent = 'checking...';
    try {
      await api('POST', disable, { code: form.querySelector('input').value.trim() });
      root.hidden = true;
      root.replaceChildren();
      if (onDone) onDone();
    } catch (err) {
      status.classList.add('error');
      status.textContent = err.message;
    }
  });
  form.querySelector('input').focus();
}
