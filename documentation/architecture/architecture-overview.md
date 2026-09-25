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
- **Magpie web app** serves the pages, mints LiveKit access tokens, and keeps accounts, spaces, images and
  settings. It never touches media.
- **Coffee Pub Studio** signs in as an owner and creates one OBS Browser Source per player, pointing at
  that player's view page.

## Technology

- **LiveKit** on both sides, with `livekit-client` served by Magpie itself from `/lib/`. It was chosen
  over a hand-rolled mesh, whose upload cost grows with every person in the call, and over Jitsi, where per-participant
  OBS views would need low-level work.
- **Node 22 and Express 5.** One app serves every page and the JSON API.
- **No database.** Users, spaces, settings and roles live in one JSON file in the data volume, images next
  to it, and installed modules in their own folder. Everything is loaded once and written back whole.
- **Accounts.** Passwords are scrypt hashes. A session is a signed cookie, so there is no session table.
- **Everything self-hosted.** Font Awesome, the LiveKit client and the background-blur model are served
  by the app, so a page never fetches anything from a third party.
- **Styling** is one stylesheet driven by color tokens; see [design-theme](../designsystem/design-theme.md).

## Where things live

| Path | What |
| --- | --- |
| `server/index.js` | Routes, tokens, LiveKit server API, permission checks |
| `server/store.js` | Users, spaces, settings, roles and images on disk |
| `server/auth.js` | Passwords, signed session cookies, login rate limit |
| `server/chat-history.js` | A space's recent chat text (500 messages, 30 days), in `chat.json` |
| `server/modules.js` | Module install and registry; see [architecture-modules](architecture-modules.md) |
| `public/login.html` | Sign-in page |
| `public/register.html` | Self sign-up and invite acceptance |
| `public/space.html` | The space list and the call. Until step 5b of the Names plan these were `room.html`, `room.js`, `roomconfig.*` and `room-modules.js`; `/room.html`, `/roomconfig.html` and `/module-settings?room=` answer 301 to the new pages, keeping the query |
| `public/profile.html` | A player's profile: photo, call settings, default images, a section per space |
| `public/admin.html` | The Manage page |
| `public/space-settings.html` | A space's own settings page, at `/spaces/<id>` |
| `public/canvas.js` | The space's canvas: docking, floating, snapping and popping out the conference, the chat and the modules |
| `public/view.html` | The OBS view |
| `public/brand.js` | Shared header, branding and icon lookup |
| `public/words.js` | The environment's words in the pages: `word()`, `fill()`, `applyWords()` |
| `server/words.js` | The words, their defaults, and the checks on an owner's own |
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
- A member's entry for a space holds their pictures for that space, whether those replace their defaults, and that
  Moderator flag. Picture lookups fall from the space's picture, to the member's default, to the environment's
  Default Images.
- **Presence and invitations.** A page tells the server it is open with `POST /api/presence` every half minute while it is visible (`startPresence` in `public/brand.js`); the server remembers when in memory, counts a person as present for 75 seconds, and `GET /api/presence` returns `present` beside `online` (in a call). `POST /api/asides/invite` makes a private aside (an `asides` record, `private`, no origin) for the inviter and one present person, and sends an `invite` event down the same server-sent stream as notifications (`/api/notifications/stream`); `brand.js` shows the invitation toast, and the space page joins on accept (`app:invite-accept`, or `/#join=<aside id>` from another page). It needs the private-conversation permission and the environment's setting; an invitation lasts two minutes.
- **Currencies.** `GET /api/currencies` (anyone signed in; otherwise 401 `sign in first`) answers
  `{ currencies: [codes] }`, sorted: exactly the codes `PATCH /api/settings` accepts, the ISO 4217 codes the
  server's Node knows (`CURRENCIES` in `server/store.js`), plus the one already stored if it is not among them
  (`currencyCodes()` in `server/currencies.js`). A module gets the same list as `host.locale().currencies`, and
  `host.ui.currencySelect` draws it; a page that is not a module (Manage) gets the same drawing from
  `window.hostCurrency`, which `/sdk/host.js` defines. Names come from the viewer's browser
  (`Intl.DisplayNames`), not the server.
