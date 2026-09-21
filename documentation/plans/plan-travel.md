# Travel Planner Plan

**Audience:** whoever is building the Travel module, and the author deciding what it does first.

**Status:** Proposed. Nothing is built. The design below is for review; the questions at the end need the author's answers.

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

## How it fits Tavern

- **The trip is a room's plan.** A room has one trip (dates, destination, a heading); the travellers are the room's members. The server page and the dashboard show the viewer's trips across rooms, as the Calendar does.
- **The itinerary is mostly other modules' items.** An item is either the Travel module's own (a stop, a stay, a journey, a note) or a pointer to something another module holds, drawn from its card. A Calendar event on a trip day appears on that day; a task due that day shows on it; a poll closing that day shows there. Tavern names no module: the itinerary takes any item whose card has a date.
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

## Questions

- **Map:** show one, and from where? A map needs a tile source, which means an external service, an API key or a self-hosted set. It could wait for a later phase, with addresses as links to the person's own maps app until then.
- **Money:** budget and cost splitting are where the other tools charge or fall short. In or out of the first version? This plan leaves them for later.
- **One trip per room,** or several? One is simpler and matches how a room works; a group with two trips would use two rooms.
- **Ordering inside a day:** by time when there is one, else by hand? This plan sorts by time and lets the hand order the untimed ones.
