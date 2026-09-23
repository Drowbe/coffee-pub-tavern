# Travel Planner Plan

**Audience:** whoever is building the Travel module, and the author deciding what it does first.

**Status:** Phase 1 and the dashboard widget are built (the Days view, the trip and its items, moves, the editor, suggestions from other modules, the Decisions view, the actions, the Trips card). Also built: dragging a trip item out to link a task, dropping onto items with the drop menu, following a poll's result, the Bookings view, and money (costs, who paid, sharing, settling up), and the plan line (anything between days as well as on one; see the last section). Left: a map, and the later items. The questions at the end were answered as suggested: one trip per room, order by time then by hand, money and a map later.

## What it is for

A group planning a trip together (where to go, where to stay, what to do, what to book, who does what) in the room the group already talks in. Other modules already collect the pieces: the Calendar holds dated things, the To-do holds jobs, Polls settles choices. The Travel module is the view that pulls them into one itinerary, and adds the few things a trip needs that none of them has. It is the proof that the module conduits (pointers, links, events, actions, drop targets) let a module be built almost entirely from other modules' items.

## What trip planners have in common

Looking at how trip planners lay out an itinerary, the useful ideas are few:

- **Day by day.** The trip is a list of days, each with its items in order, with the time of each and the gap between. This is the main view, and it should read well on a phone.
- **Anything can be an item,** not only places: a flight, a hotel stay, a meal, a note, a reservation with a confirmation code.
- **Drag to arrange.** Items move within a day and between days. Adding is quick: a search or a paste, or dragging something in.
- **Several lenses on the same items:** by day, by category (stays, food, things to do, travel), a map with the route, and a bookings list.
- **Live shared editing,** so everyone sees the plan change.
- **Group decisions and money** are where most fall short: polls are missing or bolted on, and the budget split is often paid or absent.
- **Getting details in:** many read them from forwarded confirmation emails.

## How it fits Magpie

- **The trip is a room's plan.** A room has one trip (dates, destination, a heading); the travellers are the room's members. The server page and the dashboard show the viewer's trips across rooms, as the Calendar does.
- **The itinerary is mostly other modules' items.** An item is either the Travel module's own (a stop, a stay, a journey, a note) or a pointer to something another module holds, drawn from its card. A Calendar event on a trip day appears on that day; a task due that day shows on it; a poll closing that day shows there. Magpie names no module: the itinerary takes any item whose card has a date.
- **Its own item kinds** (declared as refs, so others can point at them and show backlinks): `stop` (title, address or place, notes, date, start time, length, category), `stay` (a stop that spans nights, with a check-in and check-out), `journey` (from, to, times, a reference code), and `note`.
- **Actions it provides,** so other modules feed it without knowing it: `addStop` (title, date, optional pointer) and `addToDay` (a pointer to any item, a date). A closed poll can then add its winner to the plan the way it adds a task today.
- **Drop targets.** Dragging any linkable item from another module onto a day offers, in the drop menu, to add it to that day, or to link it; the same menu the Calendar uses.
- **Events it publishes,** so others follow it: `dayChanged`, `tripStarted` (the first day arrives), and per stop `done`.
- **Following other modules.** A stop can carry the same rules on links that a task can: when a poll closes, take its winner and its date.
- **Shared editing.** One stored value per item with the store's versions, and each day's order as a sortable key on the item, so two people moving items in one day do not overwrite each other.

## Views

1. **Day by day** (first): the days as columns on a wide screen and a list on a phone; each item a card with its time, title, category mark, the room's people who own it, and its links.
2. **Open decisions:** polls on the trip that still need a vote and tasks due before the trip, drawn from those modules.
3. **Bookings:** the stays and journeys with their reference codes, in date order.
4. **Map** (later): needs a map source; see the questions.
5. **By category** (later).

## Dashboard

A Trips widget: the next trip with days to go, and today's items while a trip is on.

## Phases

1. **The module and the day view.** Manifest, the trip and its own item kinds, the day-by-day view with add, edit, move and delete, refs and backlinks, and the actions above.
2. **Feeding it.** Pointers from other modules appear on their days; the drop menu on a day; a closed poll adding its winner; the widget.
3. **Bookings and open decisions views.**
4. **Later:** map, category view, budget and splitting costs, reading confirmation emails, offline.