- **Words.** An environment's levels and roles are shown in its own words (plan-environment-templates, step 1).
  The code names never change; only what people read does. `server/words.js` holds the twelve keys (`host`,
  `environment`, `space`, `aside`, `canvas`, `module`, `object`, `admin`, `owner`, `moderator`, `member`, `guest`)
  and their defaults; `host` and `admin` are the host's and can't be changed. `branding()` (so `/api/branding`,
  `/api/config`, `/api/me` and `/api/settings`) carries `words`: every key as `{ one, many, a }`, resolved.
  `GET /api/settings` also gives the owner `ownWords`, only what they set. `PATCH /api/settings`
  `{ words: { <key>: { one, many, a? } | null } }` (owner only; `null` puts one back) checks every word and refuses
  the whole save with a sentence naming the word ("The word for `<key>` needs both its singular and its plural.",
  "... can be at most 30 characters.", "... can use only letters, spaces, hyphens and apostrophes.", "... with its
  article must be its singular with the article in front, such as "a `<word>`"."). The server's own sentences go
  through the same words.
  In the pages, `public/words.js` gives `word(key, { many, cap, a })`, `fill(text)` for placeholders such as
  `{space}`, `{Spaces}` and `{a space}`, and `applyWords(root)`, which fills `data-word` elements (with
  `data-word-form="many cap a"`) and `data-fill` text and attributes (`title`, `placeholder`, `aria-label`, `alt`,
  `data-title`); call `applyWords(el)` after cloning a `<template>`. The browser caches an environment's own words
  under `app.words`. Modules get the words from `host.locale().words`, `host.util.word` and `host.util.fillWords`
  (see [api-module-sdk](../api/api-module-sdk.md)). `tools/check-names.mjs --words` fails, in `server/`, `public/` and
  `modules/`, on a changeable word typed into text people read; the host console and the product page use the
  host's own words and are allow-listed.
- **Who sees a link that signs someone in.** A person's personal sign-in link (`linkToken`) is sent only to owners
  and to that person, and never in `GET /api/status`, whatever key the request carries. A space's guest link
  (`guestToken`) is sent only to owners and to members of that space who may manage its guest link; everyone else
  (other members, guests, the stream access key) gets `null`, in `GET /api/spaces`, `GET /api/presence` and the
  aside answers alike. Before this, the access key in every OBS link could read every personal link from
  `/api/status`, an owner's included.
- **Secrets at rest.** Two-step sign-in secrets, the environment's AI key and the host's managed AI keys are
  encrypted with the server's key (`secrets.key` beside the data on a single install, `host.json`'s key with
  environments); a key saved in plain text by an older version is encrypted on first load. `app.json`,
  `host.json`, `ai.json` and `secrets.key` are made readable only by the server's own user (mode 600), on every
  start and again after a restore or a migration. An AI key that can't be read with this server's key (data
  restored onto another host) doesn't stop the other AI settings from saving; the AI settings say "the saved AI
  key can't be read on this server; enter the key again".
- **Writes only from this origin.** A POST, PUT, PATCH or DELETE that carries a cookie is refused with 403
  `{ error: "This request came from another site, so it was refused." }` when the browser says it came from
  anywhere but this origin (`Sec-Fetch-Site`), or its `Origin` isn't this one (`baseUrl()`, which minds
  `X-Forwarded-*`). A `SameSite=Lax` cookie still rides along from another origin on the same site (every
  environment is `*.BASE_DOMAIN`), which is why this is needed. Passed through: a `Bearer` token (Studio), a request
  with no cookie (webhooks, server-to-server), one with neither header (old browsers, curl), and `POST /login`, which
  the landing page at the bare base domain posts across origins by design and which trusts only the login and
  password it is sent. `sameOriginOnly` in `server/index.js`; `tools/check-origin.mjs` covers it. Follow-ups are
  GitHub #70.
