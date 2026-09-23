# Tenants: one host, many environments

**Status:** decided September 23, 2026 (the shape, the seam, the URL, the roles, and the ten questions at the end, answered by the author); not started.

## What it is for

One deployment serving several paying groups, each with its own people, spaces, settings and modules, sold as an environment plus a set of modules, reached at its own address. And the same software still sold and given away as a self-hosted install, where there is one group and nobody thinks about tenants at all.

## The model

```
host                 the software, one deployment; run by the host admin
  tenant             one group: its own people, spaces, settings, module data, theme
    space            what exists today (a room)
      panes, modules, items
```

A tenant is three things, and a folder of spaces is not one:

- **Isolation.** A tenant's people, spaces, data, settings and module data never meet another's. The Lobby, "everyone's space", means everyone in this tenant.
- **Entitlement.** What a tenant may use is set above it (which modules, how many people, how much storage, how much AI); the tenant chooses within that and cannot widen it.
- **Delegation.** Someone inside the tenant runs it -- its name and icon, theme, spaces, members, which of the entitled modules are on, module settings -- and nothing outside it: the call service, the AI key, module installs, plans, other tenants.

## Decisions

**One store per tenant, not a tenant id on every record.** Each tenant is its own data directory (`DATA_DIR/tenants/<slug>/`: its own users, spaces, settings, module data, uploads), and a small host-level registry sits above them (`DATA_DIR/host.json`: the tenants, their slugs, their entitlements, the host admin). A request resolves its tenant once, at the door, and everything below runs exactly as today against "the server's" data: to the code under the seam, the tenant is the server. This is what keeps every module unchanged (storage scoped to server, space or person; "server" quietly means "the tenant") and what makes a missed filter impossible, since there is no filter to miss. The alternative, threading a tenant id through every query and every module key, touches every line and leaks data across customers the first time one is forgotten.

**The tenant is the subdomain.** `stayingblonde.<base domain>`. The base domain is configuration (`BASE_DOMAIN`), never code: `magpie.coffeepub.live`, `magpie.coffeepub.com`, or anything a self-hoster owns, and a wildcard certificate at the proxy covers every tenant. The hostname's first label picks the store; the paths under it stay what they are, the session cookie is scoped per subdomain by the browser for free, and nothing in the client (`/api/...`, `/modules/:id`, `/sdk/host.js`, the streams, the popout names, the browser's keys) learns a base path. A path form (`<base>/stayingblonde`) is a redirect to the subdomain, if wanted, never the address itself. A tenant's own domain (`plan.stayingblonde.com`) is a later option: a mapping in the registry from a hostname to a slug, and a certificate for it.

**No base domain, no tenants.** With `BASE_DOMAIN` unset the deployment is one tenant, the "default", at whatever hostname it has: today's install, unchanged, and the self-hosted product. Setting a base domain turns the seam on and asks for the slug the existing data becomes (see the decisions at the end); the data moves to that subdomain and nothing else changes. The same image serves both.

**Roles.** Two things sit above "user", and they are not the same thing (the visible words: an *environment*, run by its *owner*):

| Role | Scope | Who |
|---|---|---|
| host admin | the deployment | whoever runs the host; invisible to tenants; signs in at the host console, not inside any tenant |
| owner | one tenant | the customer: today's Manage, minus what is host-level (see below) |
| moderator | one space | unchanged: set on a person's profile for a space |
| user, guest | unchanged | |

"Moderator" keeps its space-level meaning; the tenant's runner is its **owner**, and a tenant may have more than one. What an owner sees of Manage: Server (the name, icon, sign-in text, sign-up, language, time and money), Theme, Spaces, Roles, Users, Modules (enable and configure among the entitled ones), About. What only the host admin sees: the call service, the AI service and its key, module installs and updates, the Font Awesome package, the tenants and their plans, the base domain.

**Entitlements are the host's, enforced at the seam.** A plan is a set of caps on the registry entry: the modules a tenant may enable (one installed set on the host, enabled per tenant), how many members, how much storage, how much AI (the key is the host's, the quota the tenant's), how many concurrent calls. An owner sees the caps and what is used; the server refuses past them with a plain message. Billing stays outside the app: a payment provider's hosted pages and a webhook that sets the plan on the registry entry, with a grace period before anything is turned off. The app never sees a card.

**Accounts are per tenant.** A person in two tenants has two accounts, as they would at two servers today. One identity across tenants (sign in once, choose the tenant) is a later step that the registry can carry; it must not be the first, since it is exactly the cross-tenant seam the store-per-tenant design keeps closed.

