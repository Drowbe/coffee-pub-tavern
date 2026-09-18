# Modules: plan and architecture

Status: **plan, for review.** Nothing here is built yet. Once agreed, this file becomes the
architecture and API reference, and gets updated as each step lands.

A module is a zip an admin uploads on **Manage > Modules**. Tavern unpacks it and integrates it. The
first module is a **Calendar**; a **Travel planner** follows, and is the test of live shared state.

## Decisions so far

| Area | Decision |
|---|---|
| Module code | Front-end only, running in a sandboxed iframe, plus **declarative hooks** that Tavern runs on the module's behalf. No module code runs on the server. |
| Surfaces | (1) a **server page** with its own nav item (e.g. "Calendar"); (2) a **room panel**. |
| Scope | A module declares `server`, `room`, or both. |
| Room default | A room-scoped module is **off** in every room until an admin enables it (per room, or "all rooms"). |
| Room UI | **Floating panels**: draggable, resizable, several open at once, position and size remembered per module. Chat is untouched, so someone can chat and work in a panel together. |
| Permissions | A module declares permissions; each shows in the Roles grid as its own group and is enforced by the server on every module API call. |
| Live sync | The host provides a **shared per-room store** that pushes changes to everyone in the room. |
| Calendar v1 | Includes **reminders** (so the hooks layer is v1 work). |
| Popout | Panels stay in the main window. The popped-out call window keeps just the stage. |

## Architecture

```
 Manage > Modules  --upload zip-->  server: validate, unpack to data/modules/<id>/<version>/
                                              |
        server pages (/m/<id>/)  <------------+------------>  room panels (floating)
              |                                                       |
        <iframe sandbox="allow-scripts">                  <iframe sandbox="allow-scripts">
              |   postMessage (Tavern SDK)                            |
              +---------------------> host page (room.js / shell) <---+
                                              |
                                  /api/modules/<id>/...  (auth + permission check on every call)
                                              |
                              storage, shared store, hooks scheduler
```

### Sandbox

