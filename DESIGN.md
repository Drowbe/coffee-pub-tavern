# Coffee Pub Tavern — Design

Self-hosted voice and video for the table. One login or personal link per player, nothing to
install, no upsell. Every player is available to OBS as a separate source that the streamer lays out freely.

Status: stages 1 to 5 built, September 2026; running on the QNAP.

## Goals

1. **Replace Discord for the session.** Players talk and see each other in the browser. Voice and
   video in one place.
2. **Trivially easy for players.** Sign in once (a password the GM gave them, or a personal link
   that is the login), allow camera and microphone, in. No app, no room codes.
3. **Every player is an OBS source.** The streamer gets a per-player page, video only or with audio,
   on a transparent background, at any size. OBS loads each one as a Browser Source. Layout is
   whatever the streamer wants.
4. **Self-hosted, cheap to run.** One small server. Works on the same box as Foundry if it has
   headroom.
5. **Fits the Coffee Pub suite.** Same look, a Foundry module that puts a "Join the Tavern" button
   where players already are, and the Coffee Pub Studio app creates the OBS sources in one click.

Non-goals for the first version: screen sharing, recording in the Tavern itself (OBS records),
text chat (Foundry has it), mobile apps (the browser page must work on phones, that is enough).

## Pieces

```
┌──────────────┐   WebRTC (one upload each)   ┌──────────────┐   WebRTC   ┌──────────────┐
│ Player       │ ───────────────────────────► │ LiveKit      │ ─────────► │ Streamer     │
│ browser      │ ◄─────────────────────────── │ media server │ ◄───────── │ OBS browser  │
│ tavern.../t/ │   other players' streams     │ + TURN       │            │ sources      │
└──────────────┘                              └──────────────┘            └──────────────┘
        ▲                                             ▲
        │ join link (name + token)                    │ tokens
┌──────────────────────────────────────────────────────────────┐
│ Tavern web app (Node): room page, view page, admin, tokens   │
└──────────────────────────────────────────────────────────────┘
```

- **LiveKit server** (open source, Go, one container). A selective forwarding unit: each player
  uploads once, the server fans out. Built-in TURN relay for players behind strict routers.
  Scales far beyond a table.
- **Tavern web app** (Node, one container). Serves three pages and mints LiveKit access tokens:
  - `/t/<room>` the **table**: the room screen players use. Built on LiveKit's React components,
    styled Coffee Pub. Camera, microphone, device pickers, mute, who is speaking, leave.
  - `/view/<room>/<player>` the **view**: one participant, video only by default, transparent
    background, optional audio, optional name plate. Made for OBS Browser Sources.
  - `/admin` the **manage page**: admins only. Add players, set passwords, personal links,
    images, see who is at the table, mute or kick someone, settings, the stream key.
- **Accounts.** Two roles, admin and user. Every account has a stable eight-character key that
  images, view links and OBS source names use, so renames never touch OBS. Sign in with a
  password the admin set or with a personal link `/j/<token>` (revocable, regenerable).
- **Images.** Four slots per player: no-video (the player sets it, shown at the table when the
  camera is off) and normal / talking / muted (the GM sets them, shown by the OBS view when the
  camera is off or in images-only mode). Replaces reactive PNG services.
- **Coffee Pub Studio** integration. The app's Session tab gets a "Tavern" section: server URL and
  the admin login; the app fetches the stream key and the party itself. One click creates an OBS
  Browser Source per player named after them, pointed at their view page in the chosen mode and
  size, and keeps them in sync when players are added or renamed.
- **Foundry module** (`coffee-pub-tavern-foundry`, later). A "Join the Tavern" button in the
  Foundry UI that opens the player's link, matched by Foundry user name. Optional; the link alone
  is enough.

## Player flow

1. Player opens their link (bookmark, or the Foundry button).
2. Browser asks for camera and microphone once. Tavern remembers the chosen devices.
3. They are in: a grid of everyone's video, their own preview, mute buttons, a speaking indicator.
4. They leave by closing the tab. Reconnection is automatic if the network blips.

