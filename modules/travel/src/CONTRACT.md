# Travel: the itinerary's markup contract

**Audience:** whoever writes `travel.js` (the modules side) and whoever styles it (`travel.html`, `travel.css`, the interface side). This file is the agreement between them.

**Canonical markup.** The elements a script clones are the `<template>` elements in `travel.html` (`tpl-day`, `tpl-item-stop`, `tpl-item-stay`, `tpl-item-journey`, `tpl-item-note`, `tpl-item-link`, `tpl-gap`, `tpl-conflict`, `tpl-suggestion`, `tpl-decision`, `tpl-daychip`, `tpl-owner`, `tpl-link`, the states). The script fills a clone by hooks only, `[data-slot=name]` (textContent) and `[data-icon=name]` (the inline SVG), and toggles the state classes and data attributes below. If this text and the templates disagree, the templates win; tell the interface side.

**How it works.** `travel.css` styles the elements below by their classes and attributes. `travel.js` builds exactly these elements from the trip's data and then only **toggles the state classes and data attributes** listed here. The script never sets a style (no `element.style`, no inline `style=""`), and the stylesheet never depends on anything but this markup. `design/itinerary.html` is the reference: its `render()` builds these elements, so copy its templates rather than re-reading this text. Open that file in a browser to see every state, dark and light, at phone, pane and wide sizes.

**Rules that hold everywhere**
- Colours come only from the theme tokens (`--bg`, `--bg-section`, `--bg-card`, `--border`, `--text`, `--text-dim`, `--accent`, `--on-accent`, `--danger`). No fixed colours; a light theme must work.
- Nothing has a fixed height. The module fills its pane and scrolls inside it. No `100vh`.
- Icons are `<span class="ic" data-icon="utensils">` holding the inline SVG from `tavern.ui.icon('utensils')`. The stylesheet sizes `.ic svg`; the script never sizes an icon.
- `[hidden]` hides. Text from people goes in with `textContent` or escaped, never as HTML.
- A category is always an icon **and** a label, never colour alone.

## The page

```
<div id="app" class="app">                         the whole page; the script un-hides it when loaded
  <header id="trip" class="trip">                  the trip header
  <nav id="daystrip" class="daystrip">             shown at every width (a row of days to jump to)
  <div id="body" class="body">                     the one scroller
    <div id="days" class="days">                   Days view
    or the Decisions view (see below)
```
Other states replace the header and body: see "States".

## The trip header (`#trip`)

| Element | Meaning |
|---|---|
| `[data-slot=title]` | the destination or trip name |
| `[data-slot=dates]` | "Sat 3 – Fri 9 Oct 2026", already formatted |
| `.views` with `button[data-view=days\|decisions\|bookings]` | the views; the shown one has `.on`. `.count` inside a button is a small number (open decisions) |
| `[data-slot=summary]` | `.trip-facts` spans: days, travellers, open decisions; a `<b>` is the number |

## The day strip (`#daystrip`)

One `button.daychip[data-action=goto-day][data-day=YYYY-MM-DD]` per day, holding the weekday and then `<b>` the day number. `.today` marks today, `.current` the day in view (the script moves it as the list scrolls). Clicking scrolls `#day-<date>` into view.

## A day (`section.day`)

```
<section class="day [today] [drop-target]" id="day-2026-10-05" data-day="2026-10-05" data-index="3">
  <header class="day-head">
    <span class="day-date" data-slot="date">Mon 5 Oct</span>
    <span class="day-of">day 3 of 7</span>
    <span class="day-count">6</span>            the number of items, empty when none
  </header>
  <ol class="items"> ...items, gaps... </ol>    or, when empty: <li class="day-empty">text</li>
  <form class="add-row" data-day="2026-10-05"> ...the add row... </form>
</section>
```
State: `.today` on today's day; `.drop-target` while something is dragged over the day (see Drag).

## An item (`li.item`)

