// The product page at the bare base domain. The product's name, the contact address and the base domain come from the
// host (GET /api/product, public), so the page never hard-codes a name while the name is still being chosen.
const fill = (sel, text) => { for (const el of document.querySelectorAll(sel)) el.textContent = text; };

let product = { name: 'Coffee Pub', contact: null, baseDomain: '', version: '' };
try {
  const res = await fetch('/api/product');
  if (res.ok) product = { ...product, ...(await res.json()) };
} catch (err) {
  // the defaults stand
}

fill('[data-product]', product.name);
document.title = product.name;
for (const img of document.querySelectorAll('[data-product-alt]')) {
  img.alt = product.name;
  // the name in text if the logo cannot load (a host that does not serve the brand folder at its base)
  const showName = () => { img.hidden = true; const name = img.nextElementSibling; if (name) name.classList.remove('sr-only'); };
  if (img.complete && img.naturalWidth === 0) showName();
  img.addEventListener('error', showName);
}
fill('[data-version]', product.version ? String(product.version) : '');
const example = document.querySelector('[data-example-host]');
if (example && product.baseDomain) example.textContent = `yourname.${product.baseDomain}`;

// Whether anyone can make an environment from this page (the host's SIGNUP switch, on a host with a base domain). Off,
// every call to action reads "Coming soon" and does nothing (the author: not ready for this), and the Get started band
// says so; a contact address, when the host has given one, is still offered as the way to ask.
const signupOpen = Boolean(product.signup && product.baseDomain);
const comingSoon = (el) => { el.textContent = 'Coming soon'; el.classList.add('coming-soon'); el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); };

// The calls to action go to the Get started band (the form, when sign-up is open); the band's own "Ask" link is a mail link.
for (const a of document.querySelectorAll('[data-contact-link]')) {
  const isAsk = Boolean(a.closest('#start-ask')); // the one link that stays a way to ask while sign-up is off, given an address
  if (!signupOpen && !(isAsk && product.contact)) comingSoon(a);
  else if (isAsk && product.contact) a.href = `mailto:${product.contact}?subject=${encodeURIComponent(`An environment on ${product.name}`)}`;
}
const hint = document.querySelector('[data-contact-hint]');
if (hint) {
  hint.hidden = false;
  hint.textContent = product.contact ? `Or write to ${product.contact}.` : (signupOpen ? '' : 'Sign-up from this page is coming; for now, ask whoever runs this host.');
  hint.hidden = !hint.textContent;
}

