# Coffee Pub Tavern

Self-hosted voice and video for the table. Each player signs in once with a login and password,
or with a personal link, allows camera and microphone, and is in. Nothing to install. Every
player is available to OBS as a separate Browser Source: their camera, or a set of images the
game master assigns (normal, talking, muted) when the camera is off. Built for recording
Foundry VTT sessions alongside [Coffee Pub Studio](https://github.com/Drowbe/coffee-pub-studio).

See [DESIGN.md](DESIGN.md) for the plan and the build stages.

## Pieces

- **LiveKit** media server (one container) with a built-in TURN relay.
- **Tavern** web app (Node, one container): sign-in, the table page, a per-player view page for
  OBS, and a manage page for the party, images and settings.
- Coffee Pub Studio talks to the same server to create the OBS sources in one click.

## Run it on the QNAP (Container Station + Nginx Proxy Manager)

Everything the NAS needs is in `docker-compose.yml`, which you paste into Container Station.
The app image is built by GitHub and pulled from `ghcr.io/drowbe/coffee-pub-tavern`.

1. **Make the secrets** in Terminal on your Mac and keep them in a note:
   ```bash
   openssl rand -hex 8    # LiveKit API key
   openssl rand -hex 32   # LiveKit API secret
   openssl rand -hex 8    # your admin password
   ```
2. **DNS.** Add two records at your DNS provider pointing at your public IP, the same address
   your Foundry hostname uses: `tavern.<domain>` and `livekit.<domain>`. If the provider offers
   proxying (Cloudflare's orange cloud), turn it off for these two: media has to reach the NAS
   directly.
3. **Router.** Forward to the NAS's LAN address: `7881` TCP, `7882` UDP, `3478` UDP. (80 and
   443 already reach Nginx Proxy Manager.)
4. **Container Station.** Applications, Create, give it the name `tavern`, paste the contents of
   `docker-compose.yml`, replace the `CHANGE_ME` values (domain, API key, API secret, admin
   password), and click Create. Both containers should show green within a minute.
5. **Nginx Proxy Manager.** Two proxy hosts, each with a Let's Encrypt certificate and Force SSL:
   - `livekit.<domain>` → scheme http, forward host = NAS LAN address, port `7880`,
     **Websockets Support on**.
   - `tavern.<domain>` → scheme http, NAS LAN address, port `3000`.
6. **Sign in.** Open `https://tavern.<domain>/`, sign in as `gm` with the admin password, and
   click **Manage**.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser.
LiveKit 1.12 or newer is required; the compose file pulls the latest release.

Updating later: in Container Station, pull the new image for the `tavern` application and
recreate it. Users, images and settings live in `/share/appdata/tavern`, so nothing is lost.

## Accounts

There are two roles. **Admins** run the table: they add people, set passwords, upload images and
change settings. **Users** join the table and can set their own no-video image, nothing else.
Nobody changes their own password; an admin sets it.

Every account has a **key**, eight letters and digits made when the account is created. It never
changes. Images, OBS view links and OBS source names use the key, so an admin can rename a
login or a display name without touching anything in OBS.

Each account can sign in either way, or both:

- **Login and password.** The admin picks both and tells the player.
- **Personal link.** Turn it on for a player on the manage page and copy the link, something like
  `https://tavern.<domain>/j/2f3kd...`. Opening it signs them in and lands them at the table.
  Regenerate it to make the old one stop working; turn it off to require a password.

Sessions last 30 days. Changing someone's password or regenerating their link signs them out
everywhere.

The admin account named in the compose file is checked on every start: it is created if missing,
and its password is reset to the compose value if it differs. Forgot the admin password? Change
`TAVERN_ADMIN_PASSWORD` in Container Station and restart the container.

## The table

Join is one click. The page then becomes the table with nothing else on it; a round bar of
controls floats at the bottom and fades away when the pointer rests, coming back on any
movement. Left to right: microphone (with a live level meter inside the button), camera, layout,
chat, settings, pop out (Chrome and Edge), leave. Keys: **M** mic, **V** camera, **C** chat,
**L** layout.

- **Layouts.** Grid; strip (one row, or one column when the window is taller than wide); and
  spotlight, one big tile with the rest small. Spotlight follows whoever is speaking unless you
  click a tile to pin it. Drag tiles into any order. Layout, order and pin are remembered in the
  browser.
- **Chat.** A drawer for "can you hear me" moments, with an unread badge. Nothing is stored.
- **Audio.** In settings: microphone choice, a level slider (0 to 300%), a noise gate that cuts
  the mic below a threshold, the browser's noise suppression, echo cancellation and auto gain
  switches, and open mic or push to talk (hold Space). Hover another player's tile for a volume
  slider that applies only on your side.
- **Video.** Camera choice, quality (360p, 540p, 720p) and mirror for your own preview.
- **Without a camera or microphone** you still join; whatever is missing is named in the status
  line and your no-video image stands in for the camera.

To run the table without browser bars, install it as an app: Chrome and Edge show **Install as
an app** in the settings popover, Safari on macOS has **File, Add to Dock**, iPhones and iPads
use **Share, Add to Home Screen**. In Chrome and Edge the **pop out** button also moves the whole
table into a small always-on-top window and back.

## Images

Each player has four image slots. **No video** shows at the table when their camera is off, and
the player can set it themselves on the **Your image** page. **Normal**, **Talking** and
**Muted** are for OBS: the admin sets them on the manage page. Talking and Muted fall back to
Normal, Normal falls back to No video, and No video falls back to a plate with the player's
initials, so something always shows. PNG, JPEG, GIF or WebP up to 5 MB; square looks best.

## OBS

Every player has a view page on a transparent background. The manage page builds the link for
you (pick the mode, audio and name plate, then **Copy link**), or write it by hand:

```
https://tavern.<domain>/view/<key>?s=<stream key>&mode=auto&plate=1&audio=1
```

| Parameter | Meaning |
| --- | --- |
| `s` | The **stream key** from the manage page. Required. Regenerating it breaks every existing link. |
| `mode` | `auto` (default): the camera when it is on, the images when it is off. `video`: the camera only. `avatar`: the images only, and the page never downloads the video stream. |
| `audio` | `1` plays the player's audio through the source, for a per-player mixer strip in OBS. |
| `plate` | `1` shows the display name in the corner. |
| `offline` | `avatar` keeps showing the muted image when the player is not at the table; the default is transparent. |
| `debug` | `1` shows connection messages on the page. |

In OBS: Sources, +, Browser, paste the link, set width and height, and untick "Shutdown source
when not visible". The images switch live: Talking while the player speaks, Muted while their
microphone is off.

Kick and mute-microphone buttons are on the manage page next to each player who is at the
table.

## Settings

On the manage page: the **server name** shown in the header and browser tab, the **table name**
shown on the join screen, the **text on the sign-in page**, and an **icon** (any image; used in
the header and as the favicon). The **stream key** lives there too.

## Development

```bash
npm install
LIVEKIT_HOST=localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=... \
TAVERN_ADMIN_USER=gm TAVERN_ADMIN_PASSWORD=secret npm run dev
```

Data goes to `./data` unless `DATA_DIR` says otherwise. `LIVEKIT_API_URL` overrides the HTTP
address used for the LiveKit server API (participant list, kick, mute) when it differs from
the WebSocket host.

| Path | What |
| --- | --- |
| `server/index.js` | Routes, tokens, LiveKit server API |
| `server/store.js` | Users, settings, images on disk |
| `server/auth.js` | Passwords, signed session cookies, login rate limit |
| `public/login.html` | Sign-in page |
| `public/room.html` | The table |
| `public/me.html` | A player's no-video image |
| `public/admin.html` | Manage page |
| `public/view.html` | OBS view |