```
<li class="item [done] [conflict] [dragging]" data-id="…" data-kind="stop|stay|journey|note|link"
    data-cat="do|eat|stay|travel|other"  data-span="start|middle|end"  data-drop="before|after|into">
  <button class="item-handle" data-action="drag" aria-label="Drag to move">   desktop only; the CSS hides it on phones
  <div class="item-time" data-slot="time"><b>09:30</b>1 h 30</div>            <b> the start; after it the length, or "check in", or "→ 10:05"; empty text for no time
  <div class="item-main"> ...by kind, below... </div>
  <button class="item-menu" data-action="move-menu" aria-label="Item menu">   the phone path: Move to day..., Earlier, Later, Edit, Delete
  [<div class="conflict-bar"> when in conflict ]
</li>
```
`data-cat` is on stops, notes and the module's own kinds (a `link` has none). `data-span` is only on a `stay`. State classes: `.done` (crossed out), `.conflict`, `.dragging`.

**Slots inside `.item-main`** (all optional except the title; the script fills only the ones it has):
- `h3.item-title[data-slot=title]`
- `p.item-sub[data-slot=place]` (an icon and an address or place) or `p.item-sub[data-slot=body]` (a note's text, a link's subtitle)
- `.item-meta` holds the row of `.cat[data-slot=category]`, `.code[data-slot=code]`, `.owners[data-slot=owners]` and `.links[data-slot=links]`
- `.cat.cat-<category>`: an icon and its label, in that order
- `.owners > .owner`: one per person, the initial as text; the title attribute on `.owners` lists the names
- `.links > .link`: a small pill, `<span class="ic">`, `<b>Poll</b>` (the kind), then the title; `.link.gone` when the target no longer exists

**By kind**
- `stop`: the slots above. `data-cat` is one of `do`, `eat`, `other`.
- `stay`: the same, with `data-span`. `start`: time is the check-in time and the sub-line "check in". `middle`: a one-line dashed card, "Staying at <name>", no time cell text, no meta (the CSS hides it). `end`: time is the check-out time and the sub-line "check out". The script adds a `stay` item to every day it covers.
- `journey`: after the title a `.route` with `[data-slot=from]`, an arrow icon, `[data-slot=to]`; the `.code` holds the booking reference. The time cell is the departure, and "→ arrival" under it.
- `note`: title and an optional `[data-slot=body]`.
- `link`: another module's item, drawn from its card. The frame is dashed. Instead of a category, its first child in `.item-main` is `.source[data-slot=source]`: the source module's icon, "from <Module name>", and `button.open[data-action=open]`. The body is read-only. `.item-menu` still exists (move to another day). The title, `[data-slot=body]` and `.owners` come from the card.

## The gap between two timed items

`<li class="gap" data-slot="gap" aria-hidden="true">45 min walk</li>` between two `.item`s in an `ol.items`. Optional; the script computes the text.

## The add row (`form.add-row[data-day]`)

`<input name="title" type="text" maxlength="200" placeholder="Add a stop, a stay or a note" aria-label="Add to Mon 5 Oct">` and `<button class="btn btn-primary" type="submit" data-action="add-item" aria-label="Add">` with a plus icon. On a phone the input is 16 px so iOS does not zoom.

## Drag (desktop; phones use the item menu)

The script toggles, the stylesheet draws; no coordinates, no inline styles.
- The **handle** is `.item-handle[data-action=drag]`. It is the only drag source (so text can still be selected and a phone can still scroll).
- While an item is being dragged: `.dragging` on its `li.item`.
- The **drop targets** are the other `li.item`s and the `section.day`. On the item under the pointer the script sets `data-drop="before"` (the pointer is in its upper half), `"after"` (lower half) or `"into"` (only for an item that accepts a drop, such as a stop taking a linked item); on the day it sets `.drop-target`. The stylesheet draws an insertion line for `before` and `after`, a tint for `into`, and a dashed outline for `.drop-target`.
- Exactly one target has a `data-drop` at a time; the script removes it from the last one when the pointer moves or the drag ends.
- An empty day is a target too: `.day.drop-target` and its `.day-empty`.

## The add row and the host's bar

