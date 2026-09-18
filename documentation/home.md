# Coffee Pub Tavern

**Audience:** anyone deciding whether to run Coffee Pub Tavern, or looking for where to read more
about it.

Self-hosted voice and video for the table. Each player signs in once with a login and password, or
with a personal link, allows camera and microphone, and is in. Nothing to install. Every player is
also available to OBS as a separate Browser Source: their camera, or a set of pictures the game
master assigns when the camera is off. It is built for recording Foundry VTT sessions alongside
Coffee Pub Studio, and it runs on your own server; nothing about your table is sent to anyone else.

Known defects and their workarounds are in [Known issues](known-issues.md).

## Running a table

- [Getting started](userguides/userguide-getting-started.md) -- running the server and signing in
  for the first time.
- [The table](userguides/userguide-table.md) -- joining a room, the controls, chat, reactions,
  away, and the pop-out window.
- [Accounts, roles and permissions](userguides/userguide-accounts.md) -- who can do what, guests,
  invites, and personal links.
- [Rooms](userguides/userguide-rooms.md) -- the Lobby, room settings, members, and stepping aside.
- [Participant and Character images](userguides/userguide-images.md) -- the pictures OBS shows for
  each player.
- [Tavern in OBS](userguides/userguide-obs.md) -- adding a player to OBS by hand.
- [Server settings](userguides/userguide-server-settings.md) -- every tab of the Manage page.
- [Modules](userguides/userguide-modules.md) -- adding features with a module zip.

## For developers

- [OBS view links](api/api-obs-view.md) -- the URL contract for a player's OBS page.
- [Modules API](api/api-modules.md) -- the admin routes for installing and managing modules.
- [Theme and design tokens](designsystem/design-theme.md) -- the colors every page, and every
  module, must draw from.
- [Architecture overview](architecture/architecture-overview.md) -- the pieces, the technology,
  and where the code lives.
- [Modules architecture](architecture/architecture-modules.md) -- how module install and storage
  are built.

See the [repository README](https://github.com/Drowbe/coffee-pub-tavern) for requirements and the
short install summary.
