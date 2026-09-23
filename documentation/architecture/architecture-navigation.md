# Navigation Architecture

**Audience:** developers changing the header on any page of Coffee Pub Tavern (`public/brand.js`, `public/room.js`, `public/style.css`), or adding a control to it.

The header is two rows, and each row is three zones. The rows are about different things and never borrow from each other; a control belongs to exactly one zone, chosen by what it is about and what it does, never by where it happens to fit.

## The primary nav: the system

`.topbar`, built by `renderTopbar()` in `public/brand.js`, the same on every page.

| Zone | Class | Holds |
|---|---|---|
| Left | `.nav-left` (`.brand`) | the logo and server name (the home link), the crumb saying where you are (`#topbar-crumb`, `setTopbarLocation()`), the status line |
| Middle | `.nav-middle` (`#core-nav`) | the core navigation: Rooms (`#rooms-link`) and each module's own page (`#module-nav`, hidden at the table where the room's own module selector is the way in) |
| Right | `.nav-right` (`.links`) | the system's actions and information: your profile, Manage, Install, the time (`#topbar-clock`, on the server's clock setting), Sign out |

## The secondary nav: the space

`.subnav`, built in `public/room.js`, only at the table (`body.at-table`).

| Zone | Class | Holds |
|---|---|---|
| Left | `.nav-left` | the room's name (`#space-name`, set by `updateCrumb()`), then the module selector (`#modules-menu`: the switches for the conference, the chat and the room's modules, rendered by `public/room-modules.js`) |
| Middle | `.nav-middle` (`#subnav-middle`) | the space's information and navigation: nothing yet |
| Right | `.nav-right` (`.subnav-tools`) | the space's actions: the stage-level snap and its grid slider, Full screen, Pop out, Pull participants back (during an aside), Leave room |

## Rules

- **The middle is centred on the row.** Each row is a grid of `minmax(0, 1fr) auto minmax(0, 1fr)`, so the middle zone sits in the same place whatever the left and right zones hold; the left zone justifies its content to the start, the right to the end.
- **Two builders, no others.** `brand.js` builds the primary nav and `room.js` the secondary. A page that wants a control in the header asks one of these (a registration, see "What is not built yet"), never by appending markup of its own.
- **Phones keep the meaning, not the place.** Below 640px the primary nav is a row of the logo, the crumb and a menu button; the middle zone's links move into the menu (`wireNavMenu()` moves the elements themselves, so there is one copy), and back when the window widens. The secondary nav becomes the tab bar at the bottom of the page: the pane switches are the bar, the room's name and the middle zone are not drawn, and of the right zone only Leave stays (see [architecture-room-layout](architecture-room-layout.md), "Phones").
- **Popped out, the header goes too.** Pop out moves the header with the stage into the popup, so every control works where you are; see the room layout document.

## What is not built yet

Modules registering tools into the bars (`tavern.nav.set`) and the page's own controls becoming registrations of the same shape, with zones, groups, order bands, visibility and toggle state owned by one drawing path: decided, in `documentation/plans/plan-nav.md`, not built. What each zone should grow to hold is being worked out zone by zone in the same plan.
