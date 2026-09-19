# Changelog

All notable changes to Coffee Pub Tavern. Format follows Keep a Changelog, and versions follow SemVer.

## [Unreleased]

### Changed
- On a narrow window the toolbar now collapses chat, then camera, then the microphone into the More menu after the other buttons, so the smallest bar is just More and leave. The More menu wraps long labels and stays within the bar. Verified in a browser at 360, 270 and 190 px wide, and by shrinking the stage to 170, 130 and 100 px; not verified in a real call.
- The room page is now a grid of module columns, each a content area over an action bar, with the bars sharing one bottom row: the video toolbar sits under the video and the chat message box under the chat, lined up. The chat is a real column instead of an overlay, the popped-out toolbar is a floating bar over the video, and on a narrow window chat replaces the video with the toolbar still under it. The measured toolbar height and hand-subtracted chat width are gone, and a check (`tools/check-room-layout.mjs`, part of `npm run check`) keeps them out. Verified in a browser with forced states: docked with chat open, popout, narrow width with chat open and closed, and the settings popover position. Not verified in a real call.

### Added
- Themes have a Card background, for the small items inside a section (member tiles, facts, thumbnails), on
  Auto by default. The Card background used to be the section color; that one is now Section background,
  its variable is `--bg-section`, and themes saved with the old field name are migrated on start.
- Themes can now set the header background and text, icon color and hover, Primary accent hover, and the
  Secondary accent with its text and hover, each on Auto (derived) until set. Buttons gain a stronger
  hover with a border and glow, and a press effect.

### Fixed
- The logo in the header filled 40px in a 43px bar, leaving a gap above and below; it now fills it.

Verified in a browser on the Theme tab: Auto values resolve to the right colors, setting them applies
live to the header and buttons, a saved theme's `/theme.css` carries only the values it sets, and the
logo is 43px in a 44px bar. Not checked on the room page or in a call.

### Changed
- Documentation moved into `documentation/` following the Coffee Pub documentation standard:
  `README.md` is now the product page, the guides are in `userguides/`, the OBS link contract is in
  `api/api-obs-view.md`, and the design notes are in `architecture/`. The old `DESIGN.md`, root
  `TODO.md` and `docs/MODULES.md` were folded into it. Added `tools/wiki-sync.mjs` and
  `tools/check-docs-structure.mjs`, copied unmodified from coffee-pub-studio, and a `module.json` for
  them to read. Verified by running `node tools/check-docs-structure.mjs` (passes) and
  `node tools/wiki-sync.mjs build` (builds 14 pages, Home and a sidebar); the guides themselves have
  not been walked in a running server.

## [0.3.0]

### Added
- Roles and permissions: four fixed roles (admin, moderator, user, guest) with a grid of checkboxes on
  the Manage page, enforced by the server, including per-image permissions. Per-room Moderator.
- Per-room member settings: remove a member, use default profile images or the room's own, and
  moderator. Room pictures now show on call tiles and on the room list.
- Manage tabs reordered and renamed: Server, Theme, Rooms, Roles, Users, Modules, About. The Theme tab
  holds theme colors, Default Images, Guest images, Reactions and a Font Awesome icon list that now
  drives the room launch-link and home icon pickers.
- Modules, step 1: upload a zip on the Modules tab, review and approve what it asks for, enable it,
  roll back among the newest three versions, uninstall with or without its data. Nothing a module does
  is visible to players yet.
- Away message: the away button asks for an optional multi-line message shown on your tile.
- Join a room straight into a pop-out window from the room list.

### Changed
- Chat, popups, tile name labels and the muted badge follow the theme, so light themes are readable.
- Chat emoji picker offers the same list as the reactions tray. Replies no longer leave a blank gap
  under the quote.

Verified in a browser against a sandbox server with the LiveKit connection unavailable, so anything
that needs a live call (tile names and away messages on other people's screens, kick, mute, asides)
was checked by reading the code only.
