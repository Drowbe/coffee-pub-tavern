# Coffee Pub Tavern — Design

Self-hosted voice and video for the table. One link per player, nothing to install, no accounts,
no upsell. Every player is available to OBS as a separate source that the streamer lays out freely.

Status: design draft, September 2026.

## Goals

1. **Replace Discord for the session.** Players talk and see each other in the browser. Voice and
   video in one place.
2. **Trivially easy for players.** Open a personal link, allow camera and microphone, in. The link
   is the login. No app, no account, no room codes.
3. **Every player is an OBS source.** The streamer gets a per-player page, video only or with audio,
   on a transparent background, at any size. OBS loads each one as a Browser Source. Layout is
   whatever the streamer wants.
4. **Self-hosted, cheap to run.** One small server. Works on the same box as Foundry if it has
   headroom.
5. **Fits the Coffee Pub suite.** Same look, a Foundry module that puts a "Join the Tavern" button
   where players already are, and the Coffee Pub Browser app creates the OBS sources in one click.

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
  - `/admin` the **bar**: streamer-only. Create a table, add players by name, copy their links,
    see who is connected, mute or remove someone, regenerate a link.
- **Personal links.** `/t/elegant-eight?k=<token>` where the token names the player and is valid
  for the season (long-lived, revocable from the admin page). The link is the login. Bookmark it.
- **Coffee Pub Browser** integration. The app's Session tab gets a "Tavern" section: server URL and
  admin key; one click creates an OBS Browser Source per player named after them, pointed at
  their view page at the chosen size, and keeps them in sync when players are added.
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
3. In Coffee Pub Browser, enter the Tavern server and click "Create OBS sources". Each player
   appears in OBS as `Tavern - <name>`, a Browser Source at, say, 640×360 with a transparent
   background. Arrange them in your scenes as you like. They stay in place regardless of who
   talks, joins or leaves; an absent player renders as transparent or a placeholder, your choice.
4. Audio: either take each player's audio through their Browser Source (per-player mixer strips in
   OBS), or take one mixed feed from a `/view/<room>/all?audio=1` page. Default: per player.

## Hosting

`docker-compose.yml` with two services:

- `livekit` from the official image, with a small `livekit.yaml` (API key/secret, TURN enabled,
  ports 7880 for signaling, 7881 and the UDP range for media, 3478 and 5349 for TURN).
- `tavern` the Node app, environment: LiveKit URL, API key/secret, admin key, public base URL.

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
- **No database** in version 1: tables and players live in a JSON file next to the app, edited by
  the admin page. Tokens are signed, so nothing sensitive is stored beyond the LiveKit secret.
- **Styling**: Coffee Pub's dark brown and amber, shared with the Browser app.

## Stages

1. **Stand it up** (1 day): compose file, LiveKit config, Node app skeleton, token minting, a bare
   room page proving two browsers can see and hear each other over the real server.
2. **The table** (2 days): the room screen with grid, self preview, device pickers, mute state,
   speaking indicator, reconnect, Coffee Pub styling, phone layout.
3. **The view** (1 day): per-player OBS page with transparent background, audio switch, name plate,
   absent placeholder; a mixed-audio page.
4. **The bar** (1 day): admin page for tables, players, links, kick and mute.
5. **Browser app hook** (1 day): Tavern section on the Session tab, one-click OBS sources.
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