**The call service is shared, its spaces namespaced.** One LiveKit behind the host; a space's call name is prefixed with the tenant's slug so two tenants' lobbies never meet. Per-tenant concurrent-call limits come from the plan.

**Modules see nothing.** `host.info.context` stays as it is (`server` | `room` | `person`); a module never learns which tenant it runs in and cannot address another. The one thing a module page may want, the tenant's name for a title, is what "the server name" already is.

## Phases

1. **The seam.** The registry, the per-tenant store, the resolver at the door (hostname to store; the default tenant when there is no base domain), the host console at `admin.<base>` (create a tenant, set its slug and plan, see its use), and the migration that gives today's data its slug. Everything under the seam untouched.
2. **Roles.** The owner role and the host admin; Manage split into what an owner sees and what only the host sees; the host console's own sign-in.
3. **Entitlements.** The caps on the registry entry, enforced: modules, members, storage, AI, calls; what the owner sees of them.
4. **The call service.** Slug-prefixed call names; per-tenant call limits.
5. **Self-serve.** A tenant signing up at the base domain (a slug, an owner account, a plan), the payment provider's pages, the webhook, the grace period, and a tenant's export and deletion.

Phase 1 is the large one and it is plumbing at the door; the rest is policy on top.

## What the current design already gives

One store file per install, module data scoped to server, space or person, settings as one object, "no secrets in modules" (the AI key is above the seam by construction), the host not being the brand (the platform vocabulary has room for one more noun), and every module already blind to anything outside its own scope.

## Decided September 23, 2026 (the author, asked one by one)

- **The visible word for a tenant is "environment."** A customer buys an environment; the code says tenant and never shows it. The words for the tiers and the sign-up page follow from it ("your environment", "environment settings").
- **The person who runs one is its "owner."** More than one owner is allowed. "Moderator" keeps its space-level meaning.
- **Slugs** are letters, digits and hyphens, 3 to 30 characters, chosen once at sign-up and fixed; a change the host grants becomes a redirect from the old slug; `www`, `api`, `admin`, `host`, `mail` and the like are refused.
- **The host console is `admin.<base domain>`** with its own sign-in, and the host admin is a separate kind of account, a member of no tenant. A tenant can never see or reach the console. The bare base domain is the sign-up page.
- **Switching a base domain on names the existing data.** The switch asks for the slug the existing install becomes ("stayingblonde"), and the data moves to that subdomain; nothing is called "default" for longer than the migration takes.
- **Entitlements** are members as a count, storage as a size, AI as calls per month, calls as concurrent spaces in a call, and the module list. Over a cap, the one thing stops (no more invites, uploads or AI, with a plain message saying why) while everything else keeps running.
- **Billing** is a payment provider's hosted pages and its webhook, which sets the plan on the registry entry. A lapse marks the tenant past due for **14 days**, with a banner for owners, then degrades it to the free caps. Billing never deletes anything.
- **Backups are per tenant**: a tenant's directory is its backup; the host console backs up and restores one tenant; an owner can download their environment as a zip and ask for its deletion.
- **Email is the host's SMTP with the tenant's sender name** ("<Environment name> via <product>", replies to an owner); tenants set nothing up.
- **A tenant's own domain comes later, on the top plan**: a hostname-to-slug mapping in the registry, a CNAME at the base, a certificate the host obtains itself. Not in the first phases.

Nothing is left open for phase 1.

## Phase 1 in detail (September 23, 2026)

Built by two sessions at once against this contract: the server half (the registry, the store per environment, the resolver, the host API, the migration) and the console page (`public/host.html`, `public/host.js`).

