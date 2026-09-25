# Coffee Pub Magpie

**Audience:** anyone deciding whether to run Coffee Pub Magpie, or looking for where to read more
about it.

Self-hosted voice and video for a tabletop game. Each player signs in once with a login and password, or
with a personal link, allows camera and microphone, and is in. Nothing to install. Every player is
also available to OBS as a separate Browser Source: their camera, or a set of pictures the game
master assigns when the camera is off. It is built for recording Foundry VTT sessions alongside
Coffee Pub Studio, and it runs on your own server; nothing about your calls is sent to anyone else.

Known defects and their workarounds are in [Known issues](known-issues.md).

## Running Magpie

- [Getting started](userguides/userguide-getting-started.md) -- running the server and signing in
  for the first time.
- [The call](userguides/userguide-call.md) -- joining a space, the controls, chat, reactions,
  away, and the pop-out window.
- [Accounts, roles and permissions](userguides/userguide-accounts.md) -- who can do what, guests,
  invites, and personal links.
- [Spaces](userguides/userguide-spaces.md) -- the Lobby, a space's settings, members, and stepping aside.
- [Participant and Character images](userguides/userguide-images.md) -- the pictures OBS shows for
  each player.
- [Magpie in OBS](userguides/userguide-obs.md) -- adding a player to OBS by hand.
- [Manage](userguides/userguide-environment-settings.md) -- every tab of the Manage page, where an environment is set up.
- [Creating themes](userguides/userguide-themes.md) -- the colours, light and dark, and sharing a theme as a file.
- [Your environment](userguides/userguide-environments.md) -- an owner's view on a hosted server: the plan, the caps, a copy, leaving.
- [Templates](userguides/userguide-templates.md) -- setting an environment up for one use when it is made, such as Travel.
- [Modules](userguides/userguide-modules.md) -- adding features with a module zip.
- [Calendar](userguides/userguide-calendar.md) -- events and reminders, for the environment and for each space.

## For developers

- [OBS view links](api/api-obs-view.md) -- the URL contract for a player's OBS page.
- [Module SDK](api/api-module-sdk.md) -- writing a module: the manifest, the SDK, and the sandbox.
- [Modules API](api/api-modules.md) -- the routes for installing, managing and running modules.
- [Theme and design tokens](designsystem/design-theme.md) -- the colors every page, and every
  module, must draw from.
- [Architecture overview](architecture/architecture-overview.md) -- the pieces, the technology,
  and where the code lives.
- [Modules architecture](architecture/architecture-modules.md) -- how module install and storage
  are built.
- [Canvas architecture](architecture/architecture-canvas.md) -- the canvas: its grid of modules, docked
  and floating, and the layout rules.
- [Module window architecture](architecture/architecture-module-window.md) -- the titlebar, toolbar and
  action bar the host draws around every module.
- [Navigation architecture](architecture/architecture-navigation.md) -- the header's two bars and the nav
  registry.
- [Environments architecture](architecture/architecture-environments.md) -- one host, many environments:
  the seam, the host console, the roles and the Names migration.

See the [repository README](https://github.com/Drowbe/coffee-pub-tavern) for requirements and the
short install summary.
