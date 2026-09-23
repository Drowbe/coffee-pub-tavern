# Tenants Architecture

**Audience:** developers changing `server/index.js`, `server/environment.js` or `server/host-registry.js`, or
adding a new module-level singleton to the server.

What this is for and the decisions behind it are [plan-tenants](../plans/plan-tenants.md) (phase 1 is built;
later phases are still a plan). This document is what you can only learn from the code: how the seam actually
works, and the one thing to get right whenever you touch it.

## The seam, in one sentence

Every request resolves one *environment* (a built set of `store`, `modules`, `moduleData` and the rest, all from
one data directory) before any route handler runs, and every handler keeps reading those names exactly as it
always has -- because the names are no longer the real objects, they are Proxies that forward to whichever
environment the current request resolved.

## `server/environment.js`: what an environment is

`buildEnvironment(dataDir, { slug, admin })` is the whole of what server startup used to do at module scope:
constructs `Store`, `ModuleManager`, `ModuleHooks` and the rest from one directory, wires the event listeners
that turn a change into an activity-log line, starts that environment's own `ModuleHooks` 10-second poll, and
(for the default environment only) bootstraps the admin from `ADMIN_PASSWORD`. It returns a plain object
with one property per service. Nothing here is a Proxy -- these are the real instances.

Two things it does **not** build, because they are the host's, not any one environment's: the LiveKit
`RoomServiceClient` (one call service, shared -- see "LiveKit room names" below) and the Font Awesome Pro
override (`DATA_DIR/fontawesome-pro/`, a host-level admin asset the migration never moves).

`flushEnvironment(env)` writes the four things under the seam that only debounce rather than writing
synchronously on every change (`chatHistory`, `ai`, `geocodeCache`, the activity log). Called on process exit
(every built environment) and before a backup or a restore (that one environment, so nothing recent is missing
from the zip, or overwritten by a stale in-memory copy right after).

An environment's own name is its server name (the author's call). `environmentFor()` in `index.js` runs one
check every time it builds an environment, not just the first: still on the shipped sentinel default ("Coffee
Pub Tavern", from before an install's name was ever set, or before `serverName` existed at all) means the
default environment gets `PRODUCT_NAME` and a tenant gets `hostRegistry.findTenant(slug).name`, written with
`store.updateSettings`. The same check covers a brand new environment (still on the sentinel right after
`buildEnvironment`) and an old one catching up on its next start after skipping a few versions -- one code path,
not two.

## `server/index.js`: the Proxy and the door

```js
const envContext = new AsyncLocalStorage();
const environments = new Map(); // slug ('' for the default) -> a built environment

function proxyFor(name) {
  // every trap resolves envContext.getStore()[name] and, for a method, binds it to the real instance
}
const store = proxyFor('store');
const modules = proxyFor('modules');
// ...one per name buildEnvironment returns
```

`proxyFor` is generic: it works the same way for a class instance (`store`), a plain `Map` (`presence`), or an
`EventEmitter` (`inviteEvents`), because the only thing it does is forward every property access to
`envContext.getStore()[name]` and, when the value is a function, `.bind()` it to the real object first --
without the bind, `store.someMethod()` would call the method with `this` set to the Proxy, not the real `store`,
and it would break.

The "door" is one middleware, registered right after `express.json()`, before any route:

- **No `BASE_DOMAIN`:** `app.use((req, res, next) => envContext.run(environmentFor(''), next))`. Every request
  gets the one environment. This is the whole of the multi-tenant machinery's effect on a self-hosted install:
  one extra `AsyncLocalStorage.run` wrapping every request, resolving to the same environment every time.
- **`BASE_DOMAIN` set:** the hostname picks a branch -- `admin.<base>` dispatches to `hostRouter` (a separate
  `express.Router()`, never mounted on `app` directly, so a request there can never fall through to a route that
  needs an environment); the bare base domain serves `public/landing.html` for `/` and a short allowlist of other
  paths it needs (`/landing.css`, `/landing.js`, `/style.css`, `/theme.css`, `/img/site/icon`, `/favicon.ico`,
  `/fa/*`, `/assets/images/brand/*`, `/api/product`, `/api/product/environment`, `/api/product/environments`) -- no
  environment is ever resolved there, so `/theme.css` and `siteIcon` both fall back to "nothing set" when
  `envContext.getStore()` is empty, the same as any environment that has not set its own (for `siteIcon` that
  bundled default, and the one `/manifest.webmanifest` offers alongside any environment's own custom icon, is
  `public/assets/images/brand/brandmark-color.png` -- the one file a rebrand replaces, not a copy of it);
  `<slug>.<base>` resolves that tenant's environment the same way the no-base-domain case resolves the default
  one; anything else is a plain 404. A hostname matching `PREVIOUS_BASE_DOMAINS` 301s to the same path at the
  current base first. `PRODUCT_NAME` (default "Coffee Pub Magpie") and `CONTACT_EMAIL` (default none) are
  configuration, never code, since the product's own name is not settled yet -- `GET /api/product` (registered on
  both the main app and `hostRouter`, never behind a session) answers `{ name, contact, baseDomain, version }`
  wherever it is reached.

