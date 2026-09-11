# Coffee Pub Tavern

Self-hosted voice and video for the table. One personal link per player, nothing to install, no
accounts. Every player is available to OBS as a separate Browser Source that the streamer lays out
freely. Built for recording Foundry VTT sessions alongside
[Coffee Pub Browser](https://github.com/Drowbe/coffee-pub-browser).

Status: design stage. See [DESIGN.md](DESIGN.md) for the plan, the pieces and the build stages.

## Pieces

- **LiveKit** media server (one container) with a built-in TURN relay.
- **Tavern** web app (Node, one container): the table page players use, a per-player view page for
  OBS, and an admin page for tables, players and links.
- A section in Coffee Pub Browser that creates the OBS sources in one click.

## Run it on the QNAP (Container Station + Nginx Proxy Manager)

Stage 1 gives you a working table: players join with a shared table key, see and hear each
other, and OBS can load a per-player view. Per-player links and the admin page come in later
stages.

1. **Files on the NAS.** Put this repository in `/share/appdata/tavern` (or clone it there), then:
   ```bash
   cp .env.example .env
   ```
   Fill in `.env`: your two hostnames, a LiveKit key and secret (`openssl rand -hex 16` and
   `openssl rand -hex 32`), a table key for players and an admin key for OBS views. Put the same
   key and secret into `livekit.yaml` under `keys:` and set `turn.domain` to your LiveKit
   hostname.
2. **Router.** Forward to the NAS: `7881/tcp`, `7882/udp` and `3478/udp`.
3. **Nginx Proxy Manager.** Two proxy hosts with TLS certificates:
   - `livekit.<your domain>` → NAS IP, port `7880`, **Websockets Support on**.
   - `tavern.<your domain>` → NAS IP, port `3000`.
4. **Start.** In Container Station create the application from `docker-compose.yml`, or from a
   shell on the NAS:
   ```bash
   docker compose up -d --build
   ```
5. **Try it.** Open `https://tavern.<your domain>/t/elegant-eight` in two browsers (a phone
   works), enter a name and the table key. You should see and hear yourself twice.
6. **OBS.** Add a Browser Source with the URL
   `https://tavern.<your domain>/view/elegant-eight/<player name>?key=<admin key>&plate=1`,
   width 640, height 360, and tick "Shutdown source when not visible" off. Add `&audio=1` if you
   want that player's audio through OBS. The background is transparent.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser.
LiveKit 1.12 or newer is required; the compose file pulls the latest release.
