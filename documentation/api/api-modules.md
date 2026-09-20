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
    "panel": { "entry": "panel.html", "width": 420, "height": 520 }
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
- `refs.produces` lists up to 10 kinds of item other modules may point at: a `kind` (lowercase letters, digits, dashes), a `key` that is a fixed prefix then `{id}` (`"event:{id}"`), and a `card` mapping the card fields `title` (required), `subtitle`, `when`, `end`, `allDay` and `done` to top-level stored field names. `refs.consumes` lists up to 20 other modules' kinds as `"module:kind"`; an admin approves them, and a module cannot consume its own kinds.
- `access` names which of the module's own permissions guards reading and writing its data, for example `{ "read": "view", "write": "edit" }`. `surfaces.panel.mode` lists `float`, `dock` or both.
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
| `needsApproval`, `pending` | Whether the active version asks for permissions, hooks or refs to consume not yet approved, and which |
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
| `GET /api/modules/for-room?room=<id>` | Modules with a panel in that room this person can see |
| `GET /api/modules/:id/context` | Who is asking and their permissions in the module |
| `GET /api/modules/:id/data?prefix=` | `{ items }`, each `{ key, value, version, updatedAt, by }` |
| `GET /api/modules/:id/data/:key` | `{ item }`, or 404 |
| `PUT /api/modules/:id/data/:key` | Body `{ value, version? }`; returns `{ item }`, or 409 with `{ error, current }` if `version` is stale |
| `DELETE /api/modules/:id/data/:key?version=` | Delete a key |
| `POST /api/refs/resolve` | Body `{ from, refs: [{ module, kind, id, scope, room? }] }` (`from` is the asking module, up to 50 refs). Returns `{ cards }` in the same order: a card, or `{ ref, error, status }` for each that is missing, invalid or not allowed |
| `GET /api/refs/search?from=&scope=&room=&q=` | Cards for items `from` may link to in one scope: every kind it was approved to consume, matching `q`, newest `when` first, up to 50 |
| `GET /api/modules/:id/refs/:kind/:refId?from=&scope=&room=` | One card, `{ card }`, or an error |
| `GET /api/modules/:id/rooms-data?prefix=` | For a module's server page: `{ rooms, items }` across the caller's own rooms (a member, module on for the room, role can read it), each item with its `roomId`, each room `{ id, name, icon, svg }`. `?info=1` returns just `{ rooms }`. Guests get 403 |
| `GET /api/modules/stream?room=` | One server-sent stream for all modules on a page: `change` and `schedule` events with `module`, `scope` (`room` and `server` with a room; `server` and `rooms` without) and `roomId`, filtered to what the caller may read |
| `GET /api/modules/:id/events` | Server-sent events: `change` for data changes and `schedule` when one fires. `?scope=rooms` streams changes from all the caller's rooms, each with a `roomId` |
| `POST /api/modules/:id/schedule` | `{ key, at, payload?, notify? }`; needs the `schedule` hook |
| `DELETE /api/modules/:id/schedule/:key` | Cancel a schedule |
| `POST /api/modules/:id/notify` | `{ to, title, body }`; needs the `notify` hook |
| `GET /api/notifications` | The signed-in person's notifications, with unread counts by module |
| `POST /api/notifications/read` | `{ module }` or `{ id }` marks them read |
| `GET /api/notifications/stream` | Server-sent events: `notification` |

Limits: a value is at most about 60 KB, a module's data 5 MB, a schedule payload 4 KB, 500 schedules per module and 50 notifications per person.
