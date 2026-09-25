# Stream: the module's contract

**Audience:** whoever changes the Stream module, or the host conduits it stands on.

## What it is

Every player as a browser source for a streaming program: one box per player on a transparent background, the camera or their pictures, the talking and muted borders, the name plate, dimmed or tinted while they are away. Two surfaces:

- **The keyed page** (`surfaces.keyed`, path `view`): `/view/<key>?s=<access key>&kind=player|character`, one player's box. Opened by the streaming program, never by a person who is signed in; the access key stands in for the sign-in. Runs in the page, because the host draws the media into it.
- **The module's own page** (`surfaces.page`): the links for every player (Player and Character, each carrying the access key), and the key itself with show, copy and regenerate. Behind the `links` permission (admins always).

The link's shape, its query options and which pictures a box draws are the contract Coffee Pub Studio and every existing browser source rely on; they are documented in `documentation/api/api-obs-view.md` and must not change without that document changing.

## What it takes from the host

- `host.settings.get()` and `onChange`: the box settings (borders, plate, picture, dim and tint), all server-scope, declared in `module.json` with the same keys the host's own settings once had (`install.settingsFrom: "server"` carried them over on the first install).
- `host.presence.get()` and `onChange`: who is online, in which room, whether an admin is online and which room the stream follows (`activeRoom`), the rooms (an aside is `ephemeral` with an `origin`; a private conversation is `private`), and the reaction glyphs.
- `host.images.get(key, slot, { room })`: the pictures, per room set.
- `host.media.watch(key, { video, audio, room }, handlers)`: the read-only viewer connection the host keeps; `follow(room)` when the roster says they moved.
- `host.access.key()` and `regenerate()` on the links page.

Nothing here reaches the server directly; a keyed page has no session, and its api calls carry the key because the host's page put it there.

## Behaviour that must stay

- A private conversation never shows the live camera and always reads as muted, whatever the settings.
- Aside dim and tint apply relative to the stream (`activeRoom`) only while an admin is online; the Aside overlay picture applies to whoever stepped away themselves.
- Dim and tint are independent and are not gated on a picture being there.
- The Character box never plays audio and never shows video; it subscribes to the microphone only to know who is talking.
- Which picture: the Participant box shows the Online picture (or the Offline one away from the call) from the room's own set, then the person's own, then the server's Default Images, and only when none of those is set the person's profile photo (the real photo, never the initials plate). The Character box shows Character pictures only and never a profile photo.
- Older links with `mode=` keep working.
