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
change settings. **Users** join the table and can set their own **profile photo**, nothing else.
Nobody changes their own password; an admin sets it. Nothing on an account is off-limits to an
admin, the player's own photo included -- opening `/profile/<key>` from Manage gives an admin
the exact same editing power over it a player has for themselves.

Each person's `/profile` page is split into sections -- **User** (account, photo, personal
link) and **Default Images** (the Participant and Character image sets) -- with a quick-jump
nav between them rather than one long scroll. A section for each real room they belong to
appears below the defaults, letting an admin (read-only for the player themselves) set a
different picture set just for that room -- unset slots fall back to the defaults above, so
someone in two campaigns can give each its own Character images without the other campaign's
set ever needing to change. Which of Participant or Character (or both) a room's section even
offers depends on that room's **profile** -- see Rooms, below.

**Sign-up.** Off by default. An admin turns on **Let anyone at /register sign themselves up**
under Manage > Settings, and anyone who finds that link can make their own account (an ordinary
user, dropped into the Lobby like everyone). Without opening it up, an admin can still **invite**
someone straight into specific rooms: pick the rooms and **Generate invite link** from the same
Settings panel, then send the link -- it works whether or not general sign-up is on, expires
after 7 days, and works once.

**Guests.** No account at all, for someone dropping in once. Open the settings popover (the
gear, next to chat and reactions) while at the table and, under **Guests**, turn on that room's
link -- anyone with it lands on a page asking only for a name, then joins straight into that
room: video, mic, chat, reactions, the works, standing in on the generic **guest images** set
under Manage > Settings if their camera is off. Unlike the invite link above, it's not admin-only
(anyone at the table can turn it on, copy it or turn it off) and it's a standing door rather
than single-use -- reusable for as many guests as show up, until someone turns it off or
generates a new one. Nothing about a guest is kept once they leave: no account, no history.

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
cannot be deleted, plus any rooms an admin adds. It is a roster, same as Users: click a room
to open its own page (name, description, picture, members, and its profile, below) rather
than editing it inline in the list; **↑**/**↓** on each row (the Lobby is always first and
never moves) reorders the roster itself. Each room is its own conversation: after signing in a
player sees the rooms they belong to, each with its members and a green dot on those in it
right now, and joins one. Admins may join any room. A player's OBS view pages follow them from
room to room, including into any per-room images that room has for them. Coffee Pub Studio
shows one room at a time on its Tavern tab and publishes that room's users.

**Profile.** Every room picks one of three: **Roleplaying** (the default) offers both
Participant and Character images, on the room's own member sections and to Studio's publish
UI; **Participants** offers Participant images only; **Characters** offers Character images
only. Set on the room's own config page.

**Pull aside.** While at the table, an admin can pull one or more people in their current room
into a private word: click the door icon on each tile to pick who (it toggles a selection, it
does not move anyone yet), then confirm with **Step aside with N**. Everyone picked moves
together at once, with nobody clicking anything on their own end. The pulled players (and the
admin) get a **Back to the table** button in place of the usual room name, returning everyone
together to whichever room they were pulled out of -- clicking it on any one of their screens
brings the rest back too, the same as pulling aside itself only needed the admin's click. The
private room itself is never shown as something to pick from a list; it disappears on its own
once everyone has left it. Anyone left behind doesn't see those tiles just vanish, as if they'd
hung up -- each one dims to a placeholder reading **In an aside**, naming who they stepped out
with, until they return.

This is private from the *rest of the table*, not from the recording: Coffee Pub Studio's
Tavern tab follows whichever room the admin is actually in (a **Follow the admin** tick, on by
default) and only publishes whoever is in that room, so while the admin is aside with someone,
that conversation is what's on stream, exactly as it would be in any other room -- and everyone
left behind in the room they stepped out of goes quiet on stream, same as stepping out of any
other room. Everyone not with the admin right now, aside room or not, sees that group tagged
**aside** where their tile would show a room, or **off stream** for anyone who has simply left
the admin's room some other way.

## The table

The join screen lists the rooms you belong to, each with its members and a green dot on those
in it right now. Join is one click. The page then becomes the table: the header stays, now
naming the room you are in (**Coffee Pub Tavern › Lobby**) with a **Leave room** button, the
tiles fill the middle, and a bar of controls sits locked to the bottom edge like Zoom or Meet.
Left to right: microphone (with a live level meter inside the button), deafen, camera, layout,
chat, reactions, settings, pop out (Chrome and Edge), leave. Keys: **M** mic, **D** deafen,
**V** camera, **C** chat, **R** reactions, **L** layout, **1** to **6** send a reaction.

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
- **Reactions.** The smiley button opens a tray, set up by the admin under Manage > Settings
  (six by default: heart, thumbs up, thumbs down, laugh, question mark and a die for a nat 20),
  reachable by keys 1 to 6 for the first six. A reaction floats up from your tile for a couple
  of seconds on everyone's table, and up your Player and Character sources in OBS. Nothing is
  stored.
- **Deafen.** Mutes everyone else's audio on your end without touching your own microphone or
  leaving the call -- for when something else, a phone call say, needs the room quiet for a
  minute. Local only; nobody else is affected or notified.
- **Audio.** In settings: microphone choice, a level slider (0 to 300%), a noise gate that cuts
  the mic below a threshold, the browser's noise suppression, echo cancellation and auto gain
  switches, and open mic or push to talk (hold Space). Hover another player's tile for a volume
  slider that applies only on your side.
- **Video.** Camera choice, quality (360p, 540p, 720p), mirror for your own preview, and a
  background mode: off, **blur**, or a **custom image** (upload it on your profile page, under
  Video background). Either one runs entirely on your own device (MediaPipe segmentation via
  LiveKit's `@livekit/track-processors`, self-hosted -- no CDN, nothing external fetched) and
  only loads the model the first time you actually turn either on.
- **Without a camera or microphone** you still join; whatever is missing is named in the status
  line and your Online picture (set by your admin) stands in for the camera.
- **Your profile and Manage** open in an in-page overlay from inside a call rather than
  navigating away -- leaving the page would drop the call (it is a plain WebRTC connection,
  tied to that page), so this keeps the call running underneath while you're there. A "Back
  to [room]" button appears in that page's own header; other people at the table see your
  tile dim with an "Away" label while you're on it, not a message on the page itself.

To run the table without browser bars, install it as an app: Chrome and Edge show **Install as
an app** in the settings popover, Safari on macOS has **File, Add to Dock**, iPhones and iPads
use **Share, Add to Home Screen**. In Chrome and Edge the **pop out** button also moves the whole
table into a small always-on-top window and back. Popped out there is no header: the controls
become a round bar floating over the tiles that fades away when the pointer rests and comes
back on any movement, with the server name and status in the corner. The page behind keeps its
header and offers **Bring it back here**.

## Participant and Character

Each user has two things the recording can show, and both react to the same live signal: who
is speaking and who is muted. Both can be set once as a **Default** (on the account) and,
per room, overridden just for that room -- see Rooms, above -- and which of the two a given
room even offers depends on that room's **profile**.

Each has four pictures, **Offline**, **Online**, **Talking** and **Muted**: the box always shows
Offline or Online depending on whether the person is at the table, and lays Talking or Muted on
top while they speak or while their microphone is off. Any picture left unset is simply not
drawn.

**Participant** is the person. Their box shows the camera when it is on and the **Online**
picture, set by an admin, when it is off; away from the table it shows **Offline**, or nothing.
This is separate from the player's own **profile photo**, which only shows in the app itself
(the header, table tiles, their **Profile** page) and never in the recording, since the Online
picture may be part of a matched set of OBS images the admin built.
While they speak a **talking border** is drawn around the box, and while their microphone is
off a **muted border** in its own colour; both share one width and fit any source size. Those
borders are the only things the box ever draws (no icons); for anything more, use the Talking
and Muted pictures. The borders, their colours, the width and the **name plate** are set once
under Settings, the same for everyone. Two more
defaults shape the Participant box while it shows a picture rather than the camera: a **colour
behind the picture**, so the video area stays visible on the recording, and a **picture size** as
a percentage of the box, which leaves a margin around the picture instead of filling the height.
The camera always fills the box.

**Character** is a second box for OBS with the same four pictures and its own talking and muted
borders (off by default, set server-wide under **Character borders**). With no Online picture
and no borders it stays transparent until they talk or mute, so it can sit over an existing
character bar. It carries no audio.

Images are PNG, JPEG, GIF or WebP up to 20 MB. Click an image box to change it, Clear to remove
it; an empty box says "not set". Overlays and the character image are optional: nothing shows
until something is set. The profile photo falls back to a plate with the player's initials and
always fills its square (cropped, not letterboxed); the OBS pictures show exactly what was
uploaded, uncropped, since they may be transparent overlays.

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
| `kind` | `player` (default): the camera, the Participant image when it is off, the talking border and the overlays. `character`: the character image and its overlays, never the video. (The parameter is still spelled `player` -- existing OBS scenes already reference it -- even though the UI now calls this box "Participant".) |
| `plate` | `1` forces the name plate on. Normally the plate follows the **Name plate** option in the user's Participant section (server default on the Settings tab). |
| `audio` | The player view always plays the player's audio; `0` makes it silent. Whether it reaches the OBS mixer is OBS's own "Control audio via OBS" on the source. |
| `reactions` | Both kinds float the player's reactions up the box; `0` keeps a source clean. |
| `debug` | `1` shows connection messages on the page. |

The link never needs a room in it: the view page already knows which room the player is
actually in right now (the same live presence that lets it follow them from room to room) and
automatically uses that room's own pictures for a slot when it has any, falling back to the
Default Images otherwise -- one link keeps working correctly as someone moves between rooms
with different picture sets.

In OBS: Sources, +, Browser, paste the link, set width and height, and untick "Shutdown source
when not visible". With Coffee Pub Studio you skip all of this: its Tavern tab creates and
maintains both sources for you.

Kick and mute-microphone buttons are on the manage page next to each player who is at the
table.

## Settings

The manage page's Settings tab has seven sections. **Server**: the icon (any image; used in the
header, as the favicon and on the sign-in page) and the **server name** shown in the header and
browser tab. **Sign-in page**: a **background** picture that fills the page behind the sign-in
box, and the text under the password field. Click either picture to change it, the small **x**
over its corner to clear it. **Sign-up**: turn self-service `/register` on or off, and generate
invite links into specific rooms -- see Accounts, above. **Participant video defaults**: talking
border, its colour and width in pixels; the name plate, its **Layout** (one of six corner/edge
positions, including a full-width strip flush with the bottom), **Box Color**, **Font Color**,
**Font Size** and **Nameplate Transparency**; and the **Video Background Color** and
**Portrait Size** behind the Participant box's picture -- server-wide, the same for everyone.
**Guest images**: the Participant picture set a guest shows instead of a real member's own --
see Accounts, above. **Reactions**: the emoji tray at the table and on stream; add, remove,
reorder, edit glyph and label, or leave it empty to turn reactions off. **OBS access**: the
stream key. Room images are square; anything else is cropped to the middle.

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
| `public/register.html` | Self sign-up and invite acceptance |
| `public/room.html` | The table |
| `public/profile.html` | A player's profile: their own photo, defaults, and a section per room |
| `public/admin.html` | Manage page |
| `public/roomconfig.html` | A room's own config page |
| `public/view.html` | OBS view |
