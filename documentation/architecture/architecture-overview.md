# Architecture Overview

**Audience:** a developer changing Coffee Pub Tavern, who needs the shape of the whole system and
where each part lives.

Tavern is a small Node web app plus a LiveKit media server. There is no build step and no front-end
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
| Tavern web app (Node/Express): pages, accounts, images, API  |
+--------------------------------------------------------------+
```

- **LiveKit server** is open source and runs as its own container. It is a selective forwarding unit:
  each player uploads once and the server fans the stream out. It has a built-in TURN relay for players
  behind strict routers. Tavern calls its server API for the participant list, kick and mute.
- **Tavern web app** serves the pages, mints LiveKit access tokens, and keeps accounts, rooms, images and
  settings. It never touches media.
- **Coffee Pub Studio** signs in as an admin and creates one OBS Browser Source per player, pointing at
  that player's view page.

## Technology

- **LiveKit** on both sides, with `livekit-client` served by Tavern itself from `/lib/`. It was chosen
  over a hand-rolled mesh, whose upload cost grows with the table, and over Jitsi, where per-participant
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
| `public/room.html` | The room list and the table |
| `public/profile.html` | A player's profile: photo, call settings, default images, a section per room |
| `public/admin.html` | The Manage page |
| `public/roomconfig.html` | A room's own settings page |
| `public/view.html` | The OBS view |
| `public/brand.js` | Shared header, branding and icon lookup |
| `public/style.css` | The one stylesheet |
| `public/sw.js` | The service worker that lets the table install as an app |

## Data and permissions

- Every account has a stable eight-character **key**. Images, view links and OBS source names use it, so
  renaming never touches OBS.
- A user has one of four roles (admin, moderator, user, guest). The permissions each editable role has
  live in `settings.roles` as overrides of built-in defaults, so a permission added later starts at its
  default. A member can also be flagged Moderator in one room, which grants the Moderator role's
  permissions there only.
- A member's room entry holds their per-room pictures, whether those replace their defaults, and that
  Moderator flag. Picture lookups fall from room picture, to the member's default, to the server's
  Default Images.
- **Presence and invitations.** A page tells the server it is open with `POST /api/presence` every half minute while it is visible (`startPresence` in `public/brand.js`); the server remembers when in memory, counts a person as present for 75 seconds, and `/api/table` returns `present` beside `online` (in a room). `POST /api/table/invite` makes a private aside room (ephemeral, private, no origin) for the inviter and one present person, and sends an `invite` event down the same server-sent stream as notifications (`/api/notifications/stream`); `brand.js` shows the invitation toast, and the room page joins on accept (`app:invite-accept`, or `/#join=<room>` from another page). It needs the private-conversation permission and the server setting; an invitation lasts two minutes.
- **Chat history.** Chat travels live over LiveKit's data channel. The sender also posts the text to `POST /api/rooms/:id/chat`; the server (`server/chat-history.js`) keeps the last 500 text messages per room, none older than 30 days, in `DATA_DIR/chat.json`, and `GET /api/rooms/:id/chat` returns them to whoever joins. Reading needs the `chatRead` permission and posting `chat`, and the caller must be a member of the room (an admin, or a guest of that room, also counts). The sender's name is the account's display name as the server knows it; a guest supplies their own. Asides keep nothing, pictures are live only, and one person can post 30 messages in 10 seconds. Deleting a room deletes its history. Browsers that kept history locally under the old scheme still show it when the server has none for the room.
- The server checks permissions on every request that matters (kick, mute, guest links, aside, images).
  The pages also hide controls the person cannot use, but that is convenience, not enforcement.

## Rooms and the table

Each Tavern room is one LiveKit room. Chat, reactions and away status travel over the LiveKit data
channel between participants and are never stored. Stepping aside creates an ephemeral room that holds
its origin room's id and is removed when empty; the server tells each moved participant to switch.
Presence for the Manage page and for OBS views comes from LiveKit's participant list, polled by
`/api/table`.

## Hosting

`docker-compose.yml` has two services, meant to be pasted into Container Station: `livekit` from the
official image, configured entirely through an environment variable (keys, TURN, ports 7880 for
signaling, 7881 TCP and 7882 UDP for media, 3478 for TURN), and `tavern`, the Node app from
`ghcr.io/drowbe/coffee-pub-tavern`, built by GitHub Actions. A reverse proxy terminates TLS for both
hostnames, because browsers only allow camera access over HTTPS.

Bandwidth is the real sizing number: eight players at 720p is roughly eight times 1.5 Mbps in and about
eight times seven times 1.5 Mbps out at the server. Player quality is capped by an admin setting.

## Development

```bash
npm install
LIVEKIT_HOST=localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=... \
TAVERN_ADMIN_USER=gm TAVERN_ADMIN_PASSWORD=secret npm run dev
```

Data goes to `./data` unless `DATA_DIR` says otherwise. `LIVEKIT_API_URL` overrides the HTTP address used
for the LiveKit server API when it differs from the WebSocket host. `npm run check` syntax-checks every
script; `npm run check:docs` checks the documentation structure.
