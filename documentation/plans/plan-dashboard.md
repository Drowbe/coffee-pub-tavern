# Dashboard Plan

**Audience:** whoever is building the rooms page and the modules system, and the author deciding what comes next.

**Status:** Built: the contract, the dashboard on the rooms page, Who is around, the Calendar, To-do and Polls widgets, opening an item in its room's pane, and retiring the header items for modules that have a widget. What is left is the open questions and customising the layout. The decisions below were made with the author.

## What it is

A dashboard on the rooms page, in a sidebar on the left with the room cards in two columns on the right under a Who is around strip, across all of a person's rooms: what is coming up, what is due, which polls need a vote, and who is around. It replaces the dedicated module pages in the header. It is made of widgets, small views that modules provide and Magpie hosts.

## Decisions

- **It replaces the module server pages in the header.** The header no longer lists a page per module. A widget can still open the module's full view: clicking the Calendar widget opens the full calendar view, as its server page does today. The pages stay; the header items go.
- **Phase 1 is laid out by us.** A fixed order chosen in the code and the manifests, the same for everyone. Customising the layout (hide, reorder, or an admin layout) is a later step.
- **First widgets:** Calendar "coming up", To-do "due soon", Polls "need your vote", and who is around (Magpie's own).
- **Magpie names no module.** A widget is whatever a module says it is, hosted the same way for any module; a module installed later can provide one with no change to Magpie.

## The widget contract (proposed)

- **Manifest.** `surfaces.widget: { entry, title, size, order }`: an HTML file like the other surfaces, a heading, a size (`small`, `medium` or `wide`, in columns of the dashboard grid) and where it sits relative to the others. Validated in `server/modules.js` like the other surfaces.
- **Where it runs.** In the page for a module that ships with Magpie, in a sandboxed frame for an uploaded one, exactly as the other surfaces do; it uses the same SDK.
- **What it reads.** The viewer's own rooms, through the read that already gives a module its data across rooms (`rooms-data`), checked by the module's read permission in each room. A widget also gets the server scope for a module that has server data.
- **Listing.** `GET /api/modules/widgets` returns the enabled modules with a widget the viewer can see, in order, so the rooms page draws them.
- **Live.** Widgets update from the same shared stream as every other module surface.
- **Opening things.** A widget item is a pointer (`host.refs.open`). On the dashboard, opening one takes the person into that item's room with the module's pane open on it (the room page reads a request to open a module on a pointer when it joins). Opening the widget's heading opens the module's full view.
- **Who is around** is a core widget, drawn by the rooms page from what it already knows.

## Phases

1. **The contract and the first widget.** `surfaces.widget` in the manifest, the listing route, the host on the rooms page (a section below the room list), Who is around, and the Calendar widget, opening the Calendar view from its heading.
2. **The rest of the first set and opening items.** To-do and Polls widgets; opening an item takes you into its room with the pane open on it.
3. **Retire the header items.** The header stops listing module pages; each module's full view stays reachable from its widget.
4. **Later.** Customising the layout, and a widget for the Travel planner or any module that wants one.

## Later additions

- Who is around shows everyone who is online, in a room or not, from a presence signal every page sends, and offers an invitation to a private conversation of two.
- Each widget item shows its room's icon on the left and an arrow on the right.

## Open

- What the Calendar widget lists and how far ahead (a first guess: the next seven days, each with its room's icon, newest first).
- Whether a module with no widget still appears anywhere once its header item is gone. A first answer: only in the room's panes.
- The dashboard on a phone: one column, with who is around and the rooms first and the sidebar widgets below them (decided; built).
- Guests have no dashboard; they are in one room.
