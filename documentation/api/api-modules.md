# Modules API

**Audience:** someone scripting the installation and management of Coffee Pub Tavern modules, or
building a tool that talks to a running module.

The install and management routes below are admin-only: a request without an admin session gets 401 or 403. The runtime routes at the end are for a running module. For how modules
work and what an admin sees, read [userguide-modules](../userguides/userguide-modules.md). Errors come
back as `{ "error": "message" }` with a 4xx status.

## Module manifest

A module zip holds a `module.json` at its root (or inside one wrapping folder). Writing one is covered in [api-module-sdk](api-module-sdk.md).

```json
{
  "id": "calendar",
  "name": "Calendar",
  "version": "1.0.0",
  "description": "Optional, up to 200 characters.",
  "author": "Optional, up to 60 characters.",
  "icon": "calendar-days",
  "scope": ["server", "room"],
  "surfaces": {
    "page": { "entry": "page.html" },
    "panel": { "entry": "panel.html", "width": 420, "height": 520 },
    "widget": { "entry": "widget.html", "title": "Coming up", "size": "medium", "order": 10 }
  },
  "permissions": [
    { "key": "view", "label": "See the calendar", "default": { "user": true, "guest": true, "moderator": true } }
  ],
  "hooks": { "schedule": true, "notify": true },
  "refs": {
    "produces": [{ "kind": "event", "key": "event:{id}", "card": { "title": "title", "when": "start" } }],
    "consumes": ["polls:poll"]
  }
}
```

- `id` is 2 to 32 lowercase letters, digits or dashes, starting with a letter. `name` is required, up
  to 40 characters. `version` is `x.y.z`.
- `scope` includes `server`, `room` or both. A `server` module needs `surfaces.page`, and a `room`
  module needs `surfaces.panel`. Each `entry` must be an `.html` file that exists in the zip.
- `permissions` holds up to 20 entries with unique lowercase keys. `default` says which roles have the
  permission before an admin changes it.
- `hooks` names what the module may ask Tavern to do for it: `schedule` and `notify`.
- `refs.produces` lists up to 10 kinds of item other modules may point at: a `kind` (lowercase letters, digits, dashes), an optional display `name`, optional `open` and `backlinks` flags (the module can show one of its items when asked, and shows what links to them), a `key` that is a fixed prefix then `{id}` (`"event:{id}"`), and a `card` mapping the card fields `title` (required), `subtitle`, `when`, `end`, `allDay` and `done` to top-level stored field names. `refs.consumes` lists up to 20 kinds of other modules' items as `"module:kind"`, or `"*"` for whatever other modules share; an admin approves them, and a module cannot consume its own kinds.
- `events.publishes` lists up to 10 events the module says (`name`, an optional `kind` of its refs the event concerns, a `label`, and an optional `data` mapping up to six fields the event carries to types, as an action's input does); `events.subscribes` lists up to 20 events it wants to hear, as `"*"` or `"module:name"`, approved by an admin.
- `actions.provides` lists up to 10 actions the module carries out: a `name`, a `label` and an `input` mapping up to 10 fields to `string`, `text`, `date`, `datetime`, `boolean`, `number` or `ref` (a trailing `?` for optional); a field's type may also be `ref:module:kind`, a pointer to one kind of item, which Tavern enforces; `actions.uses` lists up to 20 it wants to ask for, as `"*"` or `"module:name"`, approved by an admin.
- `access` names which of the module's own permissions guards reading and writing its data, for example `{ "read": "view", "write": "edit" }`. `surfaces.panel.mode` lists `float`, `dock` or both. `surfaces.widget` (needs the `server` scope) is a small view for the dashboard on the rooms page: an `entry`, a `title` (up to 40 characters, the module's name if omitted), a `size` of `small`, `medium`, `wide` or `tall` (`tall` for a widget with a grid, such as a month), and an `order` number (lower comes first, default 100).
- Anything else in the manifest is ignored.

## Routes

| Call | Purpose |
|---|---|
| `GET /api/modules` | `{ modules, limits }`: installed modules, their state, versions, and what awaits approval |
| `POST /api/modules` | Body is the zip, sent as `application/zip`. Returns 201 and `{ module }`, disabled until approved |
| `PATCH /api/modules/:id` | `{ enabled }`, `{ allRooms }` or `{ rooms: [room ids] }`; returns `{ module }` |
| `POST /api/modules/:id/rollback` | `{ version }`; returns `{ module }` |
| `DELETE /api/modules/:id?keepData=0` or `=1` | Uninstall; `keepData` defaults to keeping the data |

A module in the list has the manifest fields plus:

| Field | Meaning |
|---|---|
| `enabled` | Whether it is on |
| `allRooms`, `rooms` | Where a room module is available |
| `versions` | Installed versions, newest first |
| `needsApproval`, `pending` | Whether the active version asks for permissions, hooks, refs to consume, events to hear or actions to ask for that are not yet approved, and which |
| `installedAt`, `updatedAt` | Timestamps |

## Behavior to rely on

- An upload must be newer than every installed version of that `id`; otherwise it is refused with 400.
- Enabling a module records that the admin approved the permissions and hooks it lists. An upgrade or
  rollback that asks for anything not yet approved comes back with `enabled: false`.
- `allRooms` and `rooms` are refused unless the module has a room scope.
- The upload limits are 10 MB for the zip, 500 files, 10 MB for any one file and 40 MB unpacked. A zip
  over the limit gets 413.

## Runtime routes

These serve a running module. The page hosting a module's frame calls them for it (see [api-module-sdk](api-module-sdk.md)); they need a signed-in session, or for a room a guest link token in `guest=`. Data routes take `scope=server` (the default) or `scope=room&room=<id>`. A module must be enabled, and for a room it must be on for that room and the caller in it. The module's `access` permissions decide who may read and write.