Two more pieces exist only to let the product page's own **Sign in** send someone to the right place, without the
host ever learning who anyone is (accounts live inside each environment, not in `host.json`):

- On every real tenant sign-in (`GET /j/:token`, `POST /api/login`, `POST /api/register`,
  `POST /api/invites/:token/accept` -- never the host admin's own `POST /api/host/login`), `setEnvHint(req, res)`
  sets a cookie `env_hint` on the parent `BASE_DOMAIN`: a comma-separated list of slugs, most recent first,
  deduplicated, capped at five, `Path=/`, `SameSite=Lax`, `Secure` when the request is, a year long, **not**
  `HttpOnly` (the page reads it with `document.cookie`). Never cleared on sign-out -- it is a hint, not a session,
  and it names no person. A no-op without `BASE_DOMAIN`.
- `GET /api/product/environment?slug=` (registered on both the main app and `hostRouter`, and in
  `BARE_BASE_PATHS`, so it answers at the bare base domain too) answers `{ slug, name }` for an `active` or
  `pastDue` tenant and a plain 404 for anything else -- unknown, suspended, or a slug that fails `cleanSlug`'s own
  shape check before it ever reaches the registry. Suspended and unknown look identical on purpose: a slug is
  already a public address (it is the tenant's own subdomain), so confirming one exists reveals nothing a browser
  couldn't already see by just visiting it.
- `GET /api/product/environments` (same registration pattern) answers `{ environments: [{ slug, name }] }` for
  the page's own dropdown: every `active` or `pastDue` tenant, sorted by name, suspended ones left out entirely
  (not even a slug -- unlike the single lookup above, there is no address a visitor already has here to confirm).
  `{ environments: [] }` when there is no `hostRegistry` at all.
- `POST /login` (form-encoded, `login`/`password`/`next`; each environment's own, registered on the main app like
  `POST /api/login`) is the page's actual sign-in: a top-level form post from `https://<slug>.<base>/login`, so
  the session cookie is set first-party with no cross-origin request involved. Same check as the JSON route
  (`store.userByLogin`, `auth.verifyPassword`, the environment's own `limiter`, a `LoginLimiter` shared with
  `POST /api/login` since it is the same `proxyFor('limiter')`), but a redirect instead of a JSON body: success
  sets the session and `env_hint` exactly as `POST /api/login` does, then `303`s to `next` when it is a path on
  this environment (`safeNextPath` requires a single leading `/` -- a second one, as in `//evil.com`, is a
  protocol-relative URL to a browser, not a path), `/` otherwise; blocked-by-the-limiter or a wrong login/password
  both `303` to `/login?error=1&login=<login>`, indistinguishable from each other, same as the JSON route's own
  single "wrong username or password".

Because `AsyncLocalStorage` context follows the real async causality chain (promises, `await`, timers,
`EventEmitter.emit`), a route handler can `await` anything, register a `setInterval`, or call `moduleBus.on(...)`
and the Proxy still resolves correctly inside all of it, with one exception below.

## The one gotcha: a callback that outlives the request

`envContext.run(env, callback)` only extends to work causally descended from `callback`. A request handler's own
synchronous body, and anything it directly awaits or schedules, is covered. `req.on('close', ...)` is not: the
underlying socket's `'close'` event is Node's own connection machinery, not something the handler's code
causally triggers, so whether it inherits the request's ALS context is not something to rely on.

The three SSE routes (`/api/notifications/stream`, `/api/modules/stream`, `/api/modules/:id/events`) and the
region-cut job stream all do the same small, explicit thing about it:

```js
app.get('/api/modules/stream', (req, res) => {
  const env = currentEnvironment(); // captured once, synchronously, while it is definitely correct
  // ...register listeners on the Proxy as normal; they resolve `env` correctly here...
  req.on('close', () => envContext.run(env, () => {
    // ...off() the same listeners...
  }));
});
```

Registering a listener (`moduleBus.on('event', onBus)`) is always safe without this -- that call happens
synchronously inside the handler, definitely inside the request's own context. It is only the *cleanup*, in a
callback Node schedules on its own, that needs the environment handed back to it explicitly. If you add a fourth
long-lived connection that registers listeners and cleans them up on `'close'`, copy this pattern.

## `server/host-registry.js`: the one thing that is never per-environment

`DATA_DIR/host.json` -- which tenants exist, their plans, the host admins -- is built once, only when
`BASE_DOMAIN` is set, and is never wrapped in the Proxy machinery above: it is the one piece of state that is
explicitly *not* scoped to an environment, by definition. A host admin's own session is a structurally identical
but entirely separate mechanism from a tenant's (`auth.HOST_COOKIE` instead of `auth.COOKIE`, `hostRegistry.
sessionSecret` instead of any tenant's `store.sessionSecret`, `hostRegistry.findAdminByKey` instead of any
tenant's `store.userByKey`) -- see `currentHostAdmin`/`requireHostAdmin` in `server/index.js`. The two cookies
can never be confused for one another even if somehow set on the same browser, because nothing ever reads one
where it expects the other.

The person running the whole deployment can still sign into any one environment, without a second account to
remember: `resolveLoginUser(login, password)` in `index.js`, used by both `POST /api/login` and the product
page's `POST /login`, checks the environment's own users first (as always) and only then, when that fails and
there is a host registry, `hostRegistry.findAdminByLogin`. A match there never touches that environment's own
data for the password: it only ensures a user record exists for that login (`hostAdmin: true`, `passwordHash`
always `null`, so nothing inside the environment can authenticate as it directly -- `PATCH /api/users/:key`
refuses a password change for one), created once and reused after. Gated on `(!user || user.hostAdmin)`, so a
login that already belongs to a *different*, ordinary user in that environment never matches the registry --
a name collision just means the host admin cannot sign in with that particular login there, never that they
take over someone else's account.

## LiveKit room names

One `RoomServiceClient`, shared by every environment (the plan's phase 4 territory is a per-tenant call-name
scheme and per-tenant concurrent-call limits; not built yet). `livekitRoomName()`/`roomIdOfLivekit()` already
prefix the room name with the current environment's own slug when one is resolved (`env.slug`, null for the
default environment), so two environments with the same `room` setting cannot collide in LiveKit today, even
before phase 4's fuller scheme.

## The console

`public/host.html` and `public/host.js`, served for `/` at `admin.<base>` by the host router and nowhere else. It is a page like Manage (the same panels, fields and buttons), with the primary nav's left zone only (`body.host-console` hides the middle and right zones: the console has no spaces to navigate to and no environment's profile or Manage to reach). It talks only to `/api/host/` through the shared `api()` helper, and reads nothing of an environment beyond the usage counts the API returns. A tenant's link in the list is `<slug>.<base>` with the page's own port appended only when there is one (development); a backup is fetched as a blob and offered as `<slug>-<date>.zip`; Delete arms on the first click and acts on the second. The console never learns the host admin's session beyond `GET /api/host/me` succeeding or not: signed out, it shows the sign-in panel and nothing else.

## The host's managed AI and shared files

Two things are the host's, above every environment, decided in the plan's "Managed AI" and "Shared files" sections.

- **Managed AI.** The host registry keeps one AI service per company (`host.json`'s `ai`: `openai`, `anthropic` and `compatible`, each with a model and a key, the last with an address), set on the console's Managed AI panel (`GET`/`PUT /api/host/ai` one company at a time, `POST /api/host/ai/models`, a key never in a view) or taken from `AI_OPENAI_KEY` and `AI_ANTHROPIC_KEY` when none is saved; a company with a key and no saved model uses the built-in default model for it (`DEFAULT_MODELS` in `server/ai.js`), so a key alone is enough. A company with a key (an address, for `compatible`) and a model is offered. Each environment's `Ai` is built with a `managed()` function that answers with the offered companies, and its own `ai.json` carries `source: 'managed' | 'custom'` and `managedProvider`: managed calls go out with that company's model and the host's key, custom ones with the environment's own; the enable step, the monthly allowance and the usage stay the environment's. A fresh environment starts managed on the first offered company. `AI_KEY` (with `AI_PROVIDER`, `AI_MODEL`, `AI_ADDRESS`) was the one-company form of this and still fills that company's slot; an `ai.json` that only ever worked through it becomes `managed` on first start and seeds that slot from its provider and model.
- **Shared files.** A `files` setting a module declares `"shared": "host"` (Maps' `map`) lives in `DATA_DIR/shared/<module>/<folder>/` for every environment, or in the module's own folder as before when there is no `BASE_DOMAIN`. The environment's settings view marks it `shared: true` and lists the host's files, its values answer every file, its file and region-cut routes refuse for that folder, and the host router carries the folder's own API (`/api/host/shared`, files, the region source address, the region cut). On the first start with `BASE_DOMAIN`, a missing shared folder takes the files of the one environment that has any.

The console page for both is `public/host.js` with the form and the region cut shared with the environment's pages (`public/ai-form.js`, `public/region-cut.js`), so a host admin and an environment admin see the same controls where they overlap.

## Adding a new module-level singleton

If you add a thirteenth thing like `store` -- built once from a data directory, read throughout the route
handlers by a bare name -- it needs the same three edits: construct it in `buildEnvironment` (using the real
instances already in scope there, not the Proxies), add its name to the object `buildEnvironment` returns, and
add a matching `const yourName = proxyFor('yourName');` near the others in `index.js`. If it needs flushing on
exit, add that to `flushEnvironment` too. If you wire an event listener on it at the point it is built (the
pattern every existing singleton with cross-singleton wiring uses), do that inside `buildEnvironment`, closing
over the real instances in that same call -- never at module scope in `index.js`, which now only runs once,
before any environment exists.
