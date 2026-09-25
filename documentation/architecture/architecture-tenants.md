# Tenants Architecture

**Audience:** developers changing `server/index.js`, `server/environment.js`, `server/host-registry.js`,
`server/migrate-names.js` or `server/studio-alias.js`, or adding a new module-level singleton to the server.

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
(for the default environment only) makes or resets the server's admin from `ADMIN_LOGIN` and `ADMIN_PASSWORD` (see "Roles" below). It returns a plain object
with one property per service. Nothing here is a Proxy -- these are the real instances.

Two things it does **not** build, because they are the host's, not any one environment's: the LiveKit
`RoomServiceClient` (one call service, shared -- see "Call names" below) and the Font Awesome Pro
override (`DATA_DIR/fontawesome-pro/`, a host-level admin asset the migration never moves).

`flushEnvironment(env)` writes the four things under the seam that only debounce rather than writing
synchronously on every change (`chatHistory`, `ai`, `geocodeCache`, the activity log). Called on process exit
(every built environment) and before a backup or a restore (that one environment, so nothing recent is missing
from the zip, or overwritten by a stale in-memory copy right after).

An environment's own name is its `environmentName` setting (the author's call; `serverName` before step 5a). `environmentFor()` in `index.js` runs one
check every time it builds an environment, not just the first: still on the shipped sentinel default ("Coffee
Pub Tavern", from before an install's name was ever set, or before the setting existed at all) means the
default environment gets `PRODUCT_NAME` and a hosted environment gets `hostRegistry.findEnvironment(slug).name`, written with
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
  gets the one environment. This is the whole of the several-environments machinery's effect on a self-hosted install:
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
  `<slug>.<base>` resolves that slug's environment the same way the no-base-domain case resolves the default
  one; anything else is a plain 404. A hostname matching `PREVIOUS_BASE_DOMAINS` 301s to the same path at the
  current base first. `PRODUCT_NAME` (default "Coffee Pub Magpie") and `CONTACT_EMAIL` (default none) are
  configuration, never code, since the product's own name is not settled yet -- `GET /api/product` (registered on
  both the main app and `hostRouter`, never behind a session) answers `{ name, contact, baseDomain, version }`
  wherever it is reached.

Two more pieces exist only to let the product page's own **Sign in** send someone to the right place, without the
host ever learning who anyone is (accounts live inside each environment, not in `host.json`):

