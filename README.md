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
- Coffee Pub Studio signs in to the same server as an admin and publishes each player as an OBS
  Browser Source in one click, from its Tavern tab.

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
everywhere. There is always at least one admin: the last admin cannot be demoted or deleted,
and an admin cannot change their own role or delete themselves at all; another admin has to.

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

## Player and Character

Each user has two things the recording can show, and both react to the same live signal: who
is speaking and who is muted.

**Player** is the person. Their video box shows the camera when it is on and the **Player
image** when it is off (the player can set that one themselves on the **Your image** page).
While they speak a **talking border** is drawn around the box in the colour set for them, and
while their microphone is off a **muted badge** appears. Both are drawn, so they fit any source
size. An admin can also add a **Talking overlay** and a **Muted overlay** image that are laid on
top of the video, scaled to fit, for something other than a border. The border, its colour and
the badge have server-wide defaults under Settings and can be overridden per user.

**Character** is a second box for OBS. It shows the **Character image**, if any, with the
**Talking image** on top while they speak and the **Muted image** while they are muted. With no
character image it stays transparent until they talk or mute, so it can sit over an existing
character bar. It carries no audio.

Images are PNG, JPEG, GIF or WebP up to 5 MB. Click an image box to change it, Clear to remove
it; an empty box says "not set". Overlays and the character image are optional: nothing shows
until something is set. The player image falls back to a plate with the player's initials.

## OBS

Every player has two view pages on a transparent background. The user's card on the manage
page builds the links (Player or Character, with or without a name plate, then **Copy link**),
or write them by hand:

```
https://tavern.<domain>/view/<key>?s=<stream key>&kind=player&plate=1
https://tavern.<domain>/view/<key>?s=<stream key>&kind=character
```

| Parameter | Meaning |
| --- | --- |
| `s` | The **stream key** from the Settings tab. Required. Regenerating it breaks every existing link. |
| `kind` | `player` (default): the camera, the player image when it is off, the talking border, the muted badge and the overlays. `character`: the character image and its overlays, never the video. |
| `plate` | `1` shows the display name in the corner. |
| `audio` | The player view always plays the player's audio; `0` makes it silent. Whether it reaches the OBS mixer is OBS's own "Control audio via OBS" on the source. |
| `debug` | `1` shows connection messages on the page. |

In OBS: Sources, +, Browser, paste the link, set width and height, and untick "Shutdown source
when not visible". With Coffee Pub Studio you skip all of this: its Tavern tab creates and
maintains both sources for you.

Kick and mute-microphone buttons are on the manage page next to each player who is at the
table.

## Settings

On the manage page's Settings tab: the **server name** shown in the header and browser tab, the
**table name** shown on the join screen, the **text on the sign-in page**, an **icon** (any
image; used in
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