The way to add is the host's bottom bar, the same quick-add the To-do, Polls and Calendar have (`tavern.bar.set` with a `quickadd` item). When the host has a bar, every day's `form.add-row` gets the class `hosted` (the stylesheet hides it), except the Ideas column's, which stays: it is the only quick way to add something with no day. When `bar.set` is refused, or a host has no bar, `hosted` is removed and each day keeps its own row. Text typed in the bar becomes a stop on the **current day**: the day named in the text if it finds one inside the trip, else the day whose chip is `.current` (the one in view), else today if it is on the trip, else the first day. An empty submit opens the editor; with no trip yet it opens the trip form.

## The Decisions view

`#body` holds, instead of `#days`:
```
<div class="section-title">Polls to vote on</div>
<ul class="decisions">
  <li class="decision">
    <span class="ic" data-icon="square-poll-vertical">…</span>
    <div class="decision-main"><div class="decision-title">…</div><div class="decision-sub">Closes Mon 5 Oct, 18:00 · 3 of 5 voted</div></div>
    <button class="btn" data-action="open">Vote</button>
  </li>
</ul>
<div class="section-title">Tasks due before the trip</div> <ul class="decisions">…same rows…</ul>
```
The Bookings and Money views reuse the same list markup: `.section-title` headings and `ul.decisions > li.decision` rows (`tpl-decisions`, `tpl-decision`). A row has an icon, `.decision-title`, `.decision-sub`, an optional `.code[data-slot=code]` (a booking reference, hidden when empty) and one `button` (Open, or an amount).

## States

| State | What the script renders |
|---|---|
| Loading | `.app` with the header and `#body > .skeleton[aria-busy=true]` holding four `.skel` |
| No trip yet | `.app > .body > .state#state-empty-trip` with an `h2`, a `p`, and `button.btn.btn-primary[data-action=create-trip]` |
| Empty day | `ol.items` holds one `li.day-empty` with a sentence; the add row stays |
| Conflict | the item gets `.conflict` and a last child `.conflict-bar[role=alert]`: a `span` ("Christy changed this while you were editing."), `button.btn[data-action=use-theirs]`, `button.btn[data-action=keep-mine]` |
| Busy day (20+ items) | nothing special: `.items` scrolls inside a column on a wide pane, the page scrolls on a phone; the day header stays put (sticky) |
| Error | a `p.error` under the header |

## Layout the stylesheet decides

