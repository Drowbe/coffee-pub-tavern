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

// --- Sign in: where has this person been? -----------------------------------------------------------------------
// An environment leaves `env_hint=<slug>,<slug>...` on the parent domain when someone signs in there (most recent first).
// The host never knows who they are, only where they have been; each slug is looked up for its name, and a button goes
// straight there. A box for a first visit (or another device) takes an environment's slug.
const envUrl = (slug, path = '/login') => `${location.protocol}//${slug}.${product.baseDomain}${location.port ? `:${location.port}` : ''}${path}`;
const slugOk = (s) => /^[a-z0-9-]{3,30}$/.test(s);
const cookie = (name) => { const m = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`)); return m ? decodeURIComponent(m.slice(name.length + 1)) : ''; };
const suffix = document.querySelector('[data-suffix]');
if (suffix) suffix.textContent = `.${product.baseDomain || 'example'}`;
const note = document.getElementById('signin-note');
const sayNote = (text) => { note.textContent = text; note.hidden = !text; };

async function lookup(slug) {
  try {
    const res = await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

(async () => {
  const known = document.getElementById('signin-known');
  const navSignin = document.getElementById('nav-signin');
  const slugs = cookie('env_hint').split(',').map((s) => s.trim()).filter(slugOk).slice(0, 5);
  if (!slugs.length || !product.baseDomain) return;
  const found = (await Promise.all(slugs.map(lookup))).filter(Boolean);
  if (!found.length) return;
  known.replaceChildren(...found.map((env) => {
    const a = document.createElement('a');
    a.className = 'btn btn-primary';
    a.href = envUrl(env.slug);
    a.textContent = `Sign in to ${env.name || env.slug}`;
    return a;
  }));
  known.hidden = false;
  document.getElementById('signin-lede').textContent = found.length === 1 ? 'Back to where you were:' : 'Back to one of yours:';
  // the nav's Sign in goes straight to the most recent one
  if (navSignin) { navSignin.href = envUrl(found[0].slug); navSignin.textContent = `Sign in to ${found[0].name || found[0].slug}`; }
})();

document.getElementById('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('signin-slug');
  const slug = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('.')[0];
  if (!slugOk(slug)) { sayNote('An environment\'s name is 3 to 30 letters, digits or hyphens.'); return; }
  sayNote('');
  const env = await lookup(slug);
  if (!env) { sayNote(`There is no environment called "${slug}" here. Check the address you were given.`); return; }
  location.href = envUrl(env.slug);
});
