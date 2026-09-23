# Stream Module Plan

**Audience:** the author deciding how the OBS pieces (the stream key, the per-player view pages, the OBS box settings) leave the core and become a module, and whoever builds it.

**Status:** Direction asked for by the author ("this needs to become a module asap"); nothing built. The findings below are from reading the server, the pages and the Studio app's own client code.

## What OBS access is today

Everything OBS-related lives in the core, spread over the server, three pages and the Manage page:

| Piece | Where | What it does |
| --- | --- | --- |
| The stream key | `store.streamKey`, `regenerateStreamKey()`; `GET /api/me` (admins), `GET /api/settings`, `POST /api/stream-key/regenerate` | One server-wide secret that stands in for a sign-in on every OBS-facing request, as `?s=` or `x-stream-key`. |
| Stream access | `hasStreamKey`, `hasStreamAccess`, `requireStream` in `server/index.js` | An admin session or the key. Gates `/view/:key`, `/api/status`, `/api/table`, `/api/rooms` (read), `/api/token` with `role: viewer`, every `/img/*` route. |
| The view pages | `GET /view/:key`, `public/view.html`, `public/view.js` | One player's Participant or Character box on a transparent background: LiveKit viewer connection, pictures per slot, borders, name plate, dim and tint, reactions. |
| The OBS box settings | `store.settings`: `talkBorder*`, `plate*`, `picture*`, `characterBorder*`, `offline/aside/privateDim`, `*Tint`, `*TintOpacity` | "Participant video defaults" and "Character borders" on the Server tab. The table page never reads any of them: they are OBS-only. |
| The OBS access panel | Server tab, `public/admin.html` and `admin.js` | Show, copy, regenerate the key. |
| Per-player links | Profile page (`view-kind`, `view-open`), Users tab | Player / Character, Copy link. |
| Pictures | `/img/:key/:slot?s=`, `/img/room/:id?s=`, `/img/guest/:slot`, `/img/default/:slot` | The image slots the boxes draw. The slots themselves are user data (Participant and Character images on the profile) and the table draws the Participant ones too. |

## What Coffee Pub Studio calls

Studio's client (its `src/tavern.js` and `src/control/control.js`) uses exactly these:

- `POST /api/login`, then `GET /api/me` and reads `streamKey` from it.
- `GET /api/status` for the party, the rooms, the active room and whether an admin is online.
- Builds `<server>/view/<key>?s=<key>&kind=player|character` for every source it creates in OBS.
- Builds `<server>/img/<key>/<slot>?s=` and `<server>/img/room/<id>?s=` for thumbnails.

None of that is the view page's own code; it is the server's roster, pictures and the view URL. So the answer to "does Studio need to change" is **no, as long as the view URL keeps its shape and `/api/me`, `/api/status` and `/img` stay where they are.** The design below keeps all four. Existing OBS scenes keep working for the same reason: their sources point at `/view/<key>?s=...`, which does not move.

The one thing Studio could do later, not must: notice a server where the module is not installed (the view URL answers 404 instead of a page) and say "install the Stream module on the server" rather than showing a blank source. That is a Studio nicety, not a requirement.

## Why it is not a plain module today

A module is browser-side code plus generic services the host offers (storage, settings, hooks, refs, uploads, place search, region cutting). It cannot add a server route, mint a LiveKit token, or open a page without a session. The OBS pieces need three things no module can have yet, and each is a generic conduit the host should offer rather than anything named after OBS or this module (see "the host is not the brand" in [plan-modules](plan-modules.md)):