- **Every width:** the days run top to bottom, one after another, in a single scrolling `#body`; each `.day-head` sticks to the top while its day scrolls, and the day strip is always shown. A long trip is just a longer list. On a wide pane the list keeps a readable width (centred).
- **Phone or narrow pane** (under 720 px): the same list with touch-sized items; the handle is hidden and `.item-menu` is the way to move an item.
- An item with no drag handle (a stay's later nights, or a viewer who cannot edit) has one column fewer.
- On load the script scrolls today's day into view (`scrollIntoView({ inline: 'center', block: 'start' })`) and marks its chip `.current`.

## Ideas and suggestions

- **Ideas** are items with no day. They are the first column (a first block on a phone): `section.day.ideas#day-ideas[data-day=""]`, with the header text "Ideas" and "no day yet", the same `ol.items` and an add row with `data-day=""`. The item menu's "Back to ideas" and a drop on this section clear an item's day.
- **Suggestions** are dated items other modules hold on a trip day that are not on the plan yet. A day with any gets `div.suggestions` between `ol.items` and the add row: `.suggestions-title` ("Other modules have") and one `.suggestion[data-ref]` per item (the module icon, a `.suggestion-main` with `<b>` the title and the module name, and `button[data-action=add-suggestion]`). No suggestions: the element is absent (or `[hidden]`).

## The item menu (`#item-menu.menu`)

One popover the script positions under the `.item-menu` button that opened it (`position: absolute` inside `.app`; it sets `top` and `left` as its only inline style, the one exception to "no inline styles", since a position cannot be a class). Entries, each `button[data-action]`: `edit`, `earlier`, `later`, `to-ideas`, `delete` (`.danger`), and a `label` with `select#menu-day` ("Move to <day>"). The script fills `#menu-day` and shows or hides entries by kind and position (no "Earlier" on the first item). `[hidden]` closes it; a click elsewhere or Escape closes it.

## The editor (`#editor` > `form#form.editor-card`)

A dialog over the page for an item and for the trip. The script shows the fields a kind needs: an element with `data-kinds="stop journey stay"` is shown only for those kinds; the kind tabs are `#f-kinds button[data-kind]` (`.on` on the current one). Fields, all with `id="f-<name>"`: title, date (select of days), time, minutes, checkout (select, a stay's last night), from, to, category, place, address, confirm (the booking reference), notes, owners (`#f-owners`, checkboxes for the room's people), done. `#f-by` says who last changed it, `#f-error` an error, and the buttons are `#f-save`, `#f-cancel` and `#f-delete`. The trip has its own form of the same shape opened by `button[data-action=edit-trip]`.

## Not decided yet

The map is designed when its phase starts.

## The card family

A day is a `tpl-day-head` and an `ol.timeline` of rows, replacing the old `.day-head`, `ol.items` and `li.item`. Every kind of thing in a trip has its own card, made to be told apart at a glance by four things together: a **silhouette** (a boarding pass, a ticket, a hotel key band, a reservation, a note), a big **icon badge**, a **kicker** that names it ("Flight", "Museum"), and a **colour family**. Colours stay the theme's: each family is the accent turned around the colour wheel (`--turn` on the row), so a different accent gives a matching set and nothing is a fixed colour. `design/cards.html` is the reference rendering (dark and light, three accents, phone to wide); `travel-lib-cards.css` is the stylesheet; the templates are `tpl-day-head`, `tpl-row`, `tpl-leg-row` and `tpl-card-*` in `travel.html`.

**A row** (`li.row.entry[data-type][data-id][data-kind]`, plus `.done`, `.conflict`, `.dragging`, `data-drop="before|after|into"` as before): `.when` (`[data-slot=time]` bold, `[data-slot=sub]` small, e.g. "check-in"; both empty for an untimed item, and the CSS hides an empty one), `.rail` (the line and `.dot`, coloured by the family) and `.slot` holding exactly one card. **The way between two stops** is `li.row.leg-row` with `button.leg[data-mode=walk|drive|transit|bike|taxi][data-action=edit-leg]`: the mode's icon, `[data-slot=minutes]` ("12 min") and optional `[data-slot=dist]` ("· 0.9 km"). It sits between two stops that both have a place or a time; the person sets `travelMode` and `travelMinutes` by hand (the click opens a small editor), and a routing service may fill them later.

**The day header** (`tpl-day-head`): `[data-slot=daynum]` (the day of the month, large), `[data-slot=daymonth]` ("Sat · Oct"), `[data-slot=position]` ("Day 2 of 7") and `[data-slot=summary]`, one line the script builds: the first and last time, how many stops, and the total time getting around, e.g. "10:05 – 23:30 · 6 stops · 1 h 24 min getting around".

**Which card, and its family** (the script chooses the type from the item: a journey by `mode`, a stay by `type`, a stop by `type`; no type falls back to the last row of the group):

| `data-type` | Template | Kicker | Badge icon | Fields the card shows |
|---|---|---|---|---|
| `flight` | `tpl-card-flight` (boarding pass) | Flight | plane | `operator` + `number` (title), `fromCode`, `toCode`, `from`, `to`, `time`, arrival, duration, `seat`, `gate`, `travelClass` |
| `train` | `tpl-card-train` (ticket) | Train | train | `operator` + `number`, `from`, `to`, `time`, arrival, `platform`, `carriage` + `seat`, duration, `confirm` |
| `ferry`, `bus`, `car` | `tpl-card-transit` | Ferry, Bus, Rental car | ship, bus, car | `title`, `operator` (in the kicker), `time`, `to`, `confirm` |
| `hotel` (a stay of any `type`) | `tpl-card-hotel` (the first day); `tpl-card-hotel-mid` for the nights between; `tpl-card-hotel-out` (`data-span="end"`, kicker "Check out", the time big on the right) for the last morning | Hotel, Rental, Hostel, Camp | bed | `title`, `address`, nights, check-in and check-out, `roomType`, `guests`, `confirm` |
| `restaurant`, `cafe`, `bar` | `tpl-card-meal` (reservation) | Restaurant, Café, Bar (or a note's own label, e.g. "Sundowner") | utensils, mug-hot, martini-glass | `title`, `address`, `partySize` ("Table for 4"), `reservationName` ("under Thomas"), `time`, `minutes` |
| `sight`, `museum`, `tour` (also `hike`, `beach`, `shop`, `spa` as plain activity cards) | `tpl-card-activity` (pass with a stamp) | Sight, Museum, Tour, Hike, Beach, Shop, Spa | monument, building-columns, person-hiking, person-hiking, umbrella-beach, bag-shopping, spa | `title`, `address`, `minutes`, `admissionCount` ("4 tickets"), `confirm` |
| `show` | `tpl-card-show` (ticket with a stub) | Show | masks-theater | `title`, `address`, `gate`, `confirm`, `admissionCount`, `time` |
| `note` | `tpl-card-note` (sticky note) | Note | none | `title`, the note text |
| `place` | `tpl-card-place` | Saved place | location-dot | `title`, `address` |
| `link` | `tpl-card-link` (dashed) | "from <Module>" | that module's icon | `title`, its sub-line |

Empty slots hide (`[data-slot]` with no value gets `hidden`), so a card with few fields stays tidy. `[data-slot=owners]` is the same `.owner` initials as before. Every card except a note has `button.menu-btn[data-action=move-menu]` (the item menu, unchanged).

**Colour families** (`--turn`, degrees added to the accent's hue): flight 195, train 150, ferry 120, bus 100, car 45, hotel 255, restaurant 0, cafe 345, bar 320, sight 95, museum 285, tour 65, show 305, note 25, place 130; `link` is the dimmed text colour. The stylesheet sets these; the script only sets `data-type`.

**Narrow** (`.app.narrow`): the time moves above its card so the card has the whole width, the boarding pass and the show ticket stack their stub under the main part, and legs stay between cards.

**What the mock does not cover yet:** an editor for the new fields (the modules side), the small editor for a leg, drag on the new rows (same `data-drop` and `.dragging` states, styled in `travel-lib-cards.css`), and a print or share view.

### Markers, days at the ends and empty days

Reference rendering: `design/markers.html` (`?state=normal|edge|hidden`, `?theme=light`, `?w=390`).

**Automatic markers** (`li.row.marker[data-marker=planning-start|planning-end|trip-start|trip-end]`, `tpl-row-marker`). They are not items: no id, no menu, no handle, not editable, draggable or removable, and never counted as something planned. The script writes them; a person cannot.
- `planning-start` is the first thing on the plan's first day and `planning-end` the last thing on its last day. Icon `flag` and `flag-checkered`; title "Planning starts" and "Planning ends"; `[data-slot=time]` is the date ("Sat 3"); `[data-slot=sub]` a short line ("the plan begins").
- `trip-start` sits just before the first booked item and `trip-end` just after the last, in their day, in time order. "Booked" is a journey, a stay, or any item with a confirmation; if nothing is booked, the first and last timed item; with no items there are no trip markers. Icon `plane-departure` and `plane-arrival`; title "Trip starts" and "Trip ends"; `[data-slot=time]` is that item's start (for the end, its arrival or check-out) and the sub names the item ("TAP Air Portugal TP 214 · Denver").
- Planning markers are quiet (dashed outline); trip markers are filled in the accent. Each row keeps the same three columns as an item, so the rail is unbroken.

**Days at the ends** (`div.dayedge[data-edge=before|after]`, `tpl-dayedge`): a dashed button "Add days before" above the first day and "Add days after" below the last. Choosing it hides the button and shows `form.edge-form` ("Add [3] days", Add, Cancel; the count is 1 to 30, or fewer when the plan would pass its longest length, said in `#note`). Adding moves the plan's start date back (before) or its end date forward (after) by that many days, so the new days are empty days on the trip, and the planning markers move with them; items and trip markers stay where they were.

**Empty days.** A toggle in the toolbar (`button.tool-empty[data-action=toggle-empty][aria-pressed]`, icon `eye-slash`, tooltip "Hide empty days" or "Show empty days") sits in `.actions` beside the pencil. A day with no items (markers do not count) gets `.is-empty`, and so does its chip in the strip. While the toggle is on, `.app.hide-empty` hides both, and `p.emptynote` (`tpl-emptynote`: "2 empty days hidden" and a Show button) sits above the first day. If every day is empty nothing is hidden. The choice is remembered for the person, and the default is off.

### A link whose item is gone or hidden

The link card (`tpl-card-link`, `article.card.linkcard`) has two more states, set from what `refs.resolve` says (see plan-linked-items.md):
- `.gone`: the item was deleted. The icon is `link-slash`, the title is the last known one (struck through), `[data-slot=state]` reads "No longer available" and `[data-action=remove-link]` ("Remove from plan") is shown.
- `.hidden`: the item exists but this person may not see it. The title reads "Not available to you" (italic), `[data-slot=state]` says so, and Remove is shown for someone who may edit.

Neither state opens the editor, and a click on the card does nothing; the only actions are Remove and the item menu. The live card of an item that exists is unchanged.

## The editor (for the card family)

The same dialog (`#editor > form#form.editor-card`), rebuilt around **what kind of thing it is**. `tpl-editor2` in `travel.html` is the new form; the script fills `#editor` from it when it opens (the old form goes when the switch is done). `design/editor.html` is the reference (a harness for each type, dark and light, phone to wide).

**The type picker** (`#f-types`): one `button.tile[data-type]` per kind of thing, in groups (Getting there: flight, train, ferry, bus, car; Stay: hotel; Eat and drink: restaurant, cafe, bar; See and do: sight, museum, tour, show; Other: note). A tile is the family's colour and icon, the same as its card; `.on` marks the chosen one. Choosing a tile changes the type of the item (and with it `kind`, `mode` or `type` in the data), keeps the fields they share and shows the fields that type needs. The script builds the tiles' icons with `tavern.ui.icon` from `data-icon`.

**Fields appear by type.** Every field wrapper carries `data-types="flight train ..."`; the script adds `.on-type` to those whose list includes the chosen type, and the stylesheet hides the rest (`[data-types]:not(.on-type)`). Groups (`.fieldgroup`) hold a title and their fields and use the same attribute, so a group with nothing to show disappears. All inputs have ids `f-<name>` and the data model's field names as `name`:

| Group | Fields (type) |
|---|---|
| Top | `f-title`, `f-date`, `f-time` (all but hotel), `f-minutes` (length or duration; not for hotel, note), `f-checkout` (hotel) |
| Journey | `f-operator`, `f-number`, `f-fromCode`, `f-toCode` (flight), `f-from`, `f-to`, `f-pickup`, `f-dropoff` (car), `f-terminal`, `f-gate` (flight), `f-platform`, `f-carriage` (train), `f-seat` (flight, train), `f-travelClass` (flight) |
| Stay | `f-address`, `f-roomType`, `f-guests` (hotel) |
| Where and who | `f-address-stop`, `f-partySize`, `f-reservationName` (meals), `f-admissionCount` (sight, museum, tour, show), `f-gate-show` (show's entry, saved as `gate`) |
| Booking | `f-confirm`, `f-cost`, `f-paidBy` (all but note) |
| Everything | `f-notes` (all), `#f-owners` (a `label.check` per traveller) |
| Getting to this stop | `#f-travelMode` (`button.mode[data-mode=walk|drive|transit|bike|taxi]`, `.on` on the chosen one, none chosen means no leg) and `f-travelMinutes` |

`#f-by`, `#f-error`, `#f-save`, `#f-cancel` and `#f-delete` are as before. A codebox (`.codebox`) is monospaced and upper-case for airport codes. Each type has a placeholder for the title (for example "Flight to Lisbon", "Dinner at Cervejaria Ramiro") set by the script.

**Narrow:** the dialog fills the pane, the tiles reflow to the width, and inputs are 16 px so a phone does not zoom.
