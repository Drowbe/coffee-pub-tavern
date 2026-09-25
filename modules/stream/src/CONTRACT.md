# Stream: the module's contract

**Audience:** whoever changes the Stream module, or the host conduits it stands on.

## What it is

Every player as a browser source for a streaming program: one box per player on a transparent background, the camera or their pictures, the talking and muted borders, the name plate, dimmed or tinted while they are away. Two surfaces:

- **The keyed page** (`surfaces.keyed`, path `view`): `/view/<key>?s=<access key>&kind=player|character`, one player's box. Opened by the streaming program, never by a person who is signed in; the access key stands in for the sign-in. Runs in the page, because the host draws the media into it.
- **The module's own page** (`surfaces.page`): the links for every player (Player and Character, each carrying the access key), and the key itself with show, copy and regenerate. Behind the `view_page` permission ("See the Stream page", off by default for members, moderators and guests; owners and the admin always have it; it `replaces` the old `links` permission, so each role keeps the choice it had). The links and the key show only for an owner or the admin, the only people the server hands the key to; anyone else sees "Only an owner or the admin sees the links, since each one carries the access key."

The link's shape, its query options and which pictures a box draws are the contract Coffee Pub Studio and every existing browser source rely on; they are documented in `documentation/api/api-obs-view.md` and must not change without that document changing.

## What it takes from the host

- `host.settings.get()` and `onChange`: the box settings (borders, plate, picture, dim and tint), all environment-scope, declared in `module.json` with the same keys the host's own settings once had (`install.settingsFrom: "environment"` carried them over on the first install).
- `host.presence.get()` and `onChange`: who is online, in which space (`space`, an aside's id while they are in one), whether an owner is online (`ownerOnline`) and which space the stream follows (`activeSpace`), the asides (each with its `origin` space and whether it is `private`), and the reaction glyphs.
- `host.images.get(key, slot, { space })`: the pictures, per space set.
- `host.media.watch(key, { video, audio, space }, handlers)`: the read-only viewer connection the host keeps; `follow(spaceId)` when the roster says they moved.
- `host.access.key()` and `regenerate()` on the links page.

Nothing here reaches the server directly; a keyed page has no session, and its api calls carry the key because the host's page put it there.

## Behaviour that must stay

- A private conversation never shows the live camera and always reads as muted, whatever the settings.
- Aside dim and tint apply relative to the stream (`activeSpace`) only while an owner is online; the Aside overlay picture applies to whoever stepped away themselves.
- Dim and tint are independent and are not gated on a picture being there.
- The Character box never plays audio and never shows video; it subscribes to the microphone only to know who is talking.
- Which picture: the Participant box shows the Online picture (or the Offline one away from the call) from the space's own set, then the person's own, then the environment's Default Images, and only when none of those is set the person's profile photo (the real photo, never the initials plate). The Character box shows Character pictures only and never a profile photo.
- Older links with `mode=` keep working.
