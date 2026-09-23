# Navigation: two rows, six zones

**Status:** decided September 23, 2026 (the author's sketch); the frame is built, what fills each zone is being worked out zone by zone.

## The model

The header is two rows, and each row is three zones: **left** (left-justified), **middle** (centred), **right** (right-justified). The rows are about different things and never borrow from each other:

**Primary nav: the system.** The same on every page.

| Zone | What it is for | Today |
|---|---|---|
| Left | The logo (home), where you are, and quick actions (to be defined) | the server icon and name (the home link), the crumb ("> Lobby", "> Server Settings") |
| Middle | Core navigation, system-level: the rooms (to be renamed, "spaces" or something less literal, still open), and more to come | Rooms, and each module's own page |
| Right | System-level actions and system information: settings, your profile, sign out, install; a clock | your profile, Manage, Install, Sign out, and the time on the server's clock (12- or 24-hour, the Language, time and money setting) |

**Secondary nav: the space.** Only at the table (a room), under the primary nav.

| Zone | What it is for | Today |
|---|---|---|
| Left | The room's name, and the module selector | the room's name, then the pane switches (conference, chat, the room's modules) |
| Middle | Space information and space navigation (both to be defined) | empty |
| Right | Space actions: layout, snap, close, and so on | the stage-level snap and its grid slider, Full screen, Pop out, Pull participants back (when there is an aside), Leave room |

## Rules

- A control belongs to exactly one zone, chosen by what it is about (the system or the space) and what it does (navigation, action, information), not by where it happens to fit. Adding a control means naming its zone.
- The middle zone is centred on the row, not on what is left over: the row is a three-column grid (`1fr auto 1fr`), so the core navigation sits in the same place whatever the left and right zones hold.
- The markup is the same on every page: `public/brand.js` builds the primary nav (`.topbar` with `.nav-left`, `.nav-middle`, `.nav-right`), `public/room.js` builds the secondary (`.subnav` with the same three). Nothing else adds to the header; a page that wants a control in it asks one of these two.
- On a phone (below 640px) the primary nav keeps the logo, the crumb and a menu button; the middle and right zones fold into the menu. The secondary nav is the tab bar at the bottom of the page: the left zone (the pane switches) is the bar, the right zone keeps only Leave. The zones do not change meaning, only where they are drawn.

## Modules register into the bars (next; from the author's Blacksmith menubar)

The author's Blacksmith module (its `api-menubar` wiki page) has the same idea, a bar in three zones that modules register tools into, and its shape is adopted here where it fits:

- **One registration, not markup.** A tool is `{ id, bar: 'primary' | 'secondary', zone: 'left' | 'middle' | 'right', icon, label, title?, order?, group?, groupOrder?, href? | onClick, visible?, toggleable?, active?, badge? }`; the host draws it and owns its look. The page's own controls (Rooms, Manage, the snap switch, Leave...) become registrations of the same shape, so there is one drawing path, not two.
- **Groups and order.** Tools sit in groups (a divider between), groups by `groupOrder`, tools by `order`; the bands Blacksmith uses (1-10 core, 11-50 secondary, 51-100 utility, 101-998 a module's own, 999 last) keep the system's tools ahead of a module's without anyone coordinating numbers.
- **Visibility and state.** `visible` is a boolean or a function (a tool for the room's owner, a tool only while in the call); `toggleable` tools carry `active` (the stage-level snap, full screen), updated in place (`setActive`), never by re-registering.
- **A module's tools come and go with it.** `tavern.nav.set([...])` from a module registers into the secondary bar under the module's own namespace (a module cannot touch another's, nor the system's), drawn while its pane is open in this room and removed when it closes; the primary bar takes a module's registration only for a system-wide tool (its own page's link is already there), and only from a module the admin has allowed there.
- **Notifications** (Blacksmith's middle-zone notices with a duration, a click and a pulse) are a later step here: the primary nav's right zone already carries the unread badge, and the toast exists; whether a bar-level notice adds something is to see.
- **Not taken:** Blacksmith's secondary bars as tab-like toolbars that open one at a time under the main bar are its own thing (a game table's toolbars); here the secondary nav is the space's bar, always there at the table, and a module's toolbar is its own pane's (`tavern.toolbar.set`).

## Open, zone by zone

- Primary left: what the quick actions are (a new room, a search, a notification tray?).
- Primary middle: what else is core navigation beyond the rooms and module pages -- the dashboard, a person's own things (their research, their places)?
- The name for rooms ("spaces"?), and whether the crumb and the secondary nav's room name should both show the room at the table (today they do).
- Secondary middle: the space's information (who is here, the call's state, the time in the call) and space navigation (the views of the space?).
- Secondary right: whether the layout choice (docked, floating, snap) grows into one layout menu rather than several buttons.
