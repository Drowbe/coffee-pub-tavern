# Coffee Pub Tavern

Self-hosted voice and video for the table. Each player signs in once with a login and password,
or with a personal link, allows camera and microphone, and is in. Nothing to install. Every
player is available to OBS as a separate Browser Source: their camera, or a set of images the
game master assigns (offline, online, talking, muted) when the camera is off. Built for recording
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

A player with no camera and no microphone still joins: text-only participants sit at the table
with their player image, use chat and reactions, and can be published to OBS like anyone else.

## Rooms

The **Rooms** tab on the manage page holds the **Lobby**, which everyone belongs to and which
cannot be deleted, plus any rooms an admin adds. A room has a name, a description, a picture
(click it to change it) and the members the admin ticks. Each room is its own conversation:
after signing in a player sees the rooms they belong to, each with its members and a green dot
on those in it right now, and joins one. Admins may join any room. A player's OBS view pages
follow them from room to room. Coffee Pub Studio shows one room at a time on its Tavern tab
and publishes that room's users. Pulling a player aside into a room, and the stream hearing
only the room the admin is in, come next.

## The table

The join screen lists the rooms you belong to, each with its members and a green dot on those
in it right now. Join is one click. The page then becomes the table: the header stays, now
naming the room you are in (**Coffee Pub Tavern › Lobby**) with a **Leave room** button, the
tiles fill the middle, and a bar of controls sits locked to the bottom edge like Zoom or Meet.
Left to right: microphone (with a live level meter inside the button), camera, layout, chat,
reactions, settings, pop out (Chrome and Edge), leave. Keys: **M** mic, **V** camera, **C**
chat, **R** reactions, **L** layout, **1** to **6** send a reaction.

- **Layouts.** Grid; strip (one row, or one column when the window is taller than wide); and
  spotlight, one big tile with the rest small. Spotlight follows whoever is speaking unless you
  click a tile to pin it. Drag tiles into any order. Layout, order and pin are remembered in the
  browser.
- **Chat.** A drawer for "can you hear me" moments, with an unread badge. A little markup
  works: `**bold**`, `*italic*`, `` `code` `` and bare links. Paste, drop or pick a picture to
  send it; pictures larger than 1600 px or 1.5 MB are shrunk first. Hover a message for
  **Copy** (text, or the picture itself) and, on pictures, **Save**; the download button in the
  drawer's header saves the whole chat as a text file. Everything travels over the media
  server's data channel and nothing is stored: a late joiner sees only what comes after them.
- **Reactions.** The smiley button opens a tray: heart, thumbs up, thumbs down, laugh, question
  mark and a die for a nat 20, or keys 1 to 6. A reaction floats up from your tile for a couple
  of seconds on everyone's table, and up your Player and Character sources in OBS. Nothing is
  stored.
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
table into a small always-on-top window and back. Popped out there is no header: the controls
become a round bar floating over the tiles that fades away when the pointer rests and comes
back on any movement, with the server name and status in the corner. The page behind keeps its
header and offers **Bring it back here**.

## Player and Character

Each user has two things the recording can show, and both react to the same live signal: who
is speaking and who is muted.

Each has four pictures, **Offline**, **Online**, **Talking** and **Muted**: the box always shows
Offline or Online depending on whether the person is at the table, and lays Talking or Muted on
top while they speak or while their microphone is off. Any picture left unset is simply not
drawn.

**Player** is the person. Their box shows the camera when it is on and the **Online** picture
when it is off (the player can set that one themselves on their **Profile** page, which also
shows them everything their admin set); away from the table it shows **Offline**, or nothing.
While they speak a **talking border** is drawn around the box, and while their microphone is
off a **muted border** in its own colour; both share one width and fit any source size. Those
borders are the only things the box ever draws (no icons); for anything more, use the Talking
and Muted pictures. The borders, their colours, the width and the **name plate** are set once
under Settings; only the talking border can be switched off or recoloured per user. Two more
defaults shape the Player box while it shows a picture rather than the camera: a **colour behind
the picture**, so the video area stays visible on the recording, and a **picture size** as a
percentage of the box, which leaves a margin around the picture instead of filling the height.
The camera always fills the box.

**Character** is a second box for OBS with the same four pictures and its own talking and muted
borders (off by default, set server-wide under **Character borders**). With no Online picture
and no borders it stays transparent until they talk or mute, so it can sit over an existing
character bar. It carries no audio.

Images are PNG, JPEG, GIF or WebP up to 5 MB. Click an image box to change it, Clear to remove
it; an empty box says "not set". Overlays and the character image are optional: nothing shows
until something is set. The player image falls back to a plate with the player's initials.

## OBS

Every player has two view pages on a transparent background. The user's card on the manage
page builds the links (Player or Character, then **Copy link**), or write them by hand:

```
https://tavern.<domain>/view/<key>?s=<stream key>&kind=player
https://tavern.<domain>/view/<key>?s=<stream key>&kind=character
```

| Parameter | Meaning |
| --- | --- |
| `s` | The **stream key** from the Settings tab. Required. Regenerating it breaks every existing link. |
| `kind` | `player` (default): the camera, the player image when it is off, the talking border and the overlays. `character`: the character image and its overlays, never the video. |
| `plate` | `1` forces the name plate on. Normally the plate follows the **Name plate** option in the user's Player section (server default on the Settings tab). |
| `audio` | The player view always plays the player's audio; `0` makes it silent. Whether it reaches the OBS mixer is OBS's own "Control audio via OBS" on the source. |
| `reactions` | Both kinds float the player's reactions up the box; `0` keeps a source clean. |
| `debug` | `1` shows connection messages on the page. |

In OBS: Sources, +, Browser, paste the link, set width and height, and untick "Shutdown source
when not visible". With Coffee Pub Studio you skip all of this: its Tavern tab creates and
maintains both sources for you.

Kick and mute-microphone buttons are on the manage page next to each player who is at the
table.

## Settings

The manage page's Settings tab has four sections. **Server**: the icon (any image; used in the
header, as the favicon and on the sign-in page) and the **server name** shown in the header and
browser tab. **Sign-in page**: a **background** picture that fills the page behind the sign-in
box, and the text under the password field. Click either picture to change it, **Remove** to
clear it. **Player video defaults**: talking border, its colour and width in pixels, and name plate, used unless a user's own Player section overrides them (the width applies to
everyone). **OBS access**: the stream key. Room images are square; anything else is cropped to
the middle.

## Icons

Every button icon comes from [Font Awesome Free](https://fontawesome.com) (solid style), served
by the app itself from `/fa/`, so they match and stay one size. Reactions are the emoji
themselves, not icons. Font Awesome Free is used under its CC BY 4.0 (icons), SIL OFL 1.1
(fonts) and MIT (code) licences.

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
| `public/profile.html` | A player's profile: their own image, and what the admin set |
| `public/admin.html` | Manage page |
| `public/view.html` | OBS view |
