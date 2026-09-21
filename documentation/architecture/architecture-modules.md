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

## Modules that ship with Tavern

`server/module-build.js` builds a module's zip from its source folder (`modules/<id>/module.json` and `src/`), inlining the CSS and JS into the pages; `tools/build-module.mjs` uses it to write a zip, and the server uses it to offer the modules in the deployment's own `modules/` folder. `GET /api/modules` compares each bundled version with the installed one (`update` is true when it is newer and not already kept), and `POST /api/modules/bundled/:id/install` builds the zip in memory and passes it to `install()`, so a bundled install or update goes through the same validation, version keeping and approval as an upload: an update that asks for something new is left disabled until approved. An installed copy is updated only when the bundled version is newer, so any change to a bundled module needs a version bump; `tools/check-module-versions.mjs` enforces it against a recorded fingerprint. Only folders directly under `modules/` whose `module.json` id matches the folder name and that have a `src/` are offered, by id, so a request cannot name a path.

## Install, upgrade and rollback

Files are written to a staging folder next to the final location and moved into place with a single
rename, so a failure never leaves a half-installed version. A new module is created disabled. An
upgrade keeps `enabled`, `allRooms` and `rooms`, then compares what the new manifest asks for with
`approved`; anything new turns `enabled` off. Rollback changes only the active `version` and applies
the same check. After each install, only the newest three versions are kept, never removing the active
one.

## Approval

`pendingFor` returns the permissions, hooks and `refs.consumes` entries in the active manifest that are not in `approved`.
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

### The dashboard

