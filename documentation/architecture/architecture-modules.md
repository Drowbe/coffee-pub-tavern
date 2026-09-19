# Modules Architecture

**Audience:** developers changing how Coffee Pub Tavern installs and stores modules.

What an admin does with modules is [userguide-modules](../userguides/userguide-modules.md), and the
routes are [api-modules](../api/api-modules.md). This document is what you can only learn from
`server/modules.js`.

## Model

A module is front-end only. Nothing in a zip is ever run by the server: every file type is allowlisted,
and the zip is read entirely in memory against hard limits before a single byte is written. A module
runs in a sandboxed frame and reaches Tavern only through a host bridge, so accepting a zip from someone
else is bounded by that sandbox and by the admin's approval, not by trust in the author.

## On disk

Under `DATA_DIR/modules`:

```
registry.json                     what is installed and its state
<id>/versions/<version>/...       the module's files, one folder per version
<id>/data/                        the module's own data, kept across upgrades
```

`registry.json` is written by writing a temporary file and renaming it. Each entry holds the active
`version`, the list of installed `versions`, `enabled`, `allRooms`, `rooms`, and `approved`, which is
the permissions and hooks the admin agreed to. The manifest is read from the version's own
`module.json` on demand, so the registry cannot drift from the files.

## Reading the zip

`readZip` in `server/modules.js` uses `yauzl` on the uploaded buffer and builds a map of file name to
bytes. It refuses, with a message the admin sees:

- an unsafe path (the library already rejects `..` and absolute paths), or control characters in a name;
- a symbolic link, detected from the entry's Unix mode bits;
- any extension not on the allowlist;
- more than 500 files, a file over 10 MB, or more than 40 MB in total.

Sizes are checked twice: from the entry header before reading, and again on the bytes actually
streamed, because a header can lie. A zip made from a folder, with everything inside one top-level
folder, has that folder stripped when `module.json` is found inside it.

## Manifest validation

`cleanManifest` builds a fresh object from only the fields it knows, so unknown fields cannot reach the
registry, and it checks that each surface entry exists in the zip. It returns the cleaned manifest or
throws a `ModuleError`, which is a `StoreError` and so is turned into a JSON error by the server's
error handler.

## Install, upgrade and rollback

Files are written to a staging folder next to the final location and moved into place with a single
rename, so a failure never leaves a half-installed version. A new module is created disabled. An
upgrade keeps `enabled`, `allRooms` and `rooms`, then compares what the new manifest asks for with
`approved`; anything new turns `enabled` off. Rollback changes only the active `version` and applies
the same check. After each install, only the newest three versions are kept, never removing the active
one.

## Approval

`pendingFor` returns the permissions and hooks in the active manifest that are not in `approved`.
Enabling copies the whole current set into `approved`. That is why an upgrade can quietly gain a
capability only if the admin approves it.

## Uninstall

Removes the `versions` folder and the registry entry. The `data` folder is removed only when asked, so
that reinstalling the same `id` finds its data again.

## Running a module

What an admin does is [userguide-modules](../userguides/userguide-modules.md); what a module author sees is [api-module-sdk](../api/api-module-sdk.md). This is how the pieces fit.

```
 module frame (sandboxed)  <--postMessage-->  host page (module-host.js)  <--HTTP + SSE-->  server
   public/sdk/tavern.js                          module.js or room-modules.js               index.js, modules.js,
                                                                                            module-data.js, module-hooks.js
```

### The frame

A module page is served from `/m/<id>/<version>/<file>` by `server/index.js`. Only the active version of an enabled module is served, and the path is checked to stay inside the version folder. The response carries `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; ...; connect-src 'none'; form-action 'none'`, so even when opened directly it has an opaque origin, no cookies, and no network beyond loading its own files. The host also sets `sandbox="allow-scripts allow-forms"` on the iframe. `allow-forms` is there because a sandboxed frame without it swallows a form's `submit` event, so a module's Save button appears to do nothing; `form-action 'none'` means nothing can actually be submitted.

HTML pages are rewritten on the way out: the SDK and the base stylesheet are injected inline right after `<head>`, unless the page already includes `/sdk/tavern.js` (the SDK) or carries `<meta name="tavern-base" content="none">` (the base styles). Inline injection means a module needs no subresources at all, so it works wherever a sandboxed frame may not load its own files.

### The bridge