- **Themes.** A theme is `{ id, name, author?, light, dark }` in the environment's settings, each set holding the
  seven base colours and nine optional ones by their stored names (`bg`, `bgSection`, `border`, `text`, `textDim`,
  `accent`, `onAccent`, `card`, `headerBg`, `headerText`, `icon`, `iconHover`, `primaryHover`, `secondary`,
  `secondaryText`, `secondaryHover`), `null` for Auto; `server/theme-css.js` is the one place that maps them to CSS.
  `GET /api/themes/:id/export` (owner; `default` is Strong Coffee) answers the file
  `{ magpieTheme: 1, name, author?, light, dark }` with every key in each set, as
  `<name>.magpie-theme.json`, or 404 "no such theme". `POST /api/themes/import` (owner; the file's JSON as the body,
  at most 16 KB) checks each set as a theme made in Manage would be (`sanitizeTheme`), adds it as a new theme
  ("Name (2)" when the name is taken, never overwriting) without applying it, and answers `{ theme, dropped }`:
  `dropped` lists what was left out, unknown keys and any optional colour that isn't `#rrggbb` (which goes back to
  Auto). It refuses with 400 "That isn't a Magpie theme file.", "This theme was made by a newer version of
  Magpie." or "This theme has no complete light or dark set: each needs all seven base colors." A body the parser
  can't read at all (an unknown charset or encoding) gets the same "That isn't a Magpie theme file."; Manage
  decodes a UTF-16 file by its byte-order mark before sending it. An environment holds at most 100 themes
  (`MAX_THEMES`): an import past that answers 400 "This environment has 100 themes, the most it can hold. Delete
  one to import another." A theme's name and author lose line breaks and tabs (made spaces) and control, direction
  and zero-width characters (a joiner inside a combined emoji is kept); the name is cut to 40 whole characters,
  the author to 60 (`cleanThemeText()` in `server/store.js`). `tools/check-themes.mjs` holds the round trip and the
  refusals.
- **Chat history.** Chat travels live over LiveKit's data channel. The sender also posts the text to `POST /api/spaces/:id/chat`; the server (`server/chat-history.js`) keeps the last 500 text messages per space, none older than 30 days, in `DATA_DIR/chat.json` (under `spaces`), and `GET /api/spaces/:id/chat` returns them to whoever joins. Reading needs the `chatRead` permission and posting `chat`, and the caller must be a member of the space (an owner or the admin, or a guest of that space, also counts). The sender's name is the account's display name as the server knows it; a guest supplies their own. An aside has no chat (its id answers 404), pictures are live only, and one person can post 30 messages in 10 seconds. Deleting a space deletes its history. Browsers that kept history locally under the old scheme still show it when the server has none for the space.
- The server checks permissions on every request that matters (kick, mute, guest links, aside, images).
  The pages also hide controls the person cannot use, but that is convenience, not enforcement.

## Spaces and calls

