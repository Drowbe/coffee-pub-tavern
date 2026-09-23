# OBS View Links

**Audience:** someone building an integration, or adding a player to OBS by hand, who needs the exact
form of a Coffee Pub Tavern view URL.

Every player has two view pages, each on a transparent background, meant to be loaded as an OBS
Browser Source. Coffee Pub Studio builds and maintains them automatically; this is the contract it and
any other caller relies on. How to add one by hand is in
[userguide-obs](../userguides/userguide-obs.md).

## The URL

```
https://host.<domain>/view/<key>?s=<stream key>&kind=player
https://host.<domain>/view/<key>?s=<stream key>&kind=character
```

`<key>` is the player's account key, the eight-character identifier that never changes when a login or
display name does. The page needs no sign-in; the stream key stands in for it.

| Parameter | Meaning |
| --- | --- |
| `s` | The **stream key**, shown under **OBS access** on the Server tab of the Manage page. Required. Regenerating it makes every existing link stop working. |
| `kind` | `player` (default): the camera, the Participant picture when it is off, the talking and muted borders and the overlays. `character`: the Character pictures and their overlays, never the video. |
| `plate` | `1` forces the name plate on. Normally the plate follows the player's own **Name plate** option, whose server default is on the Server tab. |
| `audio` | The player view always plays the player's audio; `0` makes it silent. Whether it reaches the OBS mixer is OBS's own "Control audio via OBS" option on the source. |
| `reactions` | Both kinds float the player's reactions up the box; `0` keeps a source clean. |
| `debug` | `1` shows connection messages on the page. |

The parameter is still spelled `kind=player` for the Participant box because existing OBS scenes
already reference it.

## Which room and which pictures

A link never carries a room. The view page reads which room the player is in right now, the same live
presence that lets it follow them from room to room, and uses that room's own pictures for a slot when
the player has set any there (with **Use Default Profile Images** off). Otherwise it falls back to the
player's defaults and then to the server's Default Images. One link keeps working as someone moves
between rooms with different picture sets. While someone is in a private aside, their pictures come
from the room they were pulled out of.

## Pictures over HTTP

The view page reads its pictures from `GET /img/<key>/<slot>`, which accepts the stream key as `s`.
Two optional query parameters matter to callers:

- `room=<room id>` resolves the slot the way the view page does for that room.
- `roomOnly=1` returns only a picture set specifically for that room, and 404 otherwise, with no
  fallback to the player's defaults.

Slots are `profile`, `background`, `playerOffline`, `player`, `playerTalking`, `playerMuted`,
`playerAside`, `playerPrivate`, `characterOffline`, `character`, `talking`, `muted`,
`characterAside` and `characterPrivate`.
