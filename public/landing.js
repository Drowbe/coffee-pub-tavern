// The product page at the bare base domain. The product's name, the contact address and the base domain come from the
// host (GET /api/product, public), so the page never hard-codes a name while the name is still being chosen.
const fill = (sel, text) => { for (const el of document.querySelectorAll(sel)) el.textContent = text; };

let product = { name: 'Coffee Pub Tavern', contact: null, baseDomain: '', version: '' };
try {
  const res = await fetch('/api/product');
  if (res.ok) product = { ...product, ...(await res.json()) };
} catch (err) {
  // the defaults stand
}

fill('[data-product]', product.name);
document.title = product.name;
for (const img of document.querySelectorAll('[data-product-alt]')) img.alt = product.name;
fill('[data-version]', product.version ? String(product.version) : '');
const example = document.querySelector('[data-example-host]');
if (example && product.baseDomain) example.textContent = `yourname.${product.baseDomain}`;

// The calls to action: a mail link when the host has given a contact address; otherwise the section itself, which says how.
for (const a of document.querySelectorAll('[data-contact-link]')) {
  if (product.contact) {
    a.href = `mailto:${product.contact}?subject=${encodeURIComponent(`An environment on ${product.name}`)}`;
  }
}
const hint = document.querySelector('[data-contact-hint]');
if (hint) {
  hint.hidden = false;
  hint.textContent = product.contact ? `Or write to ${product.contact}.` : 'Sign-up from this page is coming; for now, ask whoever runs this host.';
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
