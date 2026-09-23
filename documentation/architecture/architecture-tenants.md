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
(for the default environment only) bootstraps the admin from `TAVERN_ADMIN_PASSWORD`. It returns a plain object
with one property per service. Nothing here is a Proxy -- these are the real instances.

Two things it does **not** build, because they are the host's, not any one environment's: the LiveKit
`RoomServiceClient` (one call service, shared -- see "LiveKit room names" below) and the Font Awesome Pro
override (`DATA_DIR/fontawesome-pro/`, a host-level admin asset the migration never moves).

`flushEnvironment(env)` writes the four things under the seam that only debounce rather than writing
synchronously on every change (`chatHistory`, `ai`, `geocodeCache`, the activity log). Called on process exit
(every built environment) and before a backup or a restore (that one environment, so nothing recent is missing
from the zip, or overwritten by a stale in-memory copy right after).

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
- **`BASE_DOMAIN` set:** the hostname picks a branch -- `host.<base>` dispatches to `hostRouter` (a separate
  `express.Router()`, never mounted on `app` directly, so a request there can never fall through to a route that
  needs an environment); the bare base domain gets a static placeholder; `<slug>.<base>` resolves that tenant's
  environment the same way the no-base-domain case resolves the default one; anything else is a plain 404. A
  hostname matching `PREVIOUS_BASE_DOMAINS` 301s to the same path at the current base first.

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

## LiveKit room names

One `RoomServiceClient`, shared by every environment (the plan's phase 4 territory is a per-tenant call-name
scheme and per-tenant concurrent-call limits; not built yet). `livekitRoomName()`/`roomIdOfLivekit()` already
prefix the room name with the current environment's own slug when one is resolved (`env.slug`, null for the
default environment), so two environments with the same `room` setting cannot collide in LiveKit today, even
before phase 4's fuller scheme.

## Adding a new module-level singleton

If you add a thirteenth thing like `store` -- built once from a data directory, read throughout the route
handlers by a bare name -- it needs the same three edits: construct it in `buildEnvironment` (using the real
instances already in scope there, not the Proxies), add its name to the object `buildEnvironment` returns, and
add a matching `const yourName = proxyFor('yourName');` near the others in `index.js`. If it needs flushing on
exit, add that to `flushEnvironment` too. If you wire an event listener on it at the point it is built (the
pattern every existing singleton with cross-singleton wiring uses), do that inside `buildEnvironment`, closing
over the real instances in that same call -- never at module scope in `index.js`, which now only runs once,
before any environment exists.