// --- Sign in: which environment? ---------------------------------------------------------------------------------
// The host's environments (GET /api/product/environments, public: on a host run for a handful of groups, naming them is
// fine) as a list to choose from. The host never knows who a visitor is, only where they have been: an environment leaves
// `env_hint=<slug>,<slug>...` on the parent domain when someone signs in there (most recent first), and that one is
// preselected, so a second visit is one click.
const envUrl = (slug, path = '/login') => `${location.protocol}//${slug}.${product.baseDomain}${location.port ? `:${location.port}` : ''}${path}`;
const slugOk = (s) => /^[a-z0-9-]{3,30}$/.test(s);
const cookie = (name) => { const m = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`)); return m ? decodeURIComponent(m.slice(name.length + 1)) : ''; };
const note = document.getElementById('signin-note');
const sayNote = (text) => { note.textContent = text; note.hidden = !text; };
const select = document.getElementById('signin-env');
const navSignin = document.getElementById('nav-signin');

(async () => {
  let environments = [];
  try {
    const res = await fetch('/api/product/environments');
    if (res.ok) environments = (await res.json()).environments || [];
  } catch (err) {
    environments = [];
  }
  environments = environments.filter((e) => e && slugOk(e.slug));
  for (const env of environments) {
    const o = document.createElement('option');
    o.value = env.slug;
    o.textContent = env.name || env.slug;
    select.append(o);
  }
  if (!environments.length) {
    sayNote(product.baseDomain ? 'No environments to sign in to yet.' : 'Sign-in from this page needs a base domain; this host has one environment, at its own address.');
    select.disabled = true;
    return;
  }
  // the one this browser was last in, if it is still here
  const recent = cookie('env_hint').split(',').map((s) => s.trim()).find((s) => environments.some((e) => e.slug === s));
  if (recent) {
    select.value = recent;
    const env = environments.find((e) => e.slug === recent);
    if (navSignin) { navSignin.href = envUrl(recent); navSignin.textContent = `Sign in to ${env.name || recent}`; }
    chosen();
  }
})();

// Choosing an environment reveals the login and password; the form then posts to that environment's own /login (a
// plain, top-level form post, so its session cookie is first-party), which signs the person in and sends them on.
const creds = document.getElementById('signin-creds');
const form = document.getElementById('signin-form');
function chosen() {
  const slug = select.value;
  const ok = slugOk(slug) && Boolean(product.baseDomain);
  creds.hidden = !ok;
  form.action = ok ? envUrl(slug) : '#signin';
  if (ok) { sayNote(''); document.getElementById('signin-login').focus(); }
}
select.addEventListener('change', chosen);
form.addEventListener('submit', (e) => {
  const slug = select.value;
  if (!slugOk(slug) || !product.baseDomain) { e.preventDefault(); sayNote('Choose an environment first.'); return; }
  form.action = envUrl(slug); // and let the browser post it there
});

// --- Plans, from the host's catalog ---------------------------------------------------------------------------------
// GET /api/product lists the plans (id, name, caps, checkoutUrl). The free plan is what sign-up makes; a plan with a
// checkout address is bought on the provider's own page (the app never sees a card); one without is not sold online.
const capLine = (caps) => {
  const c = caps || {};
  const gb = (b) => (b >= 1e9 ? `${Math.round(b / 1e9)} GB` : `${Math.round(b / 1e6)} MB`);
  return [
    c.members ? `${c.members} people` : 'unlimited people',
    c.storageBytes ? `${gb(c.storageBytes)} of storage` : 'unlimited storage',
    c.aiCallsPerMonth ? `${c.aiCallsPerMonth} assistant calls a month` : 'the assistant without a cap',
    c.calls ? `${c.calls} call${c.calls === 1 ? '' : 's'} at once` : 'calls without a cap',
    Array.isArray(c.modules) ? `${c.modules.length} modules` : 'every module',
  ];
};
if (Array.isArray(product.plans) && product.plans.length) {
  const grid = document.getElementById('plans-grid');
  grid.replaceChildren(...product.plans.map((p) => {
    const box = document.createElement('div');
    box.className = 'plan';
    const h = document.createElement('h3');
    h.textContent = p.name || p.id;
    const ul = document.createElement('ul');
    ul.className = 'plan-caps';
    for (const line of capLine(p.caps)) { const li = document.createElement('li'); li.textContent = line; ul.append(li); }
    box.append(h, ul);
    if (!signupOpen) {
      const a = document.createElement('a'); a.className = 'btn btn-small'; comingSoon(a); box.append(a);
    } else if (p.id === 'free') {
      const a = document.createElement('a'); a.className = 'btn btn-small'; a.href = '#start'; a.textContent = 'Start free'; box.append(a);
    } else if (p.checkoutUrl) {
      const a = document.createElement('a'); a.className = 'btn btn-primary btn-small'; a.href = p.checkoutUrl; a.rel = 'noopener'; a.textContent = `Choose ${p.name || p.id}`; box.append(a);
      const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Start free, then upgrade from inside your environment.'; box.append(note);
    } else {
      const note = document.createElement('p'); note.className = 'hint'; note.textContent = product.contact ? `Ask at ${product.contact}.` : 'Ask whoever runs this host.'; box.append(note);
    }
    return box;
  }));
}

// --- Sign-up: an environment of your own ---------------------------------------------------------------------------
// POST /api/product/signup makes it on the free plan and answers its address. Off (SIGNUP=off, or no base domain), the
// section falls back to asking. The slug is checked as it is typed against the public environment lookup.
const signup = document.getElementById('signup-form');
const ask = document.getElementById('start-ask');
const startLede = document.getElementById('start-lede');
if (signupOpen) {
  signup.hidden = false;
  document.querySelector('[data-signup-domain]').textContent = `.${product.baseDomain}`;
  const slugInput = document.getElementById('signup-slug');
  const slugNote = document.getElementById('signup-slug-note');
  const status = document.getElementById('signup-status');
  // The Template choice (GET /api/product's `templates`): None, then each with its description; hidden when there are none.
  const templates = (Array.isArray(product.templates) ? product.templates : []).filter((t) => t && typeof t.id === 'string');
  const templateBox = document.getElementById('signup-template');
  if (templates.length) {
    const options = document.getElementById('signup-template-options');
    const option = (id, name, description) => {
      const label = document.createElement('label');
      label.className = 'template-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'template';
      input.value = id;
      input.checked = !id;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = name;
      const about = document.createElement('span');
      about.className = 'hint';
      about.textContent = description;
      text.append(strong, about);
      label.append(input, text);
      return label;
    };
    options.replaceChildren(option('', 'None', 'Start plain: the usual words and settings.'), ...templates.map((t) => option(t.id, t.name || t.id, t.description || '')));
    templateBox.hidden = false;
  }
  let checkToken = 0;
  slugInput.addEventListener('input', async () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const slug = slugInput.value;
    if (!slugOk(slug)) { slugNote.textContent = 'Letters, digits and hyphens, 3 to 30; it cannot be changed later.'; slugNote.classList.remove('error'); return; }
    const mine = ++checkToken;
    try {
      const res = await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`);
      if (mine !== checkToken) return;
      if (res.ok) { slugNote.textContent = `${slug}.${product.baseDomain} is taken.`; slugNote.classList.add('error'); }
      else { slugNote.textContent = `${slug}.${product.baseDomain} is free.`; slugNote.classList.remove('error'); }
    } catch (err) {
      // the server says on submit
    }
  });
  signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      slug: slugInput.value.trim(),
      name: document.getElementById('signup-name').value.trim(),
      ...(templateBox.querySelector('input:checked')?.value ? { template: templateBox.querySelector('input:checked').value } : {}),
      owner: { login: document.getElementById('signup-login').value.trim(), displayName: document.getElementById('signup-display').value.trim(), password: document.getElementById('signup-password').value },
    };
    status.classList.remove('error');
    status.textContent = 'Making it...';
    document.getElementById('signup-submit').disabled = true;
    try {
      const res = await fetch('/api/product/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `could not create it (${res.status})`);
      status.textContent = 'Made. Taking you there...';
      location.href = data.url || envUrl(body.slug, '/login');
    } catch (err) {
      status.classList.add('error');
      status.textContent = err.message;
      document.getElementById('signup-submit').disabled = false;
    }
  });
} else {
  document.getElementById('start-title').textContent = 'Coming soon';
  ask.hidden = !product.contact; // the mail link is the one way to ask; without an address there is nothing to press
  if (product.contact) ask.querySelector('a').textContent = 'Ask for an environment';
  startLede.textContent = product.baseDomain ? 'Making your own environment from this page is not open yet.' : 'This host is one environment at its own address; there is nothing to sign up for here.';
}
