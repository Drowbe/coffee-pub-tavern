# Architecture Overview

**Audience:** a developer changing Coffee Pub Magpie, who needs the shape of the whole system and
where each part lives.

Magpie is a small Node web app plus a LiveKit media server. There is no build step and no front-end
framework: the pages are plain HTML, CSS and JavaScript served as they are.

## The pieces

```
+--------------+   WebRTC (one upload each)   +--------------+   WebRTC   +--------------+
| Player       | ---------------------------> | LiveKit      | ---------> | OBS browser  |
| browser      | <--------------------------- | media server | <--------- | sources      |
+--------------+   other players' streams     +--------------+            +--------------+
        ^                                             ^
        | pages and API                               | access tokens
+--------------------------------------------------------------+
| Magpie web app (Node/Express): pages, accounts, images, API  |
+--------------------------------------------------------------+
```

- **LiveKit server** is open source and runs as its own container. It is a selective forwarding unit:
  each player uploads once and the server fans the stream out. It has a built-in TURN relay for players
  behind strict routers. Magpie calls its server API for the participant list, kick and mute.
- **Magpie web app** serves the pages, mints LiveKit access tokens, and keeps accounts, rooms, images and
  settings. It never touches media.
- **Coffee Pub Studio** signs in as an owner and creates one OBS Browser Source per player, pointing at
  that player's view page.

## Technology

- **LiveKit** on both sides, with `livekit-client` served by Magpie itself from `/lib/`. It was chosen
  over a hand-rolled mesh, whose upload cost grows with every person in the call, and over Jitsi, where per-participant
  OBS views would need low-level work.
- **Node 22 and Express 5.** One app serves every page and the JSON API.
- **No database.** Users, rooms, settings and roles live in one JSON file in the data volume, images next
  to it, and installed modules in their own folder. Everything is loaded once and written back whole.
- **Accounts.** Passwords are scrypt hashes. A session is a signed cookie, so there is no session table.
- **Everything self-hosted.** Font Awesome, the LiveKit client and the background-blur model are served
  by the app, so a page never fetches anything from a third party.
- **Styling** is one stylesheet driven by color tokens; see [design-theme](../designsystem/design-theme.md).

## Where things live

| Path | What |
| --- | --- |
| `server/index.js` | Routes, tokens, LiveKit server API, permission checks |
| `server/store.js` | Users, rooms, settings, roles and images on disk |
| `server/auth.js` | Passwords, signed session cookies, login rate limit |
| `server/chat-history.js` | A room's recent chat text (500 messages, 30 days), in `chat.json` |
| `server/modules.js` | Module install and registry; see [architecture-modules](architecture-modules.md) |
| `public/login.html` | Sign-in page |
| `public/register.html` | Self sign-up and invite acceptance |
| `public/room.html` | The space list and the call |
| `public/profile.html` | A player's profile: photo, call settings, default images, a section per room |
| `public/admin.html` | The Manage page |
| `public/roomconfig.html` | A room's own settings page |
| `public/view.html` | The OBS view |
| `public/brand.js` | Shared header, branding and icon lookup |
| `public/style.css` | The one stylesheet |
| `public/sw.js` | The service worker that lets the app install |

## Data and permissions

- Every account has a stable eight-character **key**. Images, view links and OBS source names use it, so
  renaming never touches OBS.
- An account's `role` is `owner` or `member`; `admin` is only the server's admin (the account `ADMIN_LOGIN` and
  `ADMIN_PASSWORD` make on a single install, or the host admin's own account inside an environment,
  `hostAdmin: true`), which can't be changed or given (`ROLES` and `ASSIGNABLE_ROLES` in
  `server/store.js`). `owner` and `admin` have every right (`OWNER_RIGHTS`, `hasOwnerRights()`); the
  owner-only routes use `requireOwner` and answer 403 `owners only` (the pages: "Owners only."). An environment may
  have no owner. A guest is not an account. The permissions each
  editable role (`moderator`, `member`, `guest`) has live in `settings.roles` as overrides of built-in
  defaults, so a permission added later starts at its default; `GET /api/roles` answers them keyed `owner`,
  `moderator`, `member` and `guest`, and `PATCH /api/roles/:role` changes one (`/api/roles/owner` answers 400
  "the owner has every permission, so that role can't be changed"). A member can also be flagged Moderator in
  one space, which grants the Moderator role's permissions there only.
- A member's room entry holds their per-room pictures, whether those replace their defaults, and that
  Moderator flag. Picture lookups fall from room picture, to the member's default, to the server's
  Default Images.
