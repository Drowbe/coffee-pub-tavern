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