Works in Chrome, Safari, Firefox, and on phones. No install anywhere.

## Streamer flow

1. Run the server once (Docker Compose, below). Create a table on the admin page, add the party.
2. Send each player their link.
3. In Coffee Pub Studio, enter the Tavern server and click "Create OBS sources". Each player
   appears in OBS as `Tavern - <name>`, a Browser Source at, say, 640×360 with a transparent
   background. Arrange them in your scenes as you like. They stay in place regardless of who
   talks, joins or leaves; an absent player renders as transparent or a placeholder, your choice.
4. Audio: either take each player's audio through their Browser Source (per-player mixer strips in
   OBS), or take one mixed feed from a `/view/<room>/all?audio=1` page. Default: per player.

## Hosting

`docker-compose.yml` with two services, meant to be pasted into Container Station with no files
on the NAS:

- `livekit` from the official image, configured through the `LIVEKIT_CONFIG` environment
  variable (API key/secret, TURN enabled, 7880 for signaling, 7881 TCP and 7882 UDP for media,
  3478 for TURN).
- `tavern` the Node app from `ghcr.io/drowbe/coffee-pub-tavern`, built by GitHub Actions;
  environment: LiveKit host, API key/secret, table key, admin key.

A reverse proxy (Caddy in the compose file, or the existing one for Foundry) terminates TLS for
`tavern.coffeepub.live` and `livekit.coffeepub.live`. Certificates are required: browsers only
allow camera access on HTTPS.

Sizing: a 2 vCPU, 2 GB box handles a table of eight with video comfortably. Bandwidth is the real
number: eight players at 720p is roughly 8 × 1.5 Mbps in and about 8 × 7 × 1.5 Mbps out at the
server, so a plan with a few TB a month or a cap on per-player bitrate (default 720p at 1.2 Mbps,
360p thumbnails for the grid, full quality only to the streamer).

## Technology

- **LiveKit** server and `livekit-client` / `@livekit/components-react` on the pages. Chosen over a
  hand-rolled mesh (upload cost grows with the table) and over Jitsi (per-participant OBS views
  need low-level work, heavier operations).
- **Node 22**, a single Express app serving a Vite-built React front end and the token API.
- **No database**: users and settings live in a JSON file in the data volume, images next to it.
  Passwords are scrypt hashes; sessions are signed cookies, so there is no session table.
- **Styling**: Coffee Pub's dark brown and amber, shared with the Browser app.

## Stages

1. **Stand it up** (1 day): compose file, LiveKit config, Node app skeleton, token minting, a bare
   room page proving two browsers can see and hear each other over the real server.
2. **The table** (2 days): the room screen with grid, self preview, device pickers, mute state,
   speaking indicator, reconnect, Coffee Pub styling, phone layout.
3. **The view** (mostly done): per-player OBS page with transparent background, audio switch,
   name plate, image modes; a mixed-audio page is still to do.
4. **Accounts and the manage page** (done): roles, passwords, personal links, images, settings,
   stream key, kick and mute.
5. **Studio app hook** (done): Tavern block on the Session tab, a Tavern tab that publishes each
   player as an OBS Browser Source and keeps it in sync by the player's key.
6. **Polish across sessions**: bitrate profiles, noise suppression toggle (browser built-in),
   push-to-talk, the Foundry button, a status page.

Stage 1 through 4 is a usable replacement for Discord at the table. Stage 5 removes the last manual
OBS step.

## Open questions

- Domain and box: same server as Foundry, or its own? (Decides the compose layout.)
- Should the GM be able to spotlight a player (a "focus" flag the view pages can react to)?
- Noise suppression: browser built-in is fine for most; a Krisp-style model in the page is
  possible later but adds CPU on the player side.
- Name plates rendered in the view page, or left to OBS text sources? (Default: in the page,
  switchable, so OBS layouts stay simple.)