The rooms page is a `.home` grid: a sticky sidebar, `#dashboard`, on the left and `.home-main` on the right (a `#whos-around` strip, then the room cards); on a phone one column with the main part first. `public/dashboard.js` fills the sidebar with a card for each module with a `surfaces.widget`, listed by `GET /api/modules/widgets` in the order the manifests ask for. A widget is mounted exactly as a module page is (`mountModule` with `scope: 'server'`, in the page for a bundled module and in a sandboxed frame otherwise), so it uses the same SDK and the same reads across the viewer's rooms (`rooms-data`, checked against the module's read permission in each room). Tavern knows nothing of what a widget shows. An item a widget opens (`refs.open`) in a room takes the person into that room with only that module's pane open on it: `openInRoom` in `public/room.js` asks the pane manager (`requestOpen` in `public/room-modules.js`) to open just that module and hand it the pointer on the next restore, then joins (or shows the stage when already in that room). That one-off layout is not remembered as the room's layout until the person opens or closes a pane themselves. An item outside a room goes to the module's page, given the pointer in the address (`openRef` in `dashboard.js`); the card's heading links to the module's own page. Who is around (Tavern's own, from `/api/table`) is drawn into the strip. A widget can ask for its module's page at a place in it with `tavern.page.open(hash)` (the host's `page.open`, answered only by the dashboard), which goes to `/modules/<id>#hash`; the module page hands the hash to the module (`pagehash`, `tavern.page.onHash`), as it does a pointer. The sidebar stays hidden until it has a card; a guest has no dashboard. A module's build (`server/module-build.js`) writes the widget entry from `src/<id>-widget.*`, and inlines `src/<id>-lib.js`, then any `src/<id>-lib-*.js` in name order, wherever a script has `/*__LIB__*/` (and any `src/<id>-lib-*.css` ahead of the page's own CSS, for a library that brings a stylesheet). A shared library with no page in it can be run on its own by a check (`tools/check-travel.mjs` does this for the Travel module's model and plan).

### Shared tools

The SDK carries what more than one module needs (the date picker, the drop menu, small helpers in `tavern.util`), so modules stay small and look and behave alike. The picker and menu draw their elements inside the module's own root, positioned by the page's coordinates, and add their styles once to that root in the theme's colours, so they work in a frame and in the page. The rule for the SDK: when a second module needs something a first one wrote for itself, it moves into the SDK and the first module uses it from there.

### Settings

`server/module-settings.js` keeps what people chose for the settings a module declares, in `DATA_DIR/modules/settings.json`: one bucket for the server, one per room and one per person, each holding a module's values. The manifest's definitions are cleaned in `cleanSettings` (`server/modules.js`) and every value is checked against its definition on the way in. `GET /api/modules/:id/settings/values` gives a module the values that apply to the viewer (server, the room's and the person's, defaults filled in), and a change goes out on the shared stream as `settings` so open modules read them again. Who may change what is decided in `settingsPlace` in `server/index.js`: an admin for the server's, an admin or a member ticked as a moderator in that room for its room's, and anyone for their own. The forms are drawn by `public/module-settings.js` (the Modules tab for the server's, the room's page for an admin, `/module-settings?room=` for a room's moderators, the profile page for a person's own). Changes to server and room settings add a line to the activity list; a person's own do not.

### Run modes

`runModeOf` in `server/modules.js` decides how a module runs: the admin's explicit choice, else the page for a module installed from those that ship with Tavern (`source: 'bundled'`), else a sandboxed frame. Switching an uploaded module to the page needs `acceptRisk`, and the server records when. The frame path is described below. For the page, `/m/<id>/<version>/<entry>?part=css|body|js` returns the style, the markup and the script of the module's single HTML file, and answers 403 unless the module runs in the page. `startInPage` in `public/module-host.js` attaches a shadow root to the module's container, injects the base stylesheet (scoped) and the module's style and markup, and loads its script as an external script carrying the SDK instance (the room page's content security policy forbids inline script). The SDK is the same code (`createTavern`); over a frame it talks by `postMessage`, in the page the host calls its handlers directly. A module in the page can bypass the SDK, so the approved-permissions list, which the server checks per call, stops being a limit on it; that is why the choice is the admin's, behind a warning. The Maps module shows how a large front-end library rides in a bundled module: MapLibre GL JS and the PMTiles reader are `src/maps-lib-*` files inlined into its page, the map's worker starts from a blob (the page policy allows `worker-src blob:`), the map file is read by range from `GET /api/modules/:id/files/:name` (the operator's file in `DATA_DIR/modules/<id>/<folder>/`, the folder its `file` setting names; installing, updating and uninstalling never delete it, even when the module's data is wiped, chosen by a `file` setting), and the label glyphs are static files under `public/maps-glyphs/`. `GET /api/modules/activity` (admin) lists what modules have done recently, shown on the Modules tab; the list (300 lines) is written to `DATA_DIR/modules/activity.json` a few seconds after a change and when the server stops. `server/module-limits.js` rate limits what goes through the API per module and person (saves, events, actions, schedules, notifications) with a sliding minute; it limits only what passes through Tavern, so it is not a boundary for a module running in the page.

### The frame

A module page is served from `/m/<id>/<version>/<file>` by `server/index.js`. Only the active version of an enabled module is served, and the path is checked to stay inside the version folder. The response carries `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; ...; connect-src 'none'; form-action 'none'`, so even when opened directly it has an opaque origin, no cookies, and no network beyond loading its own files. The host also sets `sandbox="allow-scripts allow-forms"` on the iframe. `allow-forms` is there because a sandboxed frame without it swallows a form's `submit` event, so a module's Save button appears to do nothing; `form-action 'none'` means nothing can actually be submitted.

HTML pages are rewritten on the way out: the SDK and the base stylesheet are injected inline right after `<head>`, unless the page already includes `/sdk/tavern.js` (the SDK) or carries `<meta name="tavern-base" content="none">` (the base styles). Inline injection means a module needs no subresources at all, so it works wherever a sandboxed frame may not load its own files.

### The bridge

`public/sdk/tavern.js` (in the frame) and `public/module-host.js` (in the hosting page) speak a small `postMessage` protocol: the frame sends `{ tavern: 1, id, method, params }`, the host answers `{ tavern: 1, id, result | error }`, and pushes `{ tavern: 1, event, data }`. The host answers only messages whose `source` is its own frame's window (the frame's origin is opaque, so the origin cannot be checked). In the other direction each frame gets a random secret in its address (`?tk=`), every message the host sends carries it, and the SDK ignores messages without it; who sent a message cannot be the check, because when the call is popped out the host code runs in a different window from the frame's parent. Each method becomes an authenticated HTTP request on the frame's behalf; the frame never holds a session.

A module's action bar rides the same bridge: `bar.set` gives the host a list of buttons, the host draws them into the bar element for that surface (a cell in the room grid when docked, a strip elsewhere) and sends each click back as a `bar` event. The host validates the items (up to six, short labels, icon names limited to Font Awesome names).

The host passes the theme in `hello` as a set of CSS custom properties read from the page's computed style, and the SDK sets them on the frame's `:root`.

### Who may do what

Every runtime route calls `moduleAccess` in `server/index.js`, which resolves the module (it must be enabled), the caller (a signed-in user, or a guest with a room's link token), the scope, and for a room scope checks that the module is on for that room and the caller is in it. It then checks the module's `access` permission through `store.roomPermissions`, so the per-room Moderator grant applies to modules too. The module's permissions are added to the Roles grid at run time: `ModuleManager.permissionList()` supplies `module.<id>.<key>` entries, `store.extraPermissions` hands them to `Store.roleSet`, and `store.allPermissions()` feeds the Roles grid.

### Data

`server/module-data.js` keeps a key-value store per module and scope: `data/modules/<id>/data/server.json` and `room-<id>.json`. Each scope loads once into memory and is rewritten whole on a change. Every key carries a version; a write that names a stale version gets a conflict carrying the current value. The 5 MB cap is checked against the module's total data on disk. Each write emits a `change` event.

### Live changes

`GET /api/modules/stream` is one server-sent event stream for every module on a page. It subscribes to `change` events from the data store and `fire` events from the scheduler and writes them as `change` and `schedule` events, each labelled with its module and a scope (`room` and `server` for a room's panes, `server` and `rooms` for a module's server page), checked against what the viewer may read. `public/module-host.js` shares one stream per room and page between all its frames and forwards each event into the right one. This matters because browsers allow only about six long-lived connections to one host over HTTP/1.1: a stream per module (two for a room panel) used them all with three modules open, and every other request, including a frame's first call to the host, waited forever, which the frame reported as "Tavern did not answer". `GET /api/modules/:id/events` remains for a single module and scope.

### Refs

**The principle.** Tavern is the conduit and the transport; it does not know what a task, an event or a poll is, and no code in it, or in one module, is written for a particular other module. Everything that lets modules work together is declared by the modules (what they share, what they can open, what they show links to, what they want to link to) and carried out by generic routes that read those declarations. If a change to Tavern names a module, or a module lists other modules by name in its code, the design has slipped. A module installed tomorrow takes part by declaring, and the modules around it need no change: linking a to-do to items of a module written after it works because the To-do consumes `"*"` and asks Tavern what it may link to.

Modules cannot read each other's data, and refs are the single, declared exception. The stored `module.json` is the author's original, so `cleanRefs` in `server/modules.js` normalises `refs` when a manifest is installed and again whenever one is read (`manifestOf`). A producing module maps a kind to a stored key (`event:{id}`) and to card fields; a consuming module lists `module:kind` entries an admin must approve. Because modules are front-end only there is no provider code to ask, so the card is built by the server from the provider's stored value, and only the named fields are copied.

The routes in `server/index.js` (`/api/refs/resolve`, `/api/refs/search`, and one card by address) all pass through `refScope`, which checks, in order: the asking module is named, the provider is enabled and produces that kind, the asker declared and was approved for `provider:kind`, the scope exists (a room the viewer may open, or the server for a signed-in person), and the viewer holds the provider's `read` permission there. Missing or refused items come back as an error per pointer, never a stack trace or a partial record. The host (`public/module-host.js`) always sends the frame's own module id as `from`; that is a consistency check rather than a security boundary, since the viewer is the one authorised, and their own permissions in the provider are what decide the answer.

A consumer stores only `{ module, kind, id, scope, room? }` and resolves it each time it draws. Two more conduits build on the same pointers. **Opening**: `refs.open` asks the page to show an item in the module that owns it (`openRef` in `public/room-modules.js` opens its pane in a room; `public/module.js` goes to its page), and delivers a `refopen` event, which the owner's `tavern.refs.onOpen` turns into showing the item; nothing is known about the item. **Links**: a module tells Tavern what its own items point at (`POST /api/refs/links`), which `server/module-links.js` keeps as pairs of pointers, never content; the module that owns an item marked `backlinks` can then ask what points at it, and every answer is resolved through the source module's own read permission for that viewer, so a link is only as visible as its source. A change is announced to the affected modules as a `links` event on the shared stream. Dragging is brokered by the host and driven by the pointer, because the browser's drag and drop does not reliably deliver a drag from one sandboxed frame into another. The source frame's SDK (`tavern.refs.draggable`) follows the pointer (captured from the press, so it is followed outside the frame too) and tells the host where it is in the frame's own coordinates (`refs.ptrStart`, `ptrMove`, `ptrDrop`); `ptrBegin`, `ptrMove` and `ptrDrop` in `public/module-host.js` convert to the page's, find the module frame under the pointer, draw the label at the pointer, and forward `over`, `leave` and `drop` to that frame in its coordinates (the `refsdrag` events that `tavern.refs.dropTarget` turns into callbacks). It only works between frames in one window. An earlier design put transparent layers over the other frames for a native drag; that path (`refs.dragStart`) is still there for a native drag, and the older text follows.

Native drag, for reference:  `tavern.refs.drag` sets the pointer on the drag (`application/x-tavern-ref`, for a drop into a frame in another window) and tells the host (`refs.dragStart`, checked for shape). `beginDrag` in `public/module-host.js` then puts a transparent layer over every other module frame on the page; the layers are in the host's own page, so they receive the native drag, and forward `over`, `leave` and `drop` to the frame beneath in that frame's coordinates (`refsdrag` events, which the SDK's `refs.dropTarget` turns into callbacks). The layers come down on the source's `dragend`, on a drop, on a click, or after 20 seconds, so a module cannot leave them up. A receiver validates the pointer's shape and resolves it, so a forged drag reveals nothing.

### Events and actions

`server/module-bus.js` keeps the two other conduits. An **event** (`POST /api/bus/publish`) must be one the publishing module declared, from a person who can write to that module in that place, with an optional pointer that can only be to the module's own items there; it is stored (500 kept, 14 days) and announced on the shared stream (`GET /api/modules/stream`) as a `bus` event that names the modules that may hear it: those that declared and were approved for it and that this viewer can see in that place. The host delivers it only to those frames. A subscriber that was not open catches up from a cursor the SDK keeps in the module's own data (`GET /api/bus/events?after=`); a module hears nothing from before its first subscribe. An **action** (`POST /api/bus/actions/request`) is checked in the order asking module approved for it, the person can do the thing themselves (write access to the provider), the provider declared it; its input is validated against the declared field types and only those fields are stored, then it waits in the provider's queue. The provider's frames are told (`action` on the stream); each asks to `claim` it and only one is given it (a claim not completed within a minute can be taken again), carries it out under the rules of whoever has the module open, and reports `complete`. Modules run no code here, so a request with no provider page open simply waits (seven days) for a person to open one. Nothing in `module-bus.js` or its routes knows what an event or an action means. A `ref` input field can be typed `ref:module:kind` (checked in `cleanBus` and enforced in `busInput`), and `GET /api/bus/actions?accepts=module:kind` lists the actions that take that kind, which is how a module receiving a drop learns what can be done with the item without knowing where it came from. Events may declare the data they carry (`cleanBus` keeps up to six typed fields), and `GET /api/refs/kinds` lists, for each kind a module may link to, the events that kind reports and their data; that is how a following module offers rules without naming the module it follows. The drop menu is drawn by the SDK (`tavern.actions.pick`) inside the module's own root, at the point of the drop, so it works the same in a frame and in the page; the choices are the receiving module's own plus the actions Tavern lists, filled from what the receiver has.

### Hooks

`server/module-hooks.js` holds schedules and notifications. Schedules persist to `data/modules/schedules.json` and a ten-second timer fires what is due: it delivers the schedule's notification, if any, and emits `fire`. A schedule more than six hours late (the server was off) is dropped. A repeating schedule is put back for its next time as it fires (`requeue`), computed in the schedule's time zone with `Intl` so the wall-clock time survives daylight saving changes; it skips times the server slept through and stops after `until`. Notifications persist per person in `notifications.json`, capped at 50, and are emitted as `notification` events on `GET /api/notifications/stream`. A notification reaches only people who pass the module's `read` permission for that place, which `resolveRecipients` in `server/index.js` checks. A schedule set by the module while an admin approved the hook is the only way a module causes anything to happen on its own.

### Where modules show

- **Header nav.** `loadModuleNav` in `public/brand.js` asks `/api/modules/nav` and adds an item to every page's header for each module with a page and no dashboard widget (a module with a widget is reached from its card's heading, and its unread count shows there; see The dashboard). Opened during a call these open in the in-page overlay so the call keeps running.
- **Server page.** `/modules/<id>` serves `public/module.html`, whose script (`public/module.js`) mounts the module in a full-height frame.
- **Room panes.** `public/room-modules.js` drives the Modules button in the page header and its menu (the menu lists the conference, the chat and the modules, opens under the button, and is the single way to open or close a pane (when the menu element carries the class `subnav-panes`, it is an always-visible row of buttons in the room header: `public/room-modules.js` then never hides or positions it and only keeps its buttons current); the chat's unread count shows on the button) and opens each module in one of three ways. **Docked**: a column of the stage's grid after the video and the chat (see [architecture-room-layout](architecture-room-layout.md)), with a header the host draws at the shared height and a drag handle on its left edge. **Floating**: a panel in a layer on the main page, dragged by its title and resized by its corner. **Popped out**: its own window, which is `/modules/<id>?moduleRoom=<room>&popout=1` (the same page a server page uses, in the room's scope, with no header). A module's manifest says whether it supports docked and floating; the choice, the docked width and the floating box are remembered per module in `localStorage`. When the whole call is popped out, the panes follow it into the popup window (each module is opened again there, because a frame moved between windows would reload). A room's modules come from `/api/modules/for-room` and are turned on per room from the room's own settings.
- **Notifications.** `public/brand.js` also opens the notification stream on each page (not in overlay pages, which leave it to the page underneath), shows a toast per notification, and keeps the unread counts on the nav items and the Modules button.

### Uninstall

Uninstalling removes the versions and the registry entry. With the data deleted too, it also forgets the module's schedules and notifications and drops its cached data.