| Call | Purpose |
|---|---|
| `GET /m/:id/:version/*path` | A file of the active version of an enabled module, with a sandbox content security policy. HTML pages get the SDK and base styles injected |
| `GET /api/modules/nav` | Modules with a page this person can open, for the header |
| `GET /api/modules/widgets` | Modules with a dashboard widget this person may read, in order: `{ widgets: [{ id, name, icon, version, scope, runMode, title, size, order, entry }] }`. Guests get none |
| `GET /api/modules/for-room?room=<id>` | Modules with a panel in that room this person can see |
| `GET /api/modules/:id/context` | Who is asking and their permissions in the module |
| `GET /api/modules/:id/data?prefix=` | `{ items }`, each `{ key, value, version, updatedAt, by }` |
| `GET /api/modules/:id/data/:key` | `{ item }`, or 404 |
| `PUT /api/modules/:id/data/:key` | Body `{ value, version? }`; returns `{ item }`, or 409 with `{ error, current }` if `version` is stale |
| `DELETE /api/modules/:id/data/:key?version=` | Delete a key |
| `POST /api/refs/resolve` | Body `{ from, refs: [{ module, kind, id, scope, room? }] }` (`from` is the asking module, up to 50 refs). Returns `{ cards }` in the same order: a card, or `{ ref, error, status }` for each that is missing, invalid or not allowed |
| `POST /api/bus/publish` | Body `{ module, name, ref?, data?, scope, room? }`: the module says one of its declared events happened. Needs write access to the module; `ref` must be one of its own items in the same place; `data` at most 2 KB |
| `GET /api/bus/events?module=&scope=&room=&after=` | The events the module may hear (declared and approved) after event `after`, about modules the person can see here, at most 100; `after=now` returns just where things stand |
| `GET /api/bus/actions?from=&scope=&room=&accepts=&self=1` | The actions the asking module may request, only those the person could do themselves. `accepts=module:kind` keeps those that take a pointer to that kind of item; `self=1` adds the asking module's own, marked `own` |
| `POST /api/bus/actions/request` | Body `{ from, action: "module:name", input, scope, room? }`; the input is checked against the action's declared types. Returns `{ id, status }` |
| `GET /api/bus/actions/pending`, `POST /api/bus/actions/claim`, `POST /api/bus/actions/complete`, `GET /api/bus/actions/status` | The providing module's page takes a waiting request (one page only), reports the result; the asking module reads the status. Need write access to the providing module |
| `GET /api/refs/kinds?from=` | The kinds of other modules' items the asking module may link to: `{ kinds: [{ module, moduleName, icon, kind, name, open, events: [{ name, label, data }] }] }`, where `events` is what that kind of item can report. A module installed later appears here with no change to anything else |
| `POST /api/refs/links` | Body `{ module, from, to: [refs] }`: the asking module says what one of its own items points at (the whole list). Targets the viewer cannot see, or the module may not link to, are left out. Needs write access to the module |
| `GET /api/refs/links?from=&ref=&dir=to\|from` | What points at (`to`, only for a kind with `backlinks`) or is pointed at by (`from`) one of the asking module's own items: cards, each only for what the viewer may see |
| `GET /api/refs/search?from=&scope=&room=&q=` | Cards for items `from` may link to in one scope: every kind it was approved to consume, matching `q`, newest `when` first, up to 50 |
| `GET /api/modules/:id/refs/:kind/:refId?from=&scope=&room=` | One card, `{ card }`, or an error |
| `POST /api/modules/bundled/:id/install` | Admin only. Builds one of the modules that ship with this Tavern (a folder under `modules/` next to the server) into a zip and installs it as an upload would be, so it is the same validation, approval and versioning; 404 for anything that is not a bundled module. `GET /api/modules` lists them as `bundled`: `{ id, name, icon, description, version, installed, update }` |
| `GET /api/modules/:id/rooms-data?prefix=` | For a module's server page: `{ rooms, items }` across the caller's own rooms (a member, module on for the room, role can read it), each item with its `roomId`, each room `{ id, name, icon, svg }`. `?info=1` returns just `{ rooms }`. Guests get 403 |
| `GET /api/modules/stream?room=` | One server-sent stream for all modules on a page: `change` and `schedule` events with `module`, `scope` (`room` and `server` with a room; `server` and `rooms` without) and `roomId`, filtered to what the caller may read |
| `GET /api/modules/:id/events` | Server-sent events: `change` for data changes and `schedule` when one fires. `?scope=rooms` streams changes from all the caller's rooms, each with a `roomId` |
| `POST /api/modules/:id/schedule` | `{ key, at, payload?, notify? }`; needs the `schedule` hook |
| `DELETE /api/modules/:id/schedule/:key` | Cancel a schedule |
| `POST /api/modules/:id/notify` | `{ to, title, body }`; needs the `notify` hook |
| `GET /api/notifications` | The signed-in person's notifications, with unread counts by module |
| `POST /api/notifications/read` | `{ module }` or `{ id }` marks them read |
| `GET /api/notifications/stream` | Server-sent events: `notification` |

Limits: a value is at most about 60 KB, a module's data 5 MB, a schedule payload 4 KB, 500 schedules per module and 50 notifications per person. Rate limits, per module and per person over a minute: 240 saves or deletes, 60 events, 60 asked actions, 60 schedules and 20 notifications. Over a limit a call gets 429 with a `Retry-After` header and the module is told to slow down; the first time in a while it also puts a line in the admin's activity list (`GET /api/modules/activity`, admin only), which is kept across a restart.
