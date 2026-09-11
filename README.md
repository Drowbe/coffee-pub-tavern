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

Everything the NAS needs is in `docker-compose.yml`, which you paste into Container Station.
The app image is built by GitHub and pulled from `ghcr.io/drowbe/coffee-pub-tavern`.

1. **Make four secrets** in Terminal on your Mac and keep them in a note:
   ```bash
   openssl rand -hex 8    # API key
   openssl rand -hex 32   # API secret
   openssl rand -hex 6    # table key (players type this once)
   openssl rand -hex 12   # admin key (for OBS views and, later, the admin page)
   ```
2. **DNS.** Add two records at your DNS provider pointing at your public IP, the same address
   your Foundry hostname uses: `tavern.<domain>` and `livekit.<domain>`. If the provider offers
   proxying (Cloudflare's orange cloud), turn it off for these two: media has to reach the NAS
   directly.
3. **Router.** Forward to the NAS's LAN address: `7881` TCP, `7882` UDP, `3478` UDP. (80 and
   443 already reach Nginx Proxy Manager.)
4. **Container Station.** Applications, Create, give it the name `tavern`, paste the contents of
   `docker-compose.yml`, replace the six `CHANGE_ME` values (domain, API key, API secret, table
   key, admin key), and click Create. Both containers should show green within a minute.
5. **Nginx Proxy Manager.** Two proxy hosts, each with a Let's Encrypt certificate and Force SSL:
   - `livekit.<domain>` → scheme http, forward host = NAS LAN address, port `7880`,
     **Websockets Support on**.
   - `tavern.<domain>` → scheme http, NAS LAN address, port `3000`.
6. **Try it.** Open `https://tavern.<domain>/t/elegant-eight` on your Mac and on your phone,
   enter a name and the table key. You should see and hear yourself on both.
7. **OBS.** Sources, +, Browser, URL
   `https://tavern.<domain>/view/elegant-eight/<player name>?key=<admin key>&plate=1`,
   width 640, height 360, and untick "Shutdown source when not visible". Add `&audio=1` if you
   want that player's audio through OBS. The background is transparent.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser.
LiveKit 1.12 or newer is required; the compose file pulls the latest release.

Updating later: in Container Station, pull the new image for the `tavern` application and
recreate it. Your settings live in the pasted YAML, so nothing else changes.
