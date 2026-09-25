# Navigation Architecture

**Audience:** developers changing the header on any page of Coffee Pub Magpie (`public/brand.js`, `public/room.js`, `public/style.css`), or adding a control to it.

The header is two rows, and each row is three zones. The rows are about different things and never borrow from each other; a control belongs to exactly one zone, chosen by what it is about and what it does, never by where it happens to fit.

## The primary nav: the system

`.topbar`, built by `renderTopbar()` in `public/brand.js`, the same on every page. The markup it writes is only what is not a tool (the logo, the crumb, the status, the menu button); the middle and right zones are drawn from the registry (below).

| Zone | Class | Holds |
|---|---|---|
| Left | `.nav-left` (`.brand`) | the logo and server name (the home link), the crumb saying where you are (`#topbar-crumb`, `setTopbarLocation()`), the status line |
| Middle | `.nav-middle` (`#core-nav`) | the core navigation, one group: Spaces (`#rooms-link`, order 1) and each module's own page (`page-<module>`, orders 11 and up, class `module-nav-link`, hidden at the table where the room's own module selector is the way in) |
| Right | `.nav-right` (`.links`) | the system's actions and information, three groups with a divider between: you (`#whoami-link`), the system (Manage `#admin-link`, Install `#install-link`), the session (Call settings at the table, the time `#topbar-clock` on the server's clock setting, Sign out `#logout-link`) |

## The secondary nav: the space

`.subnav`, built in `public/room.js`, only in a space (`body.in-space`). Its left zone is markup; its right zone is drawn from the registry, and it is the bar a module's tools go into.

| Zone | Class | Holds |
|---|---|---|
| Left | `.nav-left` | the room's name (`#space-name`, set by `updateCrumb()`), then the module selector (`#modules-menu`: the switches for the conference, the chat and the room's modules, rendered by `public/room-modules.js`) |
| Middle | `.nav-middle` (`#subnav-middle`) | the space's information and navigation: nothing of the system's yet; a module may register here |
| Right | `.nav-right` (`.subnav-tools`) | the space's actions, one group: Dock all (`#dock-all`, every floating pane back beside the call), the stage-level snap (`#snap-all`) and its grid slider (`#snap-size`), Full screen (`#fullscreen-toggle`), Pop out (`#popout`), Pull participants back (`#recall-button`, during an aside), Rejoin call (`#rejoin-call`, in an aside); then, after a divider, a module's own groups; then Leave (`#leave-room`, order 999) last |

## The registry: one drawing path

`public/nav-bar.js` is what both bars draw from. A tool is a registration, `{ id, bar, zone, icon, label, title?, order?, group?, groupOrder?, href? | onClick, visible?, toggleable?, active?, badge? }`, and the registry draws it and owns its look: an icon button (`.icon-link`) everywhere but the primary nav's middle zone, where a tool is the core navigation's icon and name (`.core-link`); a tool with `href` is a real link. Three things only the page's own tools may add: `element` (an element the registry places and orders but does not draw: the profile link, the clock, the snap slider), `labelled` (a small text button with its icon: Pull participants back) and `activeIcon` (what a toggle shows while on).

- **Groups and bands.** Tools sit in groups, a divider between groups that show something; groups sort by `groupOrder` (the smallest any tool of the group names, or its first tool's order), tools by `order`, ties by registration. The bands are 1-10 core, 11-50 secondary, 51-100 utility, 101-998 a module's own, 999 last, so the system's tools are ahead of a module's without anyone coordinating numbers. `tools/check-nav.mjs` holds these rules.
- **Visibility and state.** `visible` is a boolean or a function (Rejoin call reads whether the room is an aside; Install reads whether the browser offered to install); a tool that leaves it out is shown, and other code may toggle its element's own `hidden` (Manage, which each page shows once it knows the viewer is an admin). A `toggleable` tool carries `active` and is changed by `nav.setActive(id, on)`, a count by `nav.setBadge(id, n)`, both in place, never by registering again. `nav.draw(bar)` redraws after something a `visible` function reads has changed.
- **A module's tools** arrive through `host.nav.set` (module-host.js, the `nav.set` handler) under the module's own namespace (`<module>:<id>`, its own group, orders clamped into 101-998), are drawn while the module's pane is open in the space and taken out when the pane closes or the module is unmounted, and click back as the module's `nav` event. They go in the secondary bar. The primary bar takes a module's registration only for a system-wide tool (`system: true`) from a module the admin allowed into the primary nav (`surfaces.page.nav`), and only into the right zone; anything else is refused with a clear error. The contract is in [api-module-sdk](../api/api-module-sdk.md), "Registering into the nav bars".

## Rules

- **The middle is centred on the row.** Each row is a grid of `minmax(0, 1fr) auto minmax(0, 1fr)`, so the middle zone sits in the same place whatever the left and right zones hold; the left zone justifies its content to the start, the right to the end.
- **Two builders, one registry, no others.** `brand.js` builds the primary nav and `room.js` the secondary; both register their controls into `nav-bar.js`, which draws them. A page that wants a control in the header registers a tool, never appends markup of its own.
- **Phones keep the meaning, not the place.** Below 640px the primary nav is a row of the logo, the crumb and a menu button; the registry draws the middle zone's tools into the menu (the right zone's element), ahead of the right zone's, and back into the middle when the window widens (the registry watches the width itself). The secondary nav becomes the tab bar at the bottom of the page: the pane switches are the bar, the room's name and the middle zone are not drawn, and of the right zone only Leave stays (see [architecture-room-layout](architecture-room-layout.md), "Phones").
- **Popped out, the header goes too.** Pop out moves the header with the stage into the popup, so every control works where you are; the registry keeps the zone elements, not selectors, so it follows them. See the room layout document.

## What is not built yet

What each zone should grow to hold is being worked out zone by zone in `documentation/plans/plan-nav.md`; bar-level notices (a notice with a duration and a pulse in a middle zone) are a later step there.