- **Presence and invitations.** A page tells the server it is open with `POST /api/presence` every half minute while it is visible (`startPresence` in `public/brand.js`); the server remembers when in memory, counts a person as present for 75 seconds, and `GET /api/presence` returns `present` beside `online` (in a call). `POST /api/asides/invite` makes a private aside room (ephemeral, private, no origin) for the inviter and one present person, and sends an `invite` event down the same server-sent stream as notifications (`/api/notifications/stream`); `brand.js` shows the invitation toast, and the room page joins on accept (`app:invite-accept`, or `/#join=<room>` from another page). It needs the private-conversation permission and the server setting; an invitation lasts two minutes.
- **Currencies.** `GET /api/currencies` (anyone signed in; otherwise 401 `sign in first`) answers
  `{ currencies: [codes] }`, sorted: exactly the codes `PATCH /api/settings` accepts, the ISO 4217 codes the
  server's Node knows (`CURRENCIES` in `server/store.js`), plus the one already stored if it is not among them
  (`currencyCodes()` in `server/currencies.js`). A module gets the same list as `host.locale().currencies`, and
  `host.ui.currencySelect` draws it; a page that is not a module (Manage) gets the same drawing from
  `window.hostCurrency`, which `/sdk/host.js` defines. Names come from the viewer's browser
  (`Intl.DisplayNames`), not the server.
- **Chat history.** Chat travels live over LiveKit's data channel. The sender also posts the text to `POST /api/rooms/:id/chat`; the server (`server/chat-history.js`) keeps the last 500 text messages per room, none older than 30 days, in `DATA_DIR/chat.json`, and `GET /api/rooms/:id/chat` returns them to whoever joins. Reading needs the `chatRead` permission and posting `chat`, and the caller must be a member of the room (an admin, or a guest of that room, also counts). The sender's name is the account's display name as the server knows it; a guest supplies their own. Asides keep nothing, pictures are live only, and one person can post 30 messages in 10 seconds. Deleting a room deletes its history. Browsers that kept history locally under the old scheme still show it when the server has none for the room.
- The server checks permissions on every request that matters (kick, mute, guest links, aside, images).
  The pages also hide controls the person cannot use, but that is convenience, not enforcement.

## Spaces and calls

Each space has one call, a LiveKit room named from the space's id (`lobby` for the Lobby, `aside-<id>` for an
aside, each prefixed `<slug>.` on a hosted server; see "Call names" in
[architecture-tenants](architecture-tenants.md)). Nothing about the name is stored. Chat, reactions and away
status travel over the LiveKit data channel between participants and are never stored. Stepping aside creates
an ephemeral room that holds its origin space's id and is removed when empty.

- `GET /api/presence` answers who is online and where (`users`, `rooms`, `activeRoom`, `adminOnline`, and the
  environment's branding), from LiveKit's participant list and each page's own presence ping. A signed-in
  person, the access key or a guest's token (`?guest=`) may ask; anyone else gets 401.
- `POST /api/asides` `{ with, private }` pulls people who are in the caller's call into a new aside and answers
  `{ room }`. It answers 403 "asides are turned off" or "private conversations are turned off" (or the caller
  lacks the permission), 400 "pick someone to pull aside" or "you need to be in a call yourself to pull someone
  aside", 404 "`<name>` is not with you right now", 409 "`<name>` is not in the conference right now", and 502
  "LiveKit: ..." when the call service fails.
- `POST /api/asides/invite` `{ to }` makes a private aside for two and answers `{ room, invite: { id } }`;
  `POST /api/asides/invite/:id/decline` answers `{ ok: true }`.
- `POST /api/asides/recall` (an owner) tells every private conversation pulled out of the owner's space to come
  back, and answers `{ recalled }`, the number of them; 400 "you need to be in a call yourself to recall anyone"
  or "nobody is off in a private conversation from here right now".
- `POST /api/asides/return` takes the caller, and the aside's other members, back to the space the aside came
  from (the Lobby when that space is gone) and answers `{ room }`; 400 "you need to be in a call" or "you are not
  in an aside".

The server tells the other people involved over the data channel, on four topics: `aside-pull`
`{ type, roomId, byAdmin, private, from }` to the people pulled, `aside-started` `{ type, roomId, members }` to
everyone left behind, `aside-recall` `{ type, roomId, roomName }` and `aside-return` `{ type, roomId }`. The old
`/api/table...` routes answer 404 and the old topics are no longer sent.

## Hosting

`docker-compose.yml` has two services, meant to be pasted into Container Station: `livekit` from the
official image, configured entirely through an environment variable (keys, TURN, ports 7880 for
signaling, 7881 TCP and 7882 UDP for media, 3478 for TURN), and `magpie`, the Node app from
`ghcr.io/drowbe/coffee-pub-tavern`, built by GitHub Actions. A reverse proxy terminates TLS for both
hostnames, because browsers only allow camera access over HTTPS.

Bandwidth is the real sizing number: eight players at 720p is roughly eight times 1.5 Mbps in and about
eight times seven times 1.5 Mbps out at the server. Player quality is capped by an owner's setting.

## Development

```bash
npm install
LIVEKIT_HOST=localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=... \
ADMIN_LOGIN=gm ADMIN_PASSWORD=secret npm run dev
```

Data goes to `./data` unless `DATA_DIR` says otherwise. `LIVEKIT_API_URL` overrides the HTTP address used
for the LiveKit server API when it differs from the WebSocket host. `npm run check` syntax-checks every
script; `npm run check:docs` checks the documentation structure.