- Each module runs in an `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), so it gets an
  opaque origin: no cookies, no access to Tavern's DOM, session or other modules.
- Module files are served from `/m/<id>/<version>/...` with a strict CSP (no external scripts,
  `connect-src 'none'`, so a module can only reach Tavern through the SDK).
- The host page mediates every call. The server re-checks identity and permission on each request;
  the iframe is never trusted.

### Manifest (`module.json`, zip root)

```json
{
  "id": "calendar",
  "name": "Calendar",
  "version": "1.0.0",
  "icon": "calendar-days",
  "scope": ["server", "room"],
  "surfaces": {
    "page": { "entry": "page.html" },
    "panel": { "entry": "panel.html", "width": 420, "height": 520 }
  },
  "permissions": [
    { "key": "view", "label": "See the calendar", "default": { "user": true, "guest": true, "moderator": true } },
    { "key": "edit", "label": "Add and change events", "default": { "user": true, "moderator": true } }
  ],
  "hooks": {
    "schedule": true,
    "notify": true
  }
}
```

Rules: `id` is `[a-z0-9-]`, unique; `icon` is an id from the Font Awesome list (Manage > Theme);
declared permission keys are namespaced as `<id>.<key>`; unknown manifest fields are ignored.

### Install lifecycle

1. **Upload:** zip is validated before anything is written: size cap, file-count cap, no path
   traversal (zip-slip), no symlinks, allowlisted file types (html, js, css, json, images, fonts,
   svg, text). Manifest schema check. Nothing executable server-side is accepted.
2. **Unpack** to `data/modules/<id>/<version>/`. Installing the same `id` with a higher version is an
   upgrade; data carries over.
3. **Enable / disable** globally. Disabled modules disappear from nav, panels and Roles but keep
   their data.
4. **Enable per room** (room-scoped modules): Room settings gets a Modules list with a toggle per
   installed module, plus "all rooms" on the module's own card.
5. **Uninstall** asks whether to keep or delete the module's data.

### Surfaces

- **Server page:** a header nav item (icon and name) opens `/modules/<id>` in the normal page shell,
  with the module in a full-width iframe. Only shown if the viewer has the module's `view` permission.
- **Room panel:** a "Modules" button on the call toolbar lists the modules enabled in this room
  (that the viewer may see). Choosing one opens a floating panel: title bar to drag, corner to resize,
  close button, remembered position and size per module in `localStorage`. Several can be open at
  once. Panels live in the main window (not the popout).
- **Both scopes:** the SDK tells the module which context it was opened in (`server` or a room id).

### Permissions

Manifest permissions are added to `ROLE_PERMISSIONS` at runtime as group "Module: <name>", so they
show in the existing Roles grid with the same defaults/override logic. The per-room Moderator grant
already gives the Moderator role's permissions in that room, so it applies to modules for free. The
server exposes `store.can(user, 'calendar.edit', roomId)` and every module API route calls it.

### Storage

Per module, in `data/modules/<id>/data/` (or a collection in `tavern.json`; decide in step 2):

- **KV store**, scoped `server` or `room:<roomId>`: `get / set / delete / list(prefix)`.
- Per-module **size cap** (default 5 MB) so one module can't fill the volume.

### Shared live store (for the Travel planner)

A per-module, per-room document store with change push:

- Keys hold JSON; each write carries the key's last-seen version, and the server accepts it if newer
  (last-write-wins **per key**). Modules should store each item under its own key, not the whole plan
  as one blob.
- The server is the source of truth. It pushes `{key, value, version, by}` to everyone in the room
  over the existing socket/LiveKit data channel; late joiners get a full snapshot on open.
- Out of scope for v1: collaborative text editing / CRDTs.

### Hooks (declarative, Tavern-run)

A module never runs code on the server. Instead it asks Tavern to do things, via the SDK, and the
manifest declares which hooks it may use:

- `schedule`: `tavern.schedule({ at, key, payload })` registers a timer. When it fires, Tavern
  delivers `{key, payload}` back to the module (if open) and runs its `notify` action.
- `notify`: `tavern.notify({ to: 'room' | 'user' | userKey, title, body })`. v1 delivery is in-app
  only: a toast for anyone currently in Tavern plus an unread badge on the module's toolbar button.
  Email/push are later.
- The scheduler is a small server loop; schedules persist across restarts.

### Theme

The host passes the current theme tokens (the seven colors + font) into the iframe on load and on
change, so modules match the site's theme.

## SDK (postMessage), first pass

`/sdk/tavern.js`, included by modules via `<script src="/sdk/tavern.js">`. Everything is async and
returns a promise.

```js
const t = await tavern.ready();          // { user:{key,name,role}, context:{scope,roomId}, theme, permissions }
tavern.can('calendar.edit');             // boolean, from the permissions sent at ready
tavern.storage.get(key);  tavern.storage.set(key, value);  tavern.storage.delete(key);  tavern.storage.list(prefix);
tavern.shared.get(key);   tavern.shared.set(key, value);   tavern.shared.list(prefix);
tavern.shared.on('change', (e) => {});   // live updates
tavern.schedule({ at, key, payload });   tavern.notify({ to, title, body });
tavern.on('theme', (theme) => {});       tavern.resize({ width, height });   tavern.setTitle(text);
```

## Server API (admin + module runtime)

Admin:
- `GET /api/modules`: installed modules with state.
- `POST /api/modules`: upload zip (admin).
- `PATCH /api/modules/:id`: enable/disable, room enablement (`rooms: [...]` or `allRooms`).
- `DELETE /api/modules/:id?keepData=1|0`.

Runtime (all require auth + the module's permission):
- `GET|PUT|DELETE /api/modules/:id/storage/:key?scope=server|room&room=<id>`
- `GET /api/modules/:id/shared?room=<id>` (snapshot) and `PUT /api/modules/:id/shared/:key`
- `POST /api/modules/:id/schedule`, `POST /api/modules/:id/notify`
- Files: `GET /m/:id/:version/*` (sandbox CSP headers)

## Build order

1. **Install and manifest.** Modules tab, hardened unzip, enable/disable/uninstall, manifest schema.
   *Adds one dependency (a zip reader).*
2. **Host API and SDK.** Identity, permissions, storage, theme tokens.
3. **Server nav page surface.**
4. **Floating room panels** + toolbar button + per-room enablement.
5. **Permissions in Roles.**
6. **Shared live store.**
7. **Hooks and scheduler**, then in-app notifications.
8. **Calendar module** (reference module; replaces the "Scheduling" TODO item).
9. **Travel planner** (proves the shared store).

Also ship a tiny `hello` module in the repo as a working example, and document the module format in
`docs/MODULE-API.md` as steps 1 to 7 land.

## Open points for review

1. **Storage location:** files under `data/modules/<id>/data/` vs. a collection in `tavern.json`.
   (Files scale better; `tavern.json` is simpler to back up as one unit.)
2. **Shared store transport:** LiveKit data channel (only works while connected to a call) vs. the
   server pushing over its own socket (also works on server pages). I lean to a server socket so
   the same code serves the server page and room panel.
3. **Reminders delivery:** in-app only for v1, or add email? (Needs SMTP settings.)
4. **Size caps:** module zip (e.g. 10 MB) and per-module data (5 MB): right numbers?
5. **Module updates:** upload-to-upgrade only, or also a "keep the old version" rollback?
6. **Third-party modules:** the sandbox is what makes accepting other people's zips safe. Do we
   plan a curated/signed list later, or is this admin-trusts-what-they-upload?
