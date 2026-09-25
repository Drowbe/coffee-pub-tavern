# OBS View Links

**Audience:** someone building an integration, or adding a player to OBS by hand, who needs the exact
form of a Coffee Pub Magpie view URL.

Every player has two view pages, each on a transparent background, meant to be loaded as an OBS
Browser Source. Coffee Pub Studio builds and maintains them automatically; this is the contract it and
any other caller relies on. How to add one by hand is in
[userguide-obs](../userguides/userguide-obs.md).

The pages are served by the bundled **Stream** module, which claims the `view` path as its keyed page
(see "Keyed pages" in [the SDK guide](api-module-sdk.md)). The URL, its parameters and the pictures
below are the same whichever code answers. With the module turned off or uninstalled, a view URL answers
404 with a sentence saying which module serves it; `GET /api/status` lists the keyed paths currently
served in `pages` (`"view"` among them while the module is on), so a caller can tell before it loads
one.

## The URL

```
https://host.<domain>/view/<key>?s=<stream key>&kind=player
https://host.<domain>/view/<key>?s=<stream key>&kind=character
```

`<key>` is the player's account key, the eight-character identifier that never changes when a login or
display name does. The page needs no sign-in; the stream key stands in for it.

| Parameter | Meaning |
| --- | --- |
| `s` | The **stream key**, shown under **Access key** on the Environment tab of the Manage page. Required. Regenerating it makes every existing link stop working. |
| `kind` | `player` (default): the camera, the Participant picture when it is off, the talking and muted borders and the overlays. `character`: the Character pictures and their overlays, never the video. |
| `plate` | `1` forces the name plate on. Normally the plate follows the player's own **Name plate** option, whose default for everyone is in the Stream module's settings. |
| `audio` | The player view always plays the player's audio; `0` makes it silent. Whether it reaches the OBS mixer is OBS's own "Control audio via OBS" option on the source. |
| `reactions` | Both kinds float the player's reactions up the box; `0` keeps a source clean. |
| `debug` | `1` shows connection messages on the page. |

The parameter is still spelled `kind=player` for the Participant box because existing OBS scenes
already reference it.

## Which space and which pictures

A link never carries a space. The view page reads which space the player is in right now, the same live
presence that lets it follow them from space to space, and uses that space's own pictures for a slot when
the player has set any there (with **Use Default Profile Images** off). Otherwise it falls back to the
player's defaults, then to the environment's Default Images, and, for the Participant box only, to the
player's profile photo when no Participant picture is set anywhere (the real photo; never the initials
plate, and never for the Character box). One link keeps working as someone moves
between spaces with different picture sets. While someone is in a private aside, their pictures come
from the space they were pulled out of.

## Pictures over HTTP

The view page reads its pictures from `GET /img/<key>/<slot>`, which accepts the stream key as `s`.
Two optional query parameters matter to callers:

- `space=<space id>` resolves the slot the way the view page does for that space.
- `spaceOnly=1` returns only a picture set specifically for that space, and 404 otherwise, with no
  fallback to the player's defaults.

These were `room=` and `roomOnly=1` before step 5a of the Names plan. An address with the old names still
works: it answers a permanent redirect (301) to the same address with `space=` and `spaceOnly=1`, keeping the
rest of the query, so an OBS source or a Studio setting made earlier keeps working. A space's own picture is
`GET /img/space/<id>`; `/img/room/<id>` redirects to it the same way.

Slots are `profile`, `background`, `playerOffline`, `player`, `playerTalking`, `playerMuted`,
`playerAside`, `playerPrivate`, `characterOffline`, `character`, `talking`, `muted`,
`characterAside` and `characterPrivate`.