`public/sdk/tavern.js` (in the frame) and `public/module-host.js` (in the hosting page) speak a small `postMessage` protocol: the frame sends `{ tavern: 1, id, method, params }`, the host answers `{ tavern: 1, id, result | error }`, and pushes `{ tavern: 1, event, data }`. The host answers only messages whose `source` is its own frame's window (the frame's origin is opaque, so the origin cannot be checked). Each method becomes an authenticated HTTP request on the frame's behalf; the frame never holds a session.

A module's action bar rides the same bridge: `bar.set` gives the host a list of buttons, the host draws them into the bar element for that surface (a cell in the room grid when docked, a strip elsewhere) and sends each click back as a `bar` event. The host validates the items (up to six, short labels, icon names limited to Font Awesome names).

The host passes the theme in `hello` as a set of CSS custom properties read from the page's computed style, and the SDK sets them on the frame's `:root`.

### Who may do what

Every runtime route calls `moduleAccess` in `server/index.js`, which resolves the module (it must be enabled), the caller (a signed-in user, or a guest with a room's link token), the scope, and for a room scope checks that the module is on for that room and the caller is in it. It then checks the module's `access` permission through `store.roomPermissions`, so the per-room Moderator grant applies to modules too. The module's permissions are added to the Roles grid at run time: `ModuleManager.permissionList()` supplies `module.<id>.<key>` entries, `store.extraPermissions` hands them to `Store.roleSet`, and `store.allPermissions()` feeds the Roles grid.

### Data

`server/module-data.js` keeps a key-value store per module and scope: `data/modules/<id>/data/server.json` and `room-<id>.json`. Each scope loads once into memory and is rewritten whole on a change. Every key carries a version; a write that names a stale version gets a conflict carrying the current value. The 5 MB cap is checked against the module's total data on disk. Each write emits a `change` event.

### Live changes

`GET /api/modules/:id/events` is a server-sent event stream. It subscribes to `change` events from the data store and `fire` events from the scheduler for one module and scope, and writes them as `change` and `schedule` events. The hosting page opens one stream per scope the frame can see (its own, plus `server` for a room panel) and forwards each event into the frame. Browsers cap concurrent connections per host on HTTP/1.1, so behind a proxy that speaks HTTP/2 this is a non-issue; on plain HTTP/1.1 several tabs with several open modules can run into the cap.

### Hooks

`server/module-hooks.js` holds schedules and notifications. Schedules persist to `data/modules/schedules.json` and a ten-second timer fires what is due: it delivers the schedule's notification, if any, and emits `fire`. A schedule more than six hours late (the server was off) is dropped. A repeating schedule is put back for its next time as it fires (`requeue`), computed in the schedule's time zone with `Intl` so the wall-clock time survives daylight saving changes; it skips times the server slept through and stops after `until`. Notifications persist per person in `notifications.json`, capped at 50, and are emitted as `notification` events on `GET /api/notifications/stream`. A notification reaches only people who pass the module's `read` permission for that place, which `resolveRecipients` in `server/index.js` checks. A schedule set by the module while an admin approved the hook is the only way a module causes anything to happen on its own.

### Where modules show

- **Header nav.** `loadModuleNav` in `public/brand.js` asks `/api/modules/nav` and adds an item per module to every page's header. Opened during a call these open in the in-page overlay so the call keeps running.
- **Server page.** `/modules/<id>` serves `public/module.html`, whose script (`public/module.js`) mounts the module in a full-height frame.
- **Room panes.** `public/room-modules.js` adds the Modules button and menu to the call toolbar and opens each module in one of three ways. **Docked**: a column of the stage's grid after the video and the chat (see [architecture-room-layout](architecture-room-layout.md)), with a header the host draws at the shared height and a drag handle on its left edge. **Floating**: a panel in a layer on the main page, dragged by its title and resized by its corner. **Popped out**: its own window, which is `/modules/<id>?moduleRoom=<room>&popout=1` (the same page a server page uses, in the room's scope, with no header). A module's manifest says whether it supports docked and floating; the choice, the docked width and the floating box are remembered per module in `localStorage`. When the whole call is popped out, docked modules float over the main window and dock again when it returns, because a frame moved between windows would reload. A room's modules come from `/api/modules/for-room` and are turned on per room from the room's own settings.
- **Notifications.** `public/brand.js` also opens the notification stream on each page (not in overlay pages, which leave it to the page underneath), shows a toast per notification, and keeps the unread counts on the nav items and the Modules button.

### Uninstall

Uninstalling removes the versions and the registry entry. With the data deleted too, it also forgets the module's schedules and notifications and drops its cached data.