**The seam in the server.** Everything under the seam is what runs today: `Store`, `ModuleManager`, `ChatHistory`, `ModuleSettings`, `Ai`, `RegionCutJobs` and the rest, each built from a data directory. Phase 1 builds them once per environment (`DATA_DIR/tenants/<slug>/` as that environment's data directory) and resolves the set for a request from the hostname at the door. Request handlers keep reading `store`, `modules` and the others by the names they use now: those names become request-scoped accessors (an `AsyncLocalStorage` context set by the resolver, with a proxy in front of each singleton name), so the body of a handler does not change. Work that runs outside a request (timers, schedules, the activity flush, the presence sweep, the streams) runs once per environment, from each environment's own services, not from a global. With no base domain there is exactly one environment and the accessors always find it: today's behaviour, unchanged.

**The registry.** `DATA_DIR/host.json`: `{ baseDomain, hostAdmins: [{ key, login, passwordHash }], tenants: [{ slug, name, createdAt, plan: { modules: [ids] | 'all', members, storageBytes, aiCallsPerMonth, calls }, status: 'active' | 'pastDue' | 'suspended', pastDueSince }] }`. The base domain comes from the environment (`BASE_DOMAIN`) and is mirrored here for the console to show; a change needs a restart.

**The resolver.** With `BASE_DOMAIN` set: the request's hostname is `admin.<base>` (the console and the host API), `<base>` (the sign-up page, phase 5; until then a page saying which environments exist is not shown, only a plain "this is the host" page), `<slug>.<base>` (that environment), or unknown (404, plain). Without it: every request is the one environment, whatever the hostname. The resolver never reads a path.

**Migration.** On first start with `BASE_DOMAIN` set and data at `DATA_DIR/app.json` (a pre-tenant install), the server refuses to start until told the slug: `MIGRATE_TENANT_SLUG=<slug>` in the environment for that one start moves the install (`app.json`, `modules/`, images, chat history, everything but `host.json` and `fontawesome-pro/`) to `DATA_DIR/tenants/<slug>/` and records the tenant in the registry with `plan: { modules: 'all' }` and no caps. Without `BASE_DOMAIN` nothing moves and the layout stays as it is; the same code reads either layout (a tenant's directory has the same shape as today's `DATA_DIR`).

**The host API** (all under `/api/host/`, served only at `admin.<base>`; 404 elsewhere; a host admin's own session cookie, `host_session`, never a tenant's):
- `POST /api/host/login { login, password }`, `POST /api/host/logout`, `GET /api/host/me`.
- `GET /api/host/tenants` -> `{ tenants: [{ slug, name, status, plan, createdAt, usage: { members, storageBytes, aiCallsThisMonth, spaces } }] }`.
- `POST /api/host/tenants { slug, name, owner: { login, displayName, password } }` creates the directory, the registry entry and the first owner (an admin of that environment, see phase 2).
- `PATCH /api/host/tenants/:slug { name?, plan?, status? }`.
- `DELETE /api/host/tenants/:slug` removes the registry entry and moves the directory to `DATA_DIR/tenants-deleted/<slug>-<timestamp>/` (never deletes it).
- `POST /api/host/tenants/:slug/backup` -> a zip of the directory; `POST /api/host/tenants/:slug/restore` with a zip.
- `GET /api/host/settings` -> `{ baseDomain, version, hostAdmins: [{ key, login }] }`; `POST /api/host/admins { login, password }`, `DELETE /api/host/admins/:key` (never the last).
- The first host admin: `HOST_ADMIN_LOGIN` and `HOST_ADMIN_PASSWORD` in the environment on a start where the registry has none, recorded then and not read again.

**The console** (`admin.<base>`, `public/host.html` + `public/host.js`, the primary nav only): sign in; the environments as a list (a slug, a name, a status, the plan's caps against the usage, a link to open it); create one (slug, name, the first owner); edit a plan; suspend and restore; backup; the host admins; the base domain and version. No tenant's data is shown beyond the counts.

**Previous base domains.** The product's name is not settled, so the base domain may change after environments exist, and every environment's address is `<slug>.<base>`. The registry keeps `previousBaseDomains: [...]` (set from `PREVIOUS_BASE_DOMAINS`, comma-separated): a request at `<slug>.<old base>` or `admin.<old base>` is redirected (301) to the same path at the current base, so a rename is "add the new domain, keep the old one answering" and no shared link, bookmark or installed app breaks. Part of phase 1, since it is a few lines in the resolver and the moment it is needed is the worst moment to add it.

**The product page.** The bare base domain serves `public/landing.html` (the product's one page: what it is, the modules, how an environment works, the plans' shapes, a way to ask for one) instead of a placeholder. The name, the contact address, the base domain and the version come from `GET /api/product` (public; `PRODUCT_NAME`, `CONTACT_EMAIL` on the container), so the page carries no name of its own while the product's is being chosen. Phase 5's sign-up replaces its "ask for an environment" with a form.

**Sign in from the product page.** The host never knows who a visitor is (accounts live inside each environment), so it remembers where they have been instead. When someone signs in at `<slug>.<base>`, that environment sets a cookie on the parent domain: name `env_hint`, value a comma-separated list of slugs, most recent first, at most five, `Domain=<base>`, `Path=/`, `SameSite=Lax`, `Secure` behind HTTPS, a year long, not HttpOnly (the page reads it), never cleared on sign-out (it is a hint, not a session; it names no person). The product page's **Sign in** is a list of the host's environments (`GET /api/product/environments`, public, `[{ slug, name }]` for the active and past-due ones; on a host run for a handful of groups, naming them is fine and is what the author asked for), with the one the cookie names first preselected, and a Go that sends to `https://<slug>.<base>/login`. `GET /api/product/environment?slug=` stays for a single lookup. Not a free-text box: a box reads as a username field, and a visitor typed their login into it. Choosing one reveals a login and a password on the same page, and signing in is a plain form post to `https://<slug>.<base>/login` (`login`, `password`, `next`): a top-level navigation, so the session cookie is first-party and nothing crosses origins. That environment answers a form-encoded `POST /login` by setting the session (and `env_hint`) and redirecting to `next` (a path on that environment, `/` by default), or, on a wrong password, redirecting to `/login?error=1&login=<login>` so its own sign-in page shows the message with the login filled in. JSON `POST /api/login` is unchanged. Without a base domain the page is not served, so nothing changes for a self-hosted install.

**Not in phase 1:** the owner role (phase 2; the first owner is made an admin of the environment for now), enforcing caps (phase 3; the plan is stored and shown), call-name prefixes (phase 4), sign-up and billing (phase 5).

## Progress (September 23, 2026): the server half is done

The seam, the registry, the resolver, the host API and the migration are built (`server/environment.js`,
`server/host-registry.js`, the changes to `server/index.js` and `server/auth.js`), and the mechanism is written
up for whoever touches it next in [architecture-tenants](../architecture/architecture-tenants.md). What is not
in this list is the console page itself (`public/host.html` + `public/host.js`), the other session's own half.

**The critical acceptance test -- no `BASE_DOMAIN`, nothing under the seam changed -- passed live, not just in
the unit tests:** a real server (`node server/index.js`, no `BASE_DOMAIN`), logged in, installed and enabled a
module, changed a setting, watched the resulting `event: settings` arrive live over `/api/modules/stream`,
confirmed the activity log and its debounced write to disk, all exactly as before.

**With `BASE_DOMAIN` set, verified live end to end:** `GET /api/host/me` at `admin.<base>` with no session
answers 401; logging in as the host admin (bootstrapped from `HOST_ADMIN_LOGIN`/`HOST_ADMIN_PASSWORD`) and back
out; creating a tenant with its first owner, who immediately signs in at `<slug>.<base>` with their own,
independent `Store` (a fresh Lobby, no data from any other environment); the bare base domain's placeholder page;
an unknown subdomain and an unrelated hostname both a plain 404; backing a tenant up to a zip and restoring it
(its environment rebuilds from the restored files on the next request); deleting a tenant (the registry entry
gone, the directory moved to `tenants-deleted/<slug>-<timestamp>/`, never deleted); a pre-tenant install refusing
to start without `MIGRATE_TENANT_SLUG` and migrating correctly with it (the original admin's password still
works, at the new subdomain, `host.json` recording `plan: { modules: 'all' }` with no caps); and the
`PREVIOUS_BASE_DOMAINS` redirect, for both `admin.<old base>` and `<slug>.<old base>`, path and query preserved.

One real bug the live testing caught and fixed: `zipFiles` (`server/module-build.js`) was not exported, so the
backup route 500'd on its first real call -- a stand-in test or a reading of the diff would not have caught it,
since the syntax and unit checks have no reason to call it. Fixed by adding it to that file's own exports.

One gap found and closed while building this: a `moduleSettings.on('change', ...)` listener that used to be
wired once, at module scope in `index.js`, would have kept running against whichever environment happened to be
current at the moment it fired rather than the one it was meant for -- moved into `buildEnvironment`, wired once
per environment on that environment's own real instance, the same as every other cross-singleton wiring already
was.
- The console (`public/host.html`) run against the real API on a base-domain server (`BASE_DOMAIN=localhost`, `.claude/launch.json` "host-browser"): sign-in, an environment created from the form with its first owner, who then signed in at `<slug>.localhost` as an admin of a fresh environment with its own Lobby; the plan edited, suspended and restored, backed up (a zip of four files), and deleted aside (its directory under `tenants-deleted/`), through the API the console calls; the previous-base-domain redirect keeping the path and query. Both the redirect and the console's links now carry the request's own port, which only matters in development (fixed the same day).