1. **A keyed page.** A module page that opens with the server's access key instead of a session, at a path the module claims. The guest link already does this for a space's guest (`hasGuestAccess` lets a module page open with a guest token); the access key is the same idea for an unattended page.
2. **A viewer's media.** A read-only LiveKit connection to one person's camera and microphone, for a page that never publishes. Today `POST /api/token` with `role: viewer` does this behind the key; the SDK needs to offer it (`host.media.viewer(userKey)` returning what the module's own LiveKit client needs), and the module ships the LiveKit client library in its zip, as Conference's code is in the core today.
3. **Presence and the roster without a session.** Who is online, where, talking or muted, with cameras on: `/api/table` and `/api/status` behind the key. The SDK needs `host.presence` (live, the same feed the table uses) and `host.people` (keys, names, which have a Character set) for the keyed page and for the links page.

The host also keeps two things that are not the module's to own:

- **The access key itself.** It gates the host's own routes (`/img`, `/api/status`, the viewer token), Studio reads it from `/api/me`, and a second module (a scoreboard on stream, say) will want the same key. It stays in the store and on the Server tab, called the **access key** in the host's own words, with "stream key" kept in the API (`streamKey`, `?s=`) so Studio and existing links need nothing.
- **The pictures.** Participant and Character images are the person's own, set on the profile, and the table draws the Participant ones. The slots and `/img/*` stay in the host. The module draws them.

## The module

**Stream** (id `stream`, or whatever the author names it): "The per-player views for OBS, and how they look on stream." Bundled with the server like the others. Scope: server (it has no per-space state; a view follows the player from space to space as it does now).

- `surfaces.keyed: { path: "view", entry: "view.html" }`. The host serves `/view/<key>?s=<access key>&kind=...` as this module's `view.html`, in the module's sandbox, with the person's key and the query in the page's address. A path may be claimed by one enabled module at a time; `view` is claimed by this one.
- `view.html`: `public/view.js` and `view.html` moved in, reading the SDK instead of `fetch('/api/table?s=')` and `fetch('/api/token?s=')`: `host.presence` for who is where, `host.media.viewer(key)` for the connection, `host.images.url(key, slot, { space })` for pictures (a thin wrapper over `/img` that carries the key), `host.settings` for the box settings. Reactions arrive as the same host event they are today.
- **Settings** (`settings`, scope `server`, on the module's own Module Configuration page): the talking and muted borders, the name plate and its layout, the picture background and scale, the Character borders, and the dim and tint for Offline, Aside and Private. The exact fields that are on the Server tab now, moved, with their current values carried over once (below).
- **Its own page** (`surfaces.page`): the links. Every member with **Player** and **Character** links to copy, and the access key shown, copied or regenerated there too (the same host endpoints; the panel on the Server tab is the host's, and stays, since the key is the host's). The profile's "OBS link" row and the Users tab's link go, replaced by this page; a person copying their own link finds it here.
- **Permissions**: none of its own beyond the admin gate on its page (the keyed page needs no permission, the key is the permission).

## Moving without breaking a stream

- **Installed on update, once.** A server that already has a stream key in use (every server has one) gets the module installed and enabled on the first start after the update, the way a migration runs once, so no OBS scene goes dark between the update and someone visiting Manage. A fresh environment gets it like any bundled module: listed under Available, installed when wanted.
- **Settings carried over once.** On that same first start the host copies the OBS box settings out of `store.settings` into the module's server settings, then stops reading them. Nothing is lost and nothing is asked.
- **The URL never moves.** `/view/<key>` is the module's claimed path, so Studio's link builder and every existing source keep working. With the module disabled or uninstalled the path answers 404 with a plain sentence saying which module serves it.
- **The API names stay.** `streamKey` on `/api/me` and `/api/settings`, `POST /api/stream-key/regenerate`, `?s=` everywhere: unchanged. Only the Manage page's own words change to "access key" where the host talks about it.

## Phases

1. **Host conduits.** The keyed page surface (manifest field, route, path claims, the shell page opening with the key), `host.presence`, `host.people`, `host.media.viewer`, `host.images.url`; the once-only install-and-carry-over migration hook a bundled module can declare (`migrate: { settingsFrom: [...] }` or the host's own one-off, decided when built). Verified with a stub module before the real one.
2. **The module.** `modules/stream/`: `view.html` from the core pages, the settings, the links page, the LiveKit client library in the zip. The `CONTRACT.md` and a user guide.
3. **Leaving the core.** Delete `public/view.*` and `GET /view/:key`'s page-serving (the route stays as the claimed-path dispatcher), the OBS box settings from `store.settings` defaults and the Server tab, the profile's link row and the Users tab's link. The OBS access panel stays and is worded as the access key. Docs: [userguide-obs](../userguides/userguide-obs.md) becomes the module's guide, [api-obs-view](../api/api-obs-view.md) keeps the URL contract (unchanged) and says which module answers it.
4. **Studio, optional.** Show a sentence when the view URL 404s because the module is off. No release of Studio is needed for the move itself.

## Decisions for the author

1. **The name.** Stream (recommended: it is what the views are for, and OBS is one program that shows them), or OBS, or Broadcast.
2. **The scope.** Move the OBS box settings with the views (recommended: the table never reads them, so they are the module's alone), or move only the view page and leave the settings on the Server tab.
3. **The pictures.** Participant and Character image slots stay the host's, on the profile (recommended), or the Character set moves to the module.
4. **The links.** The module's own page lists every player's links and the profile row goes (recommended), or the profile keeps a row that the host draws only when the module is on.
5. **Install on update.** Install and enable the module automatically once on every existing server (recommended, so no stream goes dark), or list it under Available and leave the admin to install it.
