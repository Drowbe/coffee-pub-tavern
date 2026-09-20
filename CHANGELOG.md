# Changelog

All notable changes to Coffee Pub Tavern. Format follows Keep a Changelog, and versions follow SemVer.

## [Unreleased]

### Added
- The conference is a pane like the chat and the modules, and it can be closed. The hang-up button now leaves the call and keeps you in the room, with the chat and the modules still open; your tile goes for everyone else, and your microphone, camera and incoming audio and video stop. The Modules menu offers "Rejoin call", and while the conference is closed the Modules button is shown in the header. Leave room, in the header, is what leaves the room. The conference is the flexible column when it is docked, otherwise the first docked pane takes the leftover width, and an empty stage says nothing is open. On a narrow window the conference stays as a strip above the chat instead of being replaced by it.
- Two permissions in a new Panes group on the Roles tab: "See and join the conference" and "Open and read the chat". Everyone has both by default. The first is enforced in the LiveKit token: a role without it joins for the chat and modules only.
- `/api/table` reports `inCall` for each person. Anyone in the room is online whether or not they are in the conference; the aside tools refuse someone who is not in it.

Verified in a browser with forced states (no LiveKit server here): the columns with and without the conference, the chat as the flexible column, the empty hint, the menu under the header button and above the toolbar button, the narrow strip layout, the Roles grid, and the tokens for an admin, a join with the call off and a role without the conference. Not verified: a real call, two people, closing and rejoining the conference, and hang-up in a pop-out window.

### Changed
- The Modules tab of Manage lists Chat and Conference first, as built-in modules that are always on and cannot be removed. Every other module is listed beneath them.
- The toolbar has one button for panes: the Modules button (the puzzle piece), always shown, whose menu lists Chat and the room's modules. The separate chat button is gone; C still toggles the chat, and the chat's unread count shows on the Modules button. The menu now opens just above the button (or above More when the button has been tucked into it) instead of at the toolbar's right end. Verified in a browser: the menu centered on the button, Chat and Calendar listed, Chat opening and closing from it, and the unread badge. Not verified in a real call.

### Added
- Chat is a pane like a module: docked beside the video (the default), a floating panel, or a window of its own, with the same header buttons a module has. The chat's width is now one of the docked columns.
- Panes follow the call when it is popped out: chat and modules open in the popout window, docked or floating as they were, instead of floating over the main window.
- Module frames authenticate the host with a per-frame secret in the frame's address, instead of checking which window a message came from (which is wrong when the call has been popped out).

### Fixed
- The Calendar page opened over a call showed nothing: the overlay adds `room=<name of the room>` to every page it opens, and the module page took that as a room id. A module popped out of a room now carries its room as `moduleRoom`.

Verified in a browser with forced states: chat docked, floating, docked again and closed, with the columns following (video, chat, Calendar; Calendar alone when chat closes); dragging the chat edge; and the call stage moved into a stand-in second window, where the chat and the Calendar (with its Add event bar) worked and the columns shrank to keep room for the video. Not verified: a real popped-out window and the chat in a window of its own (the test browser blocks popups), a real call, and two people.

### Added
- Module action bars: `tavern.bar.set([...])` gives a module buttons the host draws along its bottom. Docked, the bar is a cell in the room's shared bottom row, so the Calendar's Add event button sits beside the video toolbar and the chat box; elsewhere it is a strip under the module. A manifest that does not list modes can now be docked or floating (Calendar 1.0.0 could only float because its manifest never said otherwise). Calendar 1.2.0 uses the bar and replaces 1.1.0.
- Modules can dock. A module whose manifest lists `dock` opens as a column beside the video and the chat (video, chat, module), with a header the host draws at the shared height and a drag handle to set its width. A pane can be switched between docked and floating, or opened in a window of its own (`/modules/<id>?moduleRoom=<room>&popout=1`); the choice and width are remembered per module. On a narrow window a module opens floating, and when the call is popped out docked modules float over the main window until it returns.
- Calendar 1.1.0: it docks by default and, in a narrow pane, shows the month on top with that month's events listed beneath. Events can repeat (daily, weekly, every 2 weeks, monthly, yearly, with an optional end date), and a repeating event's reminders keep coming.
- Repeating schedules for modules: `tavern.schedule({ repeat: { every, until, tz } })`. Tavern computes each next time in the given time zone, keeps the day of the month across short months, and puts the schedule back as it fires.

Verified in a browser against a sandbox server: the module docked as a third column with its header aligned to the chat's, the month-above-list layout in the narrow pane, switching between docked and floating and back, dragging the docked edge (400 to 480 px, remembered), the call-popout conversion and restore, the module popout page with a room in its address, and a repeating schedule firing and putting itself back for the next day. The repeat and Save logic were also run under jsdom against a fake SDK. Not verified: a real popped-out window opened by the pop-out button, two people, a real call, and the Save fix in a real browser (the sandbox flag is the standard cause of the symptom, but I could not reproduce it in the test browser).

### Fixed
- The Calendar's Save did nothing in a real browser: a sandboxed frame without `allow-forms` swallows a form's submit event. Module frames now allow forms (their policy still forbids submitting one anywhere), and the Calendar saves from the button as well as from the form.

### Added
- Modules run now. A module page is served sandboxed, with the SDK and base styles injected; modules read and write their own data per server or per room with versions and live changes, add permissions to the Roles grid, get a header item and a page (`/modules/<id>`), open as draggable floating panels from a Modules button in the call, are switched on per room from the room's page, and can schedule reminders and send notifications (toasts and unread counts). New server files `modules.js` (runtime helpers), `module-data.js` and `module-hooks.js`; new pages and scripts `module.html`, `module.js`, `module-host.js`, `room-modules.js` and `sdk/tavern.js`.
- The Calendar module (`modules/calendar`, built zip in `modules/dist`; the first version was 1.0.0, replaced by 1.1.0 above): a month grid and an upcoming list, events with reminders, for the server and for each room, updating live. `tools/build-module.mjs` builds a module zip from a source folder.
- Verified in a browser against a sandbox server: the SDK from inside a sandboxed frame (ready, permissions, storage with a version conflict, blocked network, parent and cookie access), live changes and schedule events reaching the frame, a schedule set from the frame firing a notification and toast, permission checks by role, per-room enablement, panel drag and resize, and the Calendar's month and list views in the page and in a room panel. Not verified: two people at once, a real call, real Chrome and Safari behavior for a sandboxed frame, and the Calendar form in a real browser (the frame could not be driven by the test tools). The Calendar's form and logic were instead run under jsdom against a fake SDK: adding an event with a reminder scheduled it the right time ahead, editing hit a version conflict message, deleting cancelled the reminder, a server event was read-only in a room, and a live change appeared.

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