- On every real sign-in to an environment (`GET /j/:token`, `POST /api/login`, `POST /api/register`,
  `POST /api/invites/:token/accept` -- never the host admin's own `POST /api/host/login`), `setEnvHint(req, res)`
  sets a cookie `env_hint` on the parent `BASE_DOMAIN`: a comma-separated list of slugs, most recent first,
  deduplicated, capped at five, `Path=/`, `SameSite=Lax`, `Secure` when the request is, a year long, **not**
  `HttpOnly` (the page reads it with `document.cookie`). Never cleared on sign-out -- it is a hint, not a session,
  and it names no person. A no-op without `BASE_DOMAIN`.
- `GET /api/product/environment?slug=` (registered on both the main app and `hostRouter`, and in
  `BARE_BASE_PATHS`, so it answers at the bare base domain too) answers `{ slug, name }` for an `active` or
  `pastDue` environment and a plain 404 for anything else -- unknown, suspended, or a slug that fails `cleanSlug`'s own
  shape check before it ever reaches the registry. Suspended and unknown look identical on purpose: a slug is
  already a public address (it is the environment's own subdomain), so confirming one exists reveals nothing a browser
  couldn't already see by just visiting it.
- `GET /api/product/environments` (same registration pattern) answers `{ environments: [{ slug, name }] }` for
  the page's own dropdown: every `active` or `pastDue` environment that is not refused (see "Refused environments"),
  sorted by name, suspended ones left out entirely
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

`DATA_DIR/host.json` -- which environments exist (its `environments` list), their plans, the host admins -- is built once, only when
`BASE_DOMAIN` is set, and is never wrapped in the Proxy machinery above: it is the one piece of state that is
explicitly *not* scoped to an environment, by definition. A host admin's own session is a structurally identical
but entirely separate mechanism from an environment's (`auth.HOST_COOKIE` instead of `auth.COOKIE`, `hostRegistry.
sessionSecret` instead of any environment's `store.sessionSecret`, `hostRegistry.findAdminByKey` instead of any
environment's `store.userByKey`) -- see `currentHostAdmin`/`requireHostAdmin` in `server/index.js`. The two cookies
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

## Call names

One `RoomServiceClient`, shared by every environment. Each space has its own call at LiveKit, and its name is
worked out, never stored (plan-names decision 14). `server/call-names.js` holds both directions: `callName()`
and `spaceIdOfCall()`, wrapped in `index.js` by `callName(spaceId)` and `spaceIdOfCall(name)` for the current
environment.

| Install | The Lobby | A space | An aside |
|---|---|---|---|
| Single environment | `lobby` | `<id>` | `aside-<id>` |
| Hosted | `<slug>.lobby` | `<slug>.<id>` | `<slug>.aside-<id>` |

No slug and no space or aside id can hold a dot, so the dot marks exactly where the slug ends and one
environment's call can never be read as another's. `spaceIdOfCall()` answers null for a call that is not this
environment's, which is what keeps another environment's calls out of this one's presence, its placement and
its calls cap.

For one release, `spaceIdOfCall()` also reads the names calls had before step 3, when they came from the stored
`settings.room`: `table` and `table-<id>` on a single install, `<slug>-table` and `<slug>-table-<id>` hosted. So
people already in a call when the server upgrades are still found, placed, muted and kicked in the call they are
really in, and the calls cap still counts them. An id this environment really has is read as itself first (a
space whose id is `table` is that space), a dotted name is never an old one, and when a longer slug of another
environment also matches (`acme-table-table` is environment `acme-table`'s old Lobby), the name is that
environment's. The old shapes go after that release, in step 10 at the latest. New tokens are only ever minted
for the new names.

## The console

`public/host.html` and `public/host.js`, served for `/` at `admin.<base>` by the host router and nowhere else. It is a page like Manage (the same panels, fields and buttons, and the same tab bar: Host, Plans, Environments, AI and Maps, Environments being the default, with the hash naming the tab), with the primary nav's left zone only (`body.host-console` hides the middle and right zones: the console has no spaces to navigate to and no environment's profile or Manage to reach). It talks only to `/api/host/` through the shared `api()` helper, and reads nothing of an environment beyond the usage counts the API returns. An environment's link in the list is `<slug>.<base>` with the page's own port appended only when there is one (development); a backup is fetched as a blob and offered as `<slug>-<date>.zip` (the server's own `Content-Disposition` name, `<slug>-backup.zip`, is not used); **Restore backup** opens a file picker, then arms as **Replace its data?** for eight seconds and posts the zip to `POST /api/host/environments/:slug/restore` on the second click (the chosen files are held in `restoreFiles`, by slug, and dropped whenever the list is drawn again), and focus returns to that card's **Restore backup** afterwards; Delete arms on the first click and acts on the second, and focus then goes to `#environments-status` (`tabindex="-1"`, `aria-live="polite"`), which says "<slug> moved aside (its data is kept under environments-deleted)."; **Suspend** reads **Resume** on a suspended environment. **Save plans** stops at the first field the browser's own validation refuses (a plan id of lower-case letters, digits and hyphens; a name that is not blank) and shows its message; the New environment form's slug is checked the same way. A card whose `refused` is set (see "Refused environments" below) shows the tag "won't open" (`data-status="refused"`), the reason ("Won't open: its data could not be read." for `unreadable`, with "Fix or restore this file (the server log names it), or restore a good backup."), the file and the time, what to do, and a dash for every usage count, and hides the owner's second-factor reset, which could not reach the environment. The console never learns the host admin's session beyond `GET /api/host/me` succeeding or not: signed out, it shows the sign-in panel and nothing else.

## The Names migration

`server/migrate-names.js` is the frame for [plan-names](../plans/plan-names.md)'s data migration: stored keys,
files and folders renamed from the old words to the new, one recorded part per step of that plan. Each step adds its part
to the end of `HOST_PARTS` or `ENVIRONMENT_PARTS`. `HOST_PARTS` holds `names-environment` (step 2, below);
`ENVIRONMENT_PARTS` holds `names-table` (step 3), `names-roles` (step 4), `names-spaces` (step 5a), `names-pointers` (step 5c), `names-objects` (step 7) and `names-asides` (step 8), all below.

- **Where it runs.** `buildEnvironment()` calls `migrateEnvironment(dataDir)` before `Store` reads `app.json`,
  so every service sees the data in its current shape, including an environment restored from an old backup.
  With `BASE_DOMAIN` set, `migrateHost(DATA_DIR)` runs once at startup, before `host.json` is read and before
  any environment is built; a single-environment install has no `host.json` and never runs it.
- **A part.** `{ id, files(dir), run(ctx) }`. `files()` answers the paths (from the directory) of the JSON
  files it will rewrite; `ctx` has `dir`, `copyRoot` (where this part's originals were copied), `read(rel)`,
  `write(rel, value)` and `move(fromRel, toRel)`. `write`
  refuses a path `files()` did not list, since only those were copied first. Writes and moves are staged and
  applied after `run` returns. A part must change nothing when run over data it has already changed.
- **The record.** Parts run in list order, and a part the record names never runs again. An environment's
  record is `app.json`: `version` goes from 1 to 2 (`NAMES_VERSION`) only when a part runs, and
  `migrations: [{ id, at, moved: [{ from, to }] }]` gains one entry per part. The host's is `host.json`'s
  `migrations`, with no `version`. `Store.load()` and `HostRegistry` keep `version` (when above 1) and
  `migrations` exactly as found, so the record survives every later save. A directory with no record yet is
  new: every due part is recorded as run with `moved: []`, since there is nothing old to rename.
- **The copy.** Before a part writes, every file it listed and the record file are copied to
  `<environment>/pre-names/<part>/`, keeping their paths; the host's go to `DATA_DIR/pre-names-host/<part>/`,
  which the pre-environment move (`migrateIfNeeded()`) leaves where it is. A copy already there, from an
  attempt that stopped part-way, is kept. Folders a part only moves are listed in `moved`, not copied.
- **The commit.** Everything is checked first: each value serialises, no write lands on a folder, no move's
  target exists or is shared. Each write goes to a `.names-tmp` file beside its target. Then the folders move,
  then the writes are renamed into place, the record last. A failed move puts back the moves already made and
  removes the staged files; a folder that cannot be put back is named in the error ("This folder was moved and
  could not be put back, so it is still at the new place: `<to>` (was `<from>`)."). A failed write names the
  part's own copy folder (`pre-names/<part>` or `pre-names-host/<part>`) as where the originals are. Either way
  there is no record entry, so the part runs again on the next start.
- **The moved-folders note.** Before each folder moves, the moves so far are written to
  `pre-names/<part>.moved.json` (the host's: `pre-names-host/<part>.moved.json`). When the part is recorded, the
  note is read back, keeping only moves that really happened (the folder gone from where it was and present
  where it went), merged with the attempt's own, and deleted. So a part stopped between two moves, by an error or
  by the process being killed, still records every folder it moved when it runs again.
- **The error.** Every failure is a `MigrationError` with `file` and `reason`: `newer` (the record names a
  part this server does not know), `unreadable` (the environment's data file cannot be read, below) or `failed`
  (a part could not finish). The newer check runs whether or not a part is due.
- **Data that cannot be read** (plan-names decision 23). Before anything else, `migrateEnvironment()` reads the
  environment's `app.json` (or `tavern.json` while `app.json` is missing) and refuses it as `unreadable` when it
  is there but cannot be read, is not valid JSON, or is valid JSON but not an object (a list, `null`, a number).
  Until step 3, `Store` read such a file as empty and its first save wrote a new `app.json` over it. `Store.load()`
  refuses it too now, with a `StoreError` (500), in case the file changed after the build. A missing file is a new
  environment and starts fresh. The log line names the file: `<file> is not valid JSON (...), so this environment
  will not be opened: nothing was changed. Fix or restore this file, then start again.`, or `<file> is not an
  environment's data (it holds a list, not an object), ...` with the same ending.

`tools/check-names.mjs` (in `npm run check`) holds the frame to this: `--migration` copies
`tools/fixtures/names-v1/` to the system's temporary folder and runs the frame twice over it with stand-in
parts and with the real ones, including runs killed part-way. Its other modes report the old names left in the
code, level by level (environment, table, role, space, canvas, module, object, aside); a level only reports
until its step switches it to fail. The environment level (`tenant`, `tenants`) fails, in code and in words,
from step 2. `--words` reports "room", "rooms" and "table" in what people read, and `--list[=level]` lists
every hit. The allow-list is `tools/check-names-allow.json`: `{ file, level, pattern, line?, reason }`, the
pattern tested against the hit's own name; an entry with no reason fails, `level: "*"` or a pattern that
matches anything is allowed only for one exact file or under `tools/fixtures/`, and unused entries are listed.

### The host's part: `names-environment`

The first real part, in `HOST_PARTS`, run by `migrateHost(DATA_DIR)` on a hosted server only (a
single-environment install runs no host part). It renames:

- `DATA_DIR/tenants/` to `DATA_DIR/environments/`, and `tenants-deleted/` to `environments-deleted/`;
- `host.json`'s `tenants` key to `environments`, in the same place among its keys, every other key untouched.

It is recorded in `host.json`'s `migrations` with
`moved: [{ from: "tenants", to: "environments" }, { from: "tenants-deleted", to: "environments-deleted" }]`
(only the folders that were there), and the original `host.json` is kept at
`DATA_DIR/pre-names-host/names-environment/host.json`. Over a host already in the new shape it changes
nothing. A `host.json` with no record yet (a brand-new host) records the part as run, moving nothing.

One refusal: a `host.json` with both `tenants` and a non-empty `environments` that differs from it stops the
start, since the part cannot tell which list to keep:

> The names migration part "names-environment" stopped at `<DATA_DIR>/host.json`: it lists environments under both "tenants" and "environments", and they differ,
> so it cannot tell which to keep. Nothing was changed: remove the out-of-date key from
> `<DATA_DIR>/host.json` and start again (a copy of the file as it was is in
> `<DATA_DIR>/pre-names-host/names-environment`).

An `environments` key that is empty or the same as `tenants` is replaced by `tenants`' list without a refusal.

### The first environment part: `names-table`

In `ENVIRONMENT_PARTS`, run by `migrateEnvironment()` on each environment's first build after the upgrade. It
removes `settings.tableName` (the call's old display name, "The Table") and `settings.room` (the call's old
base name, `table`) from `app.json`, keeping the other keys in their order, and replaces the Lobby's
description only when it is still exactly the old seed, "Everyone at the table.", with the new one, "Where
everyone meets." (an owner's own wording is left alone). `app.json` goes to `version: 2` and records the part;
the original is kept in `pre-names/names-table/app.json`. A new environment is seeded with "Where everyone
meets." and records the part as run. Over data with neither setting and no old description, it writes only the
record.

### The environment part: `names-roles`

Step 4's part, after `names-table`. In `app.json`:

- `users[].role`: `admin` becomes `owner` and `user` becomes `member`. An account with `hostAdmin: true` (the
  host admin's own account in that environment) becomes `admin`, always, even if an owner had changed its role
  before. So after the upgrade the host admin has every right in every environment.
- `settings.roles`: `user` becomes `member` (and a hand-made `admin` entry becomes `owner`). When both an old
  and a new key are there and differ, it stops with the same kind of sentence as the host part: `its
  settings.roles has both "user" and "member", and they differ, so it cannot tell which to keep. Nothing was
  changed: remove the out-of-date key from <file> and start again (a copy of the file as it was is in
  <copy>).`
- `invites[].role` values are renamed the same way.

The original is kept in `pre-names/names-roles/app.json`.

### The environment part: `names-spaces`

Step 5a's part, after `names-roles`. It renames an environment's stored data:

| Where | Old | New |
|---|---|---|
| `app.json` | `rooms`, `users[].rooms`, `invites[].rooms`, `settings.serverName` | `spaces`, `users[].spaces`, `invites[].spaces`, `settings.environmentName` |
| `chat.json` | `rooms` | `spaces` |
| `images/` | `images/rooms/`, `images/<key>/rooms/` | `images/spaces/`, `images/<key>/spaces/` |
| `modules/registry.json` | `allRooms`, `rooms` | `allSpaces`, `spaces` |
| `modules/settings.json` | `{ server, rooms, people }` | `{ environment, spaces, people }` |
| a module's data | `data/server.json`, `data/room-<id>.json` | `data/environment.json`, `data/space-<id>.json` (moved; pointers inside a module's own values wait for step 7) |
| a module's uploads | `uploads/server/`, `uploads/room-<id>/` | `uploads/environment/`, `uploads/space-<id>/` |
| `modules/links.json`, `bus.json` | scope keys and pointers (`server`, `room:<id>`, `scope: 'room'`, `room`) | `environment`, `space:<id>`, `scope: 'space'`, `space` |
| `modules/schedules.json` | `scopeKey`, `id`, `roomId`, `notify.to` | the same with the new scope names, and `spaceId` |
| `modules/notifications.json`, `activity.json` | scope `server`/`room`, `roomId` | `environment`/`space`, `spaceId` |

Where an old and a new key (or file) are both there and differ, it stops with the file named: "... Nothing was
changed: remove the out-of-date one and start again (...pre-names/names-spaces)". The JSON originals are kept
in `pre-names/names-spaces/`, and every folder and file it moves is listed in the record's `moved`.

### The environment part: `names-pointers`

Step 5c's part, after `names-spaces`. A module's pointers to other modules' items sit inside its own stored
values, where the host cannot read them by meaning, and since step 5c the SDK refuses a pointer with an old
scope. So this part rewrites, by shape and never by module, every `.json` file under `modules/<id>/data/` and
`modules/bus.json` (its events and its actions). A value with string `module`, `kind` and `id` and
`scope: 'server'` becomes `scope: 'environment'`; one with `scope: 'room'` and a string `room` becomes
`scope: 'space'` with `space`. Its other keys are kept, everything else is left as it is, and a file that is not
valid JSON is skipped. The originals are kept in `pre-names/names-pointers/`.

### The environment part: `names-objects`

Step 7's part moves and rewrites nothing: the host stores no summary (one is made on every request), the pointers
in `links.json`, `bus.json`, `schedules.json` and `notifications.json` keep their field names, an installed
module's `module.json` is never rewritten, and a module's own keys are its own to rename (with
`storage.renamed`, see [architecture-modules](architecture-modules.md)). It is recorded like every part, so data
from after step 7 is refused by a build from before it.

### The environment part: `names-asides`

Step 8's part rewrites `app.json` only. An aside used to be a row in `spaces` with `ephemeral: true`; now it is
its own record, `asides`. The old aside rows are dropped rather than moved: an aside lives only while someone is
in it, and anyone still in one when the server upgrades is back in a space after the page reloads. Every other
space loses `ephemeral`, `origin` and `private` (which every space carried as false, null and false), the rest of
the row and the order kept. An aside never had chat history, pictures, modules or settings, so nothing else
changes. Over data already in the new shape it writes nothing. The original `app.json` is kept in
`pre-names/names-asides/`.

### Bundled modules built for an older Magpie

Since step 5c a manifest in the old names can't run (see [architecture-modules](architecture-modules.md)). So,
on each start, `updateOutdatedBundled()` in `index.js` installs the new copy of each module that came with this
deployment (`source: "bundled"`) whose installed version is outdated, requirements first (Places before Maps),
keeping its on or off, its spaces and its data. A module that was on is turned back on only when what it newly
asks for widens nothing (`pendingWidensNothing()`: a new permission that is off for every role); anything else
waits for an owner's approval, as any update does. Each update logs one line, such as `Updated "polls" to
1.12.11: the version installed was built for an older Magpie.`; if turning it back on is refused, the line adds
"It is off for now: <reason>" rather than reporting a failed update. A failed install logs
`Could not update "<id>" ...`. Since step 7 the same start also updates every bundled module, outdated or not, to
the version the server ships whenever the update asks for nothing new to approve; one that asks for more waits for
an owner while the installed version keeps running. Uploaded modules are never touched. On a hosted server every startup line an
environment logs starts with `[<slug>] `.

### A pre-environment install

With `BASE_DOMAIN` set and data still at `DATA_DIR`'s own root (`app.json`, or `tavern.json` from before that
rename), `migrateIfNeeded()` refuses to start until told which environment the data becomes:

> BASE_DOMAIN is set and `<DATA_DIR>` is a single-environment install. Set MIGRATE_ENVIRONMENT_SLUG=`<slug>` for
> one start to move it to that environment, then remove it.

With `MIGRATE_ENVIRONMENT_SLUG` set, everything at the root except `host.json`, `fontawesome-pro`,
`environments`, `environments-deleted` and `pre-names-host` moves to `DATA_DIR/environments/<slug>/`, and the
environment is added to the registry. The old name, `MIGRATE_TENANT_SLUG`, is still read (the new name wins
when both are set) and logs one line to stderr on every start while it is set:
"MIGRATE_TENANT_SLUG is now MIGRATE_ENVIRONMENT_SLUG; the old name stops working in a later release." It goes
in step 10 of the plan.

## Roles

Inside an environment an account's `role` is `owner` or `member` (`ASSIGNABLE_ROLES` in `server/store.js`), and
`admin` only for the server's admin: the host admin's own account (`hostAdmin: true`) on a hosted server, or the
account `ADMIN_LOGIN` makes on a single install. `admin` is never given in Manage. `owner` and `admin` have every right, in the
host and in every module (`OWNER_RIGHTS`, `hasOwnerRights()`); routes that need it use `requireOwner`. The pages
show Owner, Member, Admin ("Admin: runs this server") and Host admin.

| Where | Refusal |
|---|---|
| An owner-only route, from a person who is not one | 403 `owners only` (a page: `Owners only.`) |
| `POST /api/users`, `PATCH /api/users/:key` with another role | 400 `role must be owner or member` |
| `PATCH /api/users/:key` changing the host admin's account's role | 400 `this account is the host admin's, so its role can't be changed here` |
| Any change to the single install's admin: role, login, password, personal link, deleting it | 400 `this account is the server's admin, so its role can't be changed here`, `this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here`, `this account is the server's admin, so it can't be removed here` |
| Resetting the single install's admin's two-step sign-in from Manage | 400 `this account is the server's admin: it recovers its two-step sign-in with ADMIN_PASSWORD and the lockout bypass, so it can't be reset here` |
| Changing your own role | 400 `you cannot demote yourself` |
| `PATCH /api/roles/owner` | 400 `the owner has every permission, so that role can't be changed` |
| `PATCH /api/roles/user` | 404 (it is `PATCH /api/roles/member` now) |
| Module settings of the environment, or of a space | 403 `only an owner changes the server's settings` / `only an owner or the room's moderators change its settings` |
| `POST /api/me/mfa/reset` or `/api/host/me/mfa/reset` while the lockout bypass is off | 403 `the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on` |

`GET /api/roles` answers the permissions keyed `owner`, `moderator`, `member` and `guest`. A module's context
(`GET /api/modules/:id/context`) gives `user.role` as `admin`, `owner`, `member` or `guest` (`viewer` on a keyed
page), and a module asks `host.can()` rather than reading the role; an owner has every module permission.

`ADMIN_LOGIN` and `ADMIN_PASSWORD` make the server's admin on every install, and reset its password on each
start when it differs (plan-names decision 7, amended):

- **Hosted:** the host admin (`host.json`); other host admins are untouched. `HOST_ADMIN_LOGIN` and
  `HOST_ADMIN_PASSWORD` are read as old names, with a line each start; if `ADMIN_PASSWORD` and
  `HOST_ADMIN_PASSWORD` differ, `ADMIN_PASSWORD` wins with a warning. `ADMIN_USER`, `ADMIN_KEY` and
  `TAVERN_ADMIN_*` are ignored there, with one line.
- **Single install:** `buildEnvironment()` makes the default environment's admin: role `admin`, every right, not
  an owner (`store.setServerAdmin()`, `store.serverAdmins()`). It is locked, per the table above. An account
  already under that login (an owner, after step 4) becomes the admin again. There is no "keep at least one
  owner": an environment may have none.
- **No `ADMIN_PASSWORD`:** a brand-new install with no accounts gets an admin (`ADMIN_LOGIN`, default `admin`)
  with a random password logged once; an install with accounts gets nothing made and nobody promoted, and the
  log says "This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one."
- **Old names:** `ADMIN_USER` and `TAVERN_ADMIN_USER` are read as `ADMIN_LOGIN`, `TAVERN_ADMIN_PASSWORD` and
  `TAVERN_ADMIN_KEY` as `ADMIN_PASSWORD`, each logging "`<old>` is now `<new>`; the old name stops working in a
  later release." `ADMIN_KEY`, the pre-account password, is still accepted, without a line. `OWNER_PASSWORD`
  (step 4) is ignored: "OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's
  admin."
- **The pre-environment move** makes the install's admin the new environment's owner.
  Its encrypted secrets (the AI key and two-step sign-in) are re-encrypted from the install's own key to the
  host's, so they keep working; the start logs "Moved <n> encrypted secret(s) of <where> (the AI key, two-step
  sign-in) to the host's key." A secret that can't be read with the install's key is left as it was and logged,
  and if the install's key file itself can't be read, the start logs that the AI key and two-step secrets need
  setting again. The host's managed AI keys in `host.json` are encrypted too.

The lockout bypass (`ADMIN_MFA_LOCKOUT_BYPASS`) covers owners and the server's admin, and the start logs "The
lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: every owner and the server's admin skips two-step sign-in
entirely. Turn it off once you are back in." (on a hosted server: "every owner and host admin"). `PORT=0` picks
a free port, and the start logs the real one.

## The host API: environments

Served only at `admin.<base>` by `hostRouter`; the same paths reached from an environment's own host answer
404. Every route but billing needs a host admin's session and answers 401 `{ error: "sign in first" }` without
one. The old `/api/host/tenants...` paths are gone and answer 404; there is no alias.

| Route | Answer |
|---|---|
| `GET /api/host/environments` | `{ environments: [{ ...the registry record, usage: { members, storageBytes, aiCallsThisMonth, spaces }, refused, template }] }`, `template` being `{ id, name, source, version, appliedVersion, appliedAt, offerOpen, skipped: [{ id, name, why }] }` or null, read from the environment itself (see "Templates"); every field is present even for an environment that isn't open |
| `GET /api/host/settings` | `{ baseDomain, version, hostAdmins, productName, contactEmail, plans, signup, billingSecretSet, modules }`; `modules` is `[{ id, name, icon }]`, the conference and the chat first, then the bundled modules by id, for the template editor |
| `GET /api/host/templates` | `{ templates: [{ id, name, description, source, version, hidden, usedBy: [slugs] }] }`, every template the host can see (see "Templates") |
| `GET /api/host/templates/:id` | `{ template }`, the template in full, with `source`, `version`, `hidden`, `createdAt` and `updatedAt`; 404 `There is no template called <id>.` |
| `POST /api/host/templates` `{ ...the template's fields }` | 201 `{ template }`, saved as version 1, not hidden; 400 `{ error, problems }` (the first problem, then every one); 409 `There is already a template called <id>.` |
| `PATCH /api/host/templates/:id` `{ ...fields?, hidden? }` | `{ template }`. Any field raises `version` by one and reaches every environment using it at once (its live part); a field sent as `null` is removed; `id`, `version` and the dates are ignored. `{ hidden }` alone hides or shows it, with no new version. 400 `hidden must be true or false.` or `{ error, problems }`; 403 `Bundled templates can't be edited; export one to start your own.`; 404 as above |
| `DELETE /api/host/templates/:id` | `{ ok: true }`; 403 `Bundled templates can't be deleted.`; 409 `Environments use this template: <names>. Hide it instead.` (the environment word is the host's); 404 as above |
| `GET /api/host/templates/:id/export` | the template file (`Content-Disposition` `<name>.magpie-template.json`), bundled ones included; 404 as above |
| `POST /api/host/templates/import[?id=<new id>]`, the file's text as the body (any content type) | 201 `{ template, dropped }`, keeping the file's `version`; `?id=` saves it under another id. 400 `That isn't a Magpie template file.`, `This template was made by a newer version of Magpie.` or `{ error, problems }`; 409 `There is already a template called <id>.`; 403 from another origin with a cookie (`sameOriginOnly`) |
| `POST /api/host/environments` `{ slug, name, plan?, template?, owner?: { login, displayName, password } }` | 201 `{ environment }`; 409 `"<slug>" is already in use`; a bad slug answers `cleanSlug`'s own error; 400 `There is no template called <id>.` or `A template is named by its id, such as travel.` |
| `PATCH /api/host/environments/:slug` `{ name?, plan?, status?, template? }` | `{ environment }`; 404 `no such environment`; 400 for a status not in the list. With `template` (an id, or `"none"`) it switches the environment's template, building the environment if it isn't built yet, and `environment` also carries `template` and `offer` (see "Templates"); 400 `There is no template called <id>.` or `A template is named by its id, or "none" for no template.` |
| `GET /api/host/environments/:slug/template` | `{ template, offer, choices }`, as the owner's `GET /api/environment/template`; read-only; 404 `no such environment` |
| `POST /api/host/environments/:slug/template/apply` `{ modules?, lobby?, spaceDefaults?, reactions?, theme?, iconSet? }` | `{ environment }` with `template` and `offer`; the same body and refusals as the owner's apply; 404 `no such environment` |
| `DELETE /api/host/environments/:slug` | `{ ok: true }`, the data moved to `DATA_DIR/environments-deleted/<slug>-<ms>/`, never removed; 404 `no such environment` |
| `POST /api/host/environments/:slug/backup` | the environment's folder as a zip (`Content-Disposition` `<slug>-backup.zip`); 404 `no such environment` |
| `POST /api/host/environments/:slug/restore` | see "Refused environments", Restore |
| `DELETE /api/host/environments/:slug/owners/:login/mfa` | `{ ok: true }`; 404 `no such environment` or `no owner with that login there` |
| `POST /api/host/billing` `{ slug, plan, event }` | `{ environment }` (was `{ tenant }`); no session, a signature: 401 `bad signature`, 404 when `BILLING_SECRET` is not set |

## Refused environments

Data that records a migration part this server does not know is from a newer Magpie, and is refused rather
than read in a shape this server does not understand (plan-names decision 22).

- **At startup, when nothing else can run.** An unknown part in `host.json`, or in the one environment of a
  single-environment install, logs one line and exits with code 1; so does an unreadable `app.json` on a single
  install (see "Data that cannot be read" above). For an unknown part, the line names the file and the part:
  `<file> records the migration part "<id>", which this version of Magpie does not know: this data is from a
  newer version of Magpie, so it will not be opened here.`
- **On a hosted server, one environment.** `buildAtStartup()` in `index.js` skips an environment whose build
  throws a `MigrationError`; the others and the console keep running. `environmentFor()` keeps the refusal in
  `refusals` (by slug: `reason`, `file` relative to `DATA_DIR`, such as `environments/beta/app.json`, the full `message`, the sentence, `at`), logs
  the message once per refusal, and tries to build again on every request, so a fixed or restored environment
  opens without a restart. The log line for a skipped environment adds "This environment is skipped and answers 503
  until its data is restored or fixed; the others run as usual." Until it builds, the error handler answers 503 with
  `{ error: "This environment's data is from a newer version of Magpie." }` (`newer`),
  `{ error: "This environment's data could not be read. The host admin has been told." }` (`unreadable`) or
  `{ error: "This environment's data could not be updated. The host admin has been told." }` (`failed`), or a
  plain HTML page with the same sentence for a browser asking for a page. The file and the detail go to the log
  and the console only. A refused environment is left out of `GET /api/product/environments`, and the console's
  map-region search skips it.
- **The console's list.** `GET /api/host/environments` gives each environment
  `refused: null | { reason: 'newer' | 'unreadable' | 'failed', file, message, at }`, and every `usage` count is `null` while
  it is refused.
- **Restore.** `POST /api/host/environments/:slug/restore` checks the zip before touching anything: when the
  `app.json` or `tavern.json` that would land (names normalised, the last of a repeated entry) records an
  unknown part, it answers 400 `{ error: "This backup is from a newer version of Magpie." }` and the
  environment is unchanged. Otherwise it replaces the environment's folder, builds it at once, and answers
  `{ ok: true }`, or `{ ok: true, refused: { reason, file, message, at } }` when the restored data is itself
  refused. A backup whose `app.json` (or `tavern.json`, when there is no `app.json`) is not valid JSON or not an
  object is refused the same way, before anything is replaced: 400
  `{ error: "This backup's data can't be read, so nothing was restored." }` (`UNREADABLE_BACKUP`). The other
  answers are as before: 404 `no such environment`, 400 `choose a zip file to restore`, and
  400 with the zip reader's message.

## Templates

A template sets an environment up for one use when it is made (plan-environment-templates; the owner's view is
[userguide-templates](../userguides/userguide-templates.md)). It is data, not code: `templates/<id>.json` at the
repository's root (the Dockerfile copies `templates/`), the host's own and a single install's imported ones, all
read and checked by `server/templates.js`. Nothing in the code knows which template names which module.

**Where templates come from** (addendum 2, GitHub #68). `templateCatalog()` in `server/index.js` gathers them, each
with a `source`:

- `bundled`: `templates/<id>.json`, read-only, released with the image.
- `host`: `host.json`'s `templates: [{ ...the template, version, hidden, createdAt, updatedAt }]`, made, edited and
  imported on the host console (`HostRegistry#putTemplate`, `#removeTemplate`). Only on a hosted server.
- `imported`: a single install's `app.json` `templates: [...]`, from files its owner imports, so a backup carries
  them (`Store#putImportedTemplate`, `#removeImportedTemplate`). Only without `BASE_DOMAIN`.

Ids are unique across them: a new or imported template with a taken id is refused with 409. A host or imported
template that has a bundled template's id keeps it, and that bundled one isn't offered on that server (logged once),
so an environment's template never changes under it. A stored template that fails its check is left out with a log
line.

**The file.** `{ id, name, description, version?, words, icons: { home }, moduleNames, moduleIcons, modules, settings,
lobby: { name, description }, spaceDefaults: { profile }, reactions?, theme?, iconSet? }`, the same shape and checks
for every source. `words` covers only the ten changeable keys (never `host` or
`admin`), in the form Manage takes. `icons.home` and `moduleIcons` must be plain solid Font Awesome Free icons.
`modules` lists module ids, bundled or built in, and must include `chat`. `settings` takes only `language`,
`clock`, `currency`, `loginText`, `allowRegistration`, `mfaRequired`, `maxQuality`, `allowScreenShare`,
`allowAsides`, `allowPrivate`, `allowReactions`, `activeThemeId` and `themeMode`. `spaceDefaults.profile` is
`roleplaying`, `participants` or `characters`. The fields added by addendum 2:

- `version`: a whole number, 1 or more (a bundled file without one is 1). A host template's counts up on every
  edit; an imported one keeps the file's.
- `reactions`: `[{ id?, glyph, label? }]`, at most 30, a glyph of 1 to 8 characters and a label of at most 40, then
  cleaned by `cleanReactions`.
- `theme`: an embedded theme in the theme file's shape, `{ name, author?, light, dark }` without `magpieTheme`,
  checked as a theme import is (`server/theme-file.js`).
- `iconSet`: at most 60 Font Awesome Free solid names, none twice, for the environment's icon list. It is separate
  from `icons`, which stays `{ home }`.

Every bundled file is checked when the server starts, and an invalid one stops the start with a line naming each
problem; a host template and an import are checked before they are saved. `tools/check-templates.mjs` (in `npm run
check`) checks the same.

**A bundled template's version is raised by hand** when its applied-once part (modules, settings, Lobby, space
defaults, reactions, icon set or theme) changes; a change to its words or icons alone needs none, since those are
live. `tools/template-versions.json` keeps each bundled template's version beside a fingerprint of that part
(`templates.appliedOnceFingerprint()`), and `check-templates` fails when the part changed but the version didn't, or
when either is new and not recorded. After raising `version`, record it with
`node tools/check-templates.mjs --update`.

**Picked at creation.** When an environment is made: `POST /api/host/environments` `{ template }`, the product
page's `POST /api/product/signup` `{ template }` (`GET /api/product` lists `templates`), or `TEMPLATE=<id>` on a
single install's new data folder. `TEMPLATE` on existing data, or on a hosted server, is ignored with a log line;
an unknown id stops the start with a line listing the templates there are. It can be switched later (below).

**Applied once, then the owner's.** Its settings, its modules (turned on, and on in every space), the Lobby's name
and description, `spaceDefaults`, its reactions (they become the environment's list), its icon set (added to the
icon list, never removing one) and its theme are applied when the environment is made. The theme is added as a new
theme ("Name (2)" on a clash, never overwriting) and made active; a theme with the very same colors already there is
made active instead of added again. It is all recorded in `app.json`'s `template`: `{ id, appliedAt,
appliedVersion, applied, switchedAt?, skipped: [{ id, why }] }`. `applied` holds a fingerprint of each applied-once
part (`modules`, `reactions`, `theme`, `iconSet`, `lobby`, `spaceDefaults`; `templates.partFingerprints()`) as it
was when last applied or passed over. A record from before versions reads as `appliedVersion` 1. A module is skipped when the plan doesn't include it, when it needs a skipped one,
or (Research) until the AI service is on; the console card and Manage's **Template** tab list them. Its modules go
on in every space they may be in, which leaves the Lobby out for a module not made for it (plan-modules, "the Lobby
is for being together"). A backup carries the record, and a restore brings it back. The view the pages get
(`templateView()` in `server/index.js`) is `{ id, name, source, version, appliedVersion, appliedAt, offerOpen,
skipped: [{ id, name, why }] }`; `source` is `bundled`, `host` or `imported`, or null when this server doesn't have
the template.

**Followed live.** Its words, home icon and module display names and icons are read from the template on
every build, and a host template's edit reaches every built environment using it at once (`refreshTemplateLive()`), as the layer between the default and the owner's own: an owner's change wins, and a reset goes
back to the template's. `GET` and `PATCH /api/settings` give the owner `template`, `ownHomeIcon`, `templateWords`,
`templateHomeIcon` and `spaceDefaults`; `PATCH` takes `homeIcon: null` (back to the template's) and
`spaceDefaults: { profile } | null` (400 `spaceDefaults takes only profile.` or `profile must be roleplaying,
participants or characters`). `GET /api/modules` adds `templateDisplayName` and `templateDisplayIcon`.
`settings.homeIcon` is stored only when an owner picks one (null otherwise, so the template's shows, else the
default). Environments made before this stored the default `couch` as if chosen; the first start clears a stored
`couch` once and sets `homeIconChoiceSeeded`, so an owner who picks it from then on keeps it.

**Switched later** (plan-environment-templates, "Addendum: switching a template", GitHub #59). An owner or the
host can switch an environment to another template, or to none. `switchTemplate()` in `server/index.js` waits for
a creation-time template to finish applying, then replaces the record with `{ id, appliedAt: null, switchedAt,
skipped: [] }` (none removes it), runs `templates.useLive()` against the new template and adds its icons to the
icon list (`templates.addIcons()`), and follows the registry entry on a hosted server. Words, the home icon and
module display names and icons change at once; the owner's own still win. Nothing is turned off and no data is
touched. A record with `switchedAt` is never applied on its own at the next start, the way a creation-time one
is. Each switch adds `{ from, to, at, by }` (`by`: the owner's key or `host`) to `app.json`'s `templateHistory`,
kept to the last 20 and not shown to owners. Switching to the template already in use changes nothing.

**The offer.** A template's once-only part is an offer (`offerOpen: true`) after a switch, until it is applied, and
when the template's `version` is above the record's `appliedVersion` (`offerIsOpen()`). For an environment that isn't open (the console's list), `offerOpen` is read from the stored record alone: a newer version counts only if a part it applies once changed since it was applied (`templates.appliedPartsChanged()`), so it can over-report a part the environment already has until the environment is opened. An update offers only the
parts whose fingerprint differs from the record's `applied`, so a part the template didn't change is never offered
again, whatever the owner did with it since; a record without `applied` (a switch, or one from before) is compared
with the environment as it is. A newer version with nothing to offer (it changed only live parts) opens no offer.
`templates.offerFor()`: `{ modules: [{ id, name, allowed, why? }], lobby: { name, description } | null,
spaceDefaults: { profile } | null, reactions: [{ id, glyph, label }] | null, theme: { name, author? } | null,
iconSet: [names] | null }`. `modules` holds each module the template lists (with what it requires) that
isn't already on in every space it may be in, `allowed: false` with `why: "not in the plan"` when the plan leaves
it out, and the conference when listed and off. `lobby` is the template's Lobby name and description when they
differ from the Lobby's, `spaceDefaults` its new-space profile when it differs, `reactions` the template's list when
it differs from the environment's (it replaces them), `theme` the template's theme unless it is already the active
one, and `iconSet` the names missing from the icon list. `templates.applyOffer()` applies only what is confirmed:
the ticked modules (installed if needed, enabled, `allSpaces`), and the Lobby, the profile, the reactions, the theme
and the icon set only when `true`; it never turns anything off. Applying, even with nothing ticked, writes
`appliedAt`, `appliedVersion`, `applied` (every part, applied or passed over) and `skipped` (every refused module,
and any confirmed one that couldn't be turned on), so the offer closes. The template's settings are never offered.

**Hidden and deleted.** A host template can be hidden (`PATCH { hidden: true }`): it is left out of the create
form, sign-up (`GET /api/product`) and every switch's choices, and an environment using it keeps it and still sees
it among its own choices. Deleting a host template answers 409 while any environment's registry entry names it; a
bundled one can't be edited or deleted (403). A single install's owner can delete an imported template only when
the environment doesn't use it.

**Template files** (`server/template-file.js`). `<name>.magpie-template.json`, at most 64 KB:

```json
{
  "magpieTemplate": 1,
  "id": "harbour", "name": "Harbour", "description": "...", "version": 3,
  "words": {}, "icons": { "home": "anchor" }, "iconSet": ["anchor", "ship"],
  "moduleNames": {}, "moduleIcons": {}, "modules": ["chat", "conference"],
  "settings": {}, "lobby": {}, "spaceDefaults": {},
  "reactions": [{ "id": "wave", "glyph": "...", "label": "Wave" }],
  "theme": { "name": "Harbour", "author": "Thomas", "light": { }, "dark": null }
}
```

`templateToFile()` writes every field the template has (a part it lacks is left out), the theme in the theme file's
shape without its `magpieTheme`. `readTemplateFile()` refuses, in order: over 64 KB, not JSON, not an object, or
`magpieTemplate` missing or not a whole number ("That isn't a Magpie template file."); a newer `magpieTemplate`
("This template was made by a newer version of Magpie."); then the template's own check (the first problem is the
error, `problems` lists every one). Unknown keys, at the top level and inside the theme and its sets, are dropped
and listed in `dropped` (`plan`, `theme.glow`, `theme.light.shine`). An import keeps the file's `version`. Any
template can be exported, a bundled one included, so a host can start its own from it.

**Who may export and import.** The host admin exports and imports any template on the console (the host routes in
"The host API: environments"). A single install's owner imports, exports any template it can see, and deletes
imported ones. On a hosted server an owner may only export the template their environment uses, read-only, so they
can take it to a single install; import and delete answer 403 `On a hosted server, the host manages templates.`
Both imports sit behind `sameOriginOnly`.

| Route (owner) | Answer |
|---|---|
| `PATCH /api/settings` `{ template: "<id>" \| "none", ...settings? }` | `{ settings, template, offer }`; any other fields save as before. 400 `There is no template called <id>.` or `A template is named by its id, or "none" for no template.` |
| `GET /api/environment/template` | `{ template, offer, choices }`: the view above (or null), the open offer (or null), and each template the environment can see that isn't hidden (plus the one it uses) as `{ id, name, description, source, version, hidden }` |
| `POST /api/environment/template/apply` `{ modules?: [ids], lobby?, spaceDefaults?, reactions?, theme?, iconSet?: boolean }` | `{ template, offer }`; ids not in the offer are ignored. 400 `Name the modules to turn on as a list of their ids.` or `<key> must be true or false.`; 409 `This environment has no template to apply.`, `This template has already been applied.` or `This server doesn't have the "<id>" template any more.` (the module and environment words are the environment's own) |

| `POST /api/templates/import[?id=<new id>]`, the file's text as the body | Single install only. 201 `{ template, dropped }`; 400 and 409 as the host's import; 403 `On a hosted server, the host manages templates.` |
| `GET /api/templates/:id/export` | The template file, for any template the environment can see; on a hosted server only the one it uses, else 403 `On a hosted server, the host manages templates.`; 404 `There is no template called <id>.` |
| `DELETE /api/templates/:id` | Single install only. `{ ok: true }`; 403 `Bundled templates can't be deleted.` or the hosted refusal; 404 as above; 409 `This environment uses this template. Switch to another one first.` (the environment's own word) |

`tools/check-template-switch.mjs` (in `npm run check`) covers switching, the offer and applying it, host templates
(made, used, edited, hidden, refused deletion, exported and imported) and a single install's imports.
`tools/check-templates.mjs` covers the new fields, template files, the update offer and the bundled versions.

## The Studio alias

`server/studio-alias.js` is where the old names Coffee Pub Studio still reads are added back while the code
moves to the new ones (plan-names, "What Studio reads" and decision 21). `GET /api/me` and `GET /api/status`
pass their answer through `studioAlias.me()` and `studioAlias.status()`, which change it only when a bearer
token actually signed the request in, the way Studio signs in; the pages use the cookie and never see an old
name. Each entry in `ME` or `STATUS` answers the extra fields to add, and receives only
`{ role, hostAdmin, environmentName }` or `{ environmentName, asideName }`, never the account record. What it adds now:

- `tableName` in both answers, set to the environment's name (step 3), since `branding()` no longer sends it.
- The old role values (step 4): `user.role` in `/api/me` and `users[].role` in `/api/status` are `admin` for an
  owner or the server's admin and `user` for a member. `streamKey` needs no entry: the server sends it to
  owners and the host admin already.
- The old space names (step 5a): `serverName` in both answers, set to the environment's name; and in
  `/api/status`, `rooms` (the `spaces` rows), `activeRoom` (= `activeSpace`) and
  `users[].online.room` (= `users[].online.space`).
- The aside rows (step 8): asides are their own record now, but Studio still finds them in `rooms`, marked
  `ephemeral: true`. Each aside is added to `rooms` after the spaces, in the shape such a row had (its id,
  members, origin, private and createdAt, the other space fields at the values an aside row always had), named
  with the environment's word for an aside ("Aside" unless the template renames it). The space rows in `rooms`
  carry `ephemeral: false`, `origin: null` and `private: false`, as before. `STATUS` entries receive
  `{ environmentName, asideName }`.

Since step 5c the pages' own answers use `isOwner`, `ownerOnline` and, on the aside pull topic, `byOwner`. The later steps add the fields they rename, and step 10 removes the file.

## The host's managed AI and shared files

Two things are the host's, above every environment, decided in the plan's "Managed AI" and "Shared files" sections.

- **Managed AI.** The host registry keeps one AI service per company (`host.json`'s `ai`: `openai`, `anthropic` and `compatible`, each with a model and a key, the last with an address), set on the console's Managed AI panel (`GET`/`PUT /api/host/ai` one company at a time, `POST /api/host/ai/models`, a key never in a view) or taken from `AI_OPENAI_KEY` and `AI_ANTHROPIC_KEY` when none is saved; a company with a key and no saved model uses the built-in default model for it (`DEFAULT_MODELS` in `server/ai.js`), so a key alone is enough. A company with a key (an address, for `compatible`) and a model is offered. Each environment's `Ai` is built with a `managed()` function that answers with the offered companies, and its own `ai.json` carries `source: 'managed' | 'custom'` and `managedProvider`: managed calls go out with that company's model and the host's key, custom ones with the environment's own; the enable step, the monthly allowance and the usage stay the environment's. A fresh environment starts managed on the first offered company. `AI_KEY` (with `AI_PROVIDER`, `AI_MODEL`, `AI_ADDRESS`) was the one-company form of this and still fills that company's slot; an `ai.json` that only ever worked through it becomes `managed` on first start and seeds that slot from its provider and model.
- **Shared files.** A `files` setting a module declares `"shared": "host"` (Maps' `map`) lives in `DATA_DIR/shared/<module>/<folder>/` for every environment, or in the module's own folder as before when there is no `BASE_DOMAIN`. The environment's settings view marks it `shared: true` and lists the host's files, its values answer every file, its file and region-cut routes refuse for that folder, and the host router carries the folder's own API (`/api/host/shared`, files, the region source address, the region cut). On the first start with `BASE_DOMAIN`, a missing shared folder takes the files of the one environment that has any.

The console page for both is `public/host.js` with the form and the region cut shared with the environment's pages (`public/ai-form.js`, `public/region-cut.js`), so a host admin and an environment admin see the same controls where they overlap.

## Phases 2 to 5: the owner, the caps, the calls, self-serve and billing

Built to the contract in plan-tenants.md, "Phases 2 to 5 in detail". The owner is the environment's `owner` role (see "Roles" below; before step 4 it was `admin`, shown as Owner only on a hosted server), and the host's own cross sign-in (`environment.hostAdmin`) is the one viewer who still sees the host-only controls on Manage (uploading a module zip, running a module in the page). `GET /api/environment` gives an owner the plan and the usage; the caps are enforced at the seam, one thing at a time, with a 403 and a sentence: members on account creation, registration and invites; storage on uploads and pictures (the environment's directory measured at most once a minute and cached on the registry entry); assistant calls on `host.ai.ask` (counted per month on the entry); the module list on install and enable; calls at once on the join that would start a call (LiveKit's rooms with the slug prefix, asked at join time). The plan catalog lives in `host.json` (`plans`, `free` always present) and an environment's plan carries the catalog's `name` beside its own caps. Sign-up is `POST /api/product/signup` on the free plan, rate-limited, and off unless `SIGNUP=on`; billing is the signed webhook `POST /api/host/billing` (`BILLING_SECRET`) with `paid`, `lapsed` and `cancelled`, an hourly sweep that degrades an environment past due for fourteen days to the free caps, and checkout pages that are configuration (`BILLING_CHECKOUT_<PLAN>`). An owner's export is the environment's zip; a deletion request is a mark on the registry entry the console shows and a host admin acts on.

## Adding a new module-level singleton

If you add a thirteenth thing like `store` -- built once from a data directory, read throughout the route
handlers by a bare name -- it needs the same three edits: construct it in `buildEnvironment` (using the real
instances already in scope there, not the Proxies), add its name to the object `buildEnvironment` returns, and
add a matching `const yourName = proxyFor('yourName');` near the others in `index.js`. If it needs flushing on
exit, add that to `flushEnvironment` too. If you wire an event listener on it at the point it is built (the
pattern every existing singleton with cross-singleton wiring uses), do that inside `buildEnvironment`, closing
over the real instances in that same call -- never at module scope in `index.js`, which now only runs once,
before any environment exists.