The server's routes and fields say space and environment since step 5a of the
[Names plan](../plans/plan-names.md). A space is `GET/POST /api/spaces`, `POST /api/spaces/order`,
`GET/PATCH/DELETE /api/spaces/:id`, `PUT/DELETE /api/spaces/:id/image`, `POST/DELETE /api/spaces/:id/guest-link`,
`GET/POST /api/spaces/:id/chat` and `DELETE /api/spaces/:id/members/:key`, answering `{ space }` or `{ spaces }`;
a person's settings in a space are `/api/me/spaces/:spaceId...` and `/api/users/:key/spaces/:spaceId...`; an
account's list is `spaces` and an invite's `spaces`. The environment's name is `environmentName` (in the
branding every page reads, `/api/me` and `/api/settings`, including `PATCH`). `POST /api/token` takes `space` and
answers `call` (the call's name at LiveKit) and `spaceId`; a guest's join answers `spaceId` and `spaceName`. The
old `/api/rooms...` paths answer 404. Saved links redirect for good (301, the rest of the query kept):
`/rooms/:id` to `/spaces/:id`, `/img/room/:id` to `/img/space/:id`, `/img/:key/:slot?room=&roomOnly=1` to
`?space=&spaceOnly=1`, and `/modules/:id?moduleRoom=` to `?space=` (`server/old-links.js`).

Each space has one call, a LiveKit room (LiveKit's own word for a call) named from the space's id (`lobby` for the Lobby, `aside-<id>` for an
aside, each prefixed `<slug>.` on a hosted server; see "Call names" in
[architecture-environments](architecture-environments.md)). Nothing about the name is stored. Chat, reactions and away
status travel over the LiveKit data channel between participants and are never stored.

An aside is not a space. Since step 8 of the Names plan it is its own record, `asides` in `app.json`:
`{ id, members, origin, private, createdAt }`, where `origin` is the space it was pulled out of (null for a
private conversation started by invite) and `private` marks an off-the-record conversation. It holds the call
only: no name, modules, chat, chat pictures, layout or settings of its own. The server removes it once nobody
online is in it (`pruneAsides()` in `server/store.js`, after a short grace period). Spaces no longer carry
`ephemeral`, `origin` or `private`. `POST /api/token` accepts an aside's id as `space`; any other route under
`/api/spaces/:id` (chat, settings, modules) answers 404 "no such space" for one. In an aside the page offers the
call alone: no chat, no chat pictures, no modules (`inAside()` in `public/space.js`).

- `GET /api/presence` answers who is online and where (`users` with each one's `space`, `spaces`, `asides`,
  `activeSpace`, `ownerOnline`, and the environment's branding), from LiveKit's participant list and each page's
  own presence ping. `spaces` holds spaces only; `asides` holds each aside's record plus `mine`, true when the
  caller is one of its members or has owner rights. A signed-in person, the access key or a guest's token
  (`?guest=`) may ask; anyone else gets 401. `GET /api/status` also carries `asides` (the records), and
  `GET /api/spaces` lists spaces only.
- `POST /api/asides` `{ with, private }` pulls people who are in the caller's call into a new aside and answers
  `{ aside }`, the aside's record. It answers 403 "asides are turned off" or "private conversations are turned off" (or the caller
  lacks the permission), 400 "pick someone to pull aside" or "you need to be in a call yourself to pull someone
  aside", 404 "`<name>` is not with you right now", 409 "`<name>` is not in the conference right now", and 502
  "LiveKit: ..." when the call service fails.
- `POST /api/asides/invite` `{ to }` makes a private aside for two and answers `{ aside, invite: { id } }` (the aside's record);
  `POST /api/asides/invite/:id/decline` answers `{ ok: true }`.
- `POST /api/asides/recall` (an owner) tells every private conversation pulled out of the owner's space to come
  back, and answers `{ recalled }`, the number of them; 400 "you need to be in a call yourself to recall anyone"
  or "nobody is off in a private conversation from here right now".
- `POST /api/asides/return` takes the caller, and the aside's other members, back to the space the aside came
  from (the Lobby when that space is gone) and answers `{ space }`; 400 "you need to be in a call" or "you are not
  in an aside".

The server tells the other people involved over the data channel, on four topics: `aside-pull`
`{ type, spaceId, byOwner, private, from }` to the people pulled, `aside-started` `{ type, spaceId, members }` to
everyone left behind, `aside-recall` `{ type, spaceId, spaceName }` and `aside-return` `{ type, spaceId }` (before step 5a they carried `roomId` and `roomName`). The old
`/api/table...` routes answer 404 and the old topics are no longer sent.

## Hosting

`docker-compose.yml` has two services, meant to be pasted into Container Station: `livekit` from the
official image, configured entirely through an environment variable (keys, TURN, ports 7880 for
signaling, 7881 TCP and 7882 UDP for media, 3478 for TURN), and `magpie`, the Node app from
`ghcr.io/drowbe/coffee-pub-tavern`, built by GitHub Actions. A reverse proxy terminates TLS for both
hostnames, because browsers only allow camera access over HTTPS.

Bandwidth is the real sizing number: eight players at 720p is roughly eight times 1.5 Mbps in and about
eight times seven times 1.5 Mbps out at the server. Player quality is capped by an owner's setting.

## Design rules

- **A list is not an editor.** A list shows what exists and lets you pick one; editing happens on a page about
  that one thing. People (`/profile/<key>`) and spaces (`/spaces/<id>`) work this way: their Manage tabs are a
  roster of a picture, a name, a status line and a link. Keep new admin surfaces to this shape rather than growing
  an inline editor on a list; the two earlier ones scaled badly enough to need rebuilding.

## Development

```bash
npm install
LIVEKIT_HOST=localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=... \
ADMIN_LOGIN=gm ADMIN_PASSWORD=secret npm run dev
```

Data goes to `./data` unless `DATA_DIR` says otherwise. `LIVEKIT_API_URL` overrides the HTTP address used
for the LiveKit server API when it differs from the WebSocket host. `npm run check` syntax-checks every
script; `npm run check:docs` checks the documentation structure.