## Work split

- **The module's data, actions, refs and links, its manifest, the store, the widget and the docs:** the modules side.
- **The itinerary view's look and interaction** (the day columns and cards, drag handles, the phone layout, the visual language of a stop, a stay and a journey): the interface side. The module's page is one HTML file built from `src/travel.html`, `.css` and `.js`; the interface side owns the markup and the styles, the modules side owns the script and the data, and the two agree the element structure first (a short contract in the module's source folder).

## Interaction and layout (agreed between the two sides)

- **The contract fixes the drag state as well as the markup.** The handle element, the drop zones (a day, and the gap between two items), and the state the script sets while dragging: `.dragging` on the card, `data-drop="before|after|into"` on the target and `.drop-target` on the day. The interface side styles them; the script only toggles them and never sets inline styles.
- **Drag is the desktop path, not the only one.** Long-press drag is unreliable in a scrolling list on a phone, so every item has an item menu (`data-action="move-menu"`) with "Move to day..." and "Earlier" / "Later".
- **Phone layout is one scrolling list** with sticky day headers (date, weekday and "day 3 of 7") and a strip of days at the top to jump to one, today marked. In a room on a phone the module fills the pane above the tab bar, so nothing has a fixed height: it scrolls inside its frame and uses all of the pane.
- **Category marks are an icon and a label,** never colour alone, and colours come only from theme tokens (a small set mixed from the accent and text colours), so every theme works, light ones included.
- **An item that points at another module's item looks different from the module's own kinds:** the same frame with a small source line ("from Calendar") and that module's icon, a read-only body, and an open action. The card has slots for the source, the links and the owners.
- **Gaps between timed items** show as a thin connector row ("45 min"), worked out by the script and styled by the interface side. Optional in phase 1.
- **Every state is designed:** an empty trip, an empty day, loading, an item changed by someone else while it is being edited (the version conflict), and a day with twenty items.

## Questions

Both sides' suggested answers are marked; the author has not answered yet.

- **Map:** show one, and from where? A map needs a tile source, which means an external service, an API key or a self-hosted set. It could wait for a later phase, with addresses as links to the person's own maps app until then.
- **Money:** budget and cost splitting are where the other tools charge or fall short. In or out of the first version? This plan leaves them for later.
- **One trip per room,** or several? One is simpler and matches how a room works; a group with two trips would use two rooms.
- **Ordering inside a day:** by time when there is one, else by hand? This plan sorts by time and lets the hand order the untimed ones.

## Item details for cards (0.4.0, data only)

Items carry optional details for stylized cards: a journey `mode`, `operator`, `number`, `fromCode`, `toCode`, `terminal`, `gate`, `platform`, `carriage`, `seat`, `travelClass`, `pickup`, `dropoff`; a stop `type`, `partySize`, `reservationName`, `admissionCount`, `gate`; a stay `type`, `roomType`, `guests`; any item `travelMode` and `travelMinutes` (the leg from the item before, set by hand, later by a routing service). The city names are the existing `from` and `to`, the booking reference the existing `confirm`. The editor and the cards that use them come next.

## The plan line: the mental model (September 2026)

The author's frame, recorded before a Planner session so it is not lost: a plan goes **from the unknown to the known to the experienced**, and Planner should carry the whole lifecycle. For now, what matters is that anything can be dropped anywhere on the plan -- on a day, between days, before a date is known -- and that the organizing principle is **date first, then time, then where a person placed it**. One or two idea blocks near the first day, a few more near the tenth, a poll on the main line ("this place or that place") between days, a linked poll inside a day to decide where to eat.

**The three questions.** Sharper than unknown/known/experienced: the plan tracks, for each day, *what do I know* (the dated, timed, booked things: a card in the day, a confirmation marking it), *what are my options* (research cards, candidate places, idea blocks placed near a day or between days, not yet on one) and *what are my decisions* (the polls and tasks that turn an option into something known: a poll on the line between days, a linked poll inside a day). The plan line lays those three answers out by date, then time, then where a person placed them, and an item moves between the three by being placed, decided and confirmed, never by changing kind.

**Where that stands against what is built.** A between-days marker (a time block of kind `lane`) is already an item placed by `after` (a day) and `order` instead of a `date`. The move is to let *any* item sit that way: on a day (`date`, an optional `time`, then `order`) or at a joint on the line (`after`, then `order`). Ideas stops being a column exiled to the end and becomes the head of the line, or simply "placed nowhere yet". The lifecycle then falls out of placement rather than new machinery: unknown is on the line at a joint; known is on a day, then timed, then booked (a confirmation already marks that); experienced is past, with what came of it. A poll between days and a linked poll inside a day are the same primitive (a linked item) at two positions.

**What it would take.** Joints accept a drop of anything, not only the + that adds a marker ("Put it here, between day 2 and 3"); the item menu gains that place under Move to; the timeline draws a linked card at a joint the way it draws a marker pill; the sort rule becomes date, then time, then order, with items at a joint sorting by the joint then order. Storage keeps its shape (`after` and `order` exist). Open: telling "on day 3, untimed" from "between day 2 and 3" at a glance -- the pill-on-the-line against card-in-the-day distinction markers already draw is the likely answer -- and what "locked down" means once a decision lands (a state on the item, or just a date and a booking).

Also for that session: the "..." on an Ideas card (reported as showing no controls), and Places' `newPlace` and `addPlace` both appearing on a card drop.

### Decided and built (September 23, 2026)

**One rule of placement.** Every item is in exactly one of two places, and the two fields that say so already existed:

- **On a day:** `date` (a day of the trip), an optional `time`, then `order` among the day's untimed items. `after` is null.
- **On the line, at a joint:** `after` is the day the joint follows, or `''` for the head of the line (before the first day); then `order` among the items at that joint. `date` is null.

`cleanItem` enforces it: a `date` clears `after`; a between-days marker (`lane`) is always on the line (a stored null `after` reads as the head). An item with neither (an old idea, or a pointer with no day of its own) sits at the head, unless it points at something that has a day, in which case it shows on that day as before. So nothing stored had to change: the old Ideas column is simply the head of the line.

**Ideas is the head of the line.** There is no Ideas column any more. The items before the first day are drawn on the line between the "Planning starts" marker and Day 1, the same way a marker between days always was; the items between two days are drawn between them. A card on the line is the same card it would be in a day, with no time. Menus say where a joint is in words: "Before the first day", "Between Oct 1 and Oct 2", "After the last day".

**Every joint takes anything.** The + on a joint offers the same kinds the day's "..." does (journeys, a stay, stops, a note) plus the between-days marker types, each opening the editor at that joint (a marker is added at once, as before). The editor's Day field became **Where**: the days and the joints, interleaved in line order; a between-days marker sees only the joints. The item menu's **Move to** lists the same; **Back to ideas** became **Back to the line**, which puts a day's item at the joint before its day (near where it was, no longer decided). **Earlier** and **Later** on the line swap with a neighbour at the joint and hop to the next joint at the ends.

**Dropping.** While anything is dragged over the plan (one of its own items by its body, or another module's item or card), every joint opens into a drop zone on the line, as it did only for a marker before. A day's own item dropped on a joint moves there (among the items already at it, before or after the one under the pointer); dropped on a day it moves there as before. Another module's item or card dropped on a joint is offered "Put it here, between Oct 1 and Oct 2" through the shared drop menu, the same as "Put it on Thu, Oct 1" on a day. The rail handle's drag does the same.

**Sort rule.** On a day: untimed by hand order, then timed by time (unchanged). On the line: the joint (head first, then by the day it follows), then hand order. A hidden day's joint still draws its items, after the hidden-days badge, so nothing disappears when empty days are hidden.

**Fixed with it.** A note card had no "..." at all (the "no controls" report; a typed idea is a note). The item menu now opens above its button when there is no room below it, instead of off the bottom of the pane.

**Still open.** Telling "on day 3, untimed" from "between day 2 and 3" at a glance (today: a card in a day block against a card on the bare line); what "locked down" means once a decision lands.
