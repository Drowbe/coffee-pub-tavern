# Planner: Adding to a Day and Round Trips Plan

**Audience:** Thomas, who decided both changes, and experience-design, which builds the Planner (the `travel` module), with server-development for `tools/check-travel.mjs`.

**Status:** approved by Thomas, September 24, 2026 ("look good. approved."). **Done.** #6 (clicking an empty day, step 1 below) built in Travel 0.7.28 and verified live in a browser with a mouse, the keyboard and touch emulation; #9 (round trips, steps 2 and 3) built in Travel 0.7.29 and verified live. Delete this plan once its rules are only needed from the Planner's `CONTRACT.md` and the user guide. From two GitHub issues. #6: "Clicking an empty day in the Planner does nothing. It should invite adding an object to that day (a stop, a booking, a note...), with the day already filled in." #9: "The Planner only models one-way flights. Support a round trip (outbound and return) as one booking, showing both legs on their days."

**Waits for** the bug fixes for #7 (durations in hours), #8 (departure and arrival) and #10 (transport types), in progress in `modules/travel`. #9 changes the same journey fields and editor. **No [plan-names](plan-names.md) step blocks it.** Built before step 5c or 7, it uses today's SDK names (`host.refs`, `roomId`), and those steps move it with the rest of the module. Built after, it uses the new ones (`host.objects`). `host.menu.show` keeps its name either way. The line numbers below are from before those fixes and may have moved.

## What it is today

**Adding to a day.**

- Every day's header has a "..." button (`data-action="day-menu"`, `modules/travel/src/travel.html:85`). It opens `openAddMenu(button, { date })` (`travel.js:1563-1565`, `travel.js:518-560`) through `host.menu.show`: the journeys, a stay, the stops, a note, then the markers. Each opens the editor with the day filled in.
- An empty day draws one row: "Nothing planned yet. Add something below." (`travel.js:395-398`, template `tpl-day-empty`). Nothing happens when it is clicked.
- The add row it points to is hidden whenever the host's bar is there (`add-row.hosted`, `travel.js:~407`), so "below" usually points at nothing.
- Hidden empty days collapse into a badge whose + already opens the add menu.

**Journeys.**

- A journey is one item with one `date`, `time` and `minutes` (`travel-lib.js:30-59`), plus its own details: `mode`, `operator`, `number`, `fromCode`, `toCode`, `terminal`, `gate`, `platform`, `carriage`, `seat`, `travelClass`, `pickup`, `dropoff` (`travel-lib.js:97-111`).
- The booking reference `confirm`, the `cost` and `paidBy` belong to the item.
- The Bookings view has one row for each stay and journey (`travel.js:~707-715`). The Money view adds up each item's `cost` (`travel.js:727`).
- A stay is already drawn on several days from one item (`entriesFor`, `travel.js:283-292`), but a journey is on one day.
- A rental car has `pickup` and `dropoff` on one item.
- Each item is its own object (`item:{id}`, summary `when: date`, `modules/travel/module.json:113-123`).

## Decisions

1. **Clicking an empty day opens the full add menu for that day**, the same one as the day's "...".
2. **The empty day reads "Nothing planned yet. Click to add."**, and "Tap to add" on a phone.
3. **A day that has things on it does not open the menu from its blank space.**
4. **A round trip is two linked journey items.** The return points at the outbound. Thomas gave `returnOf` as the example; the field is `legOf` (decision 11). Each leg is its own item on its own day, so placing, moving, dragging and links keep working as they do.
5. **One booking reference, cost and payer, kept on the outbound.** Both legs show them. Money counts the cost once.
6. **Bookings shows one row for a round trip**, with both dates.
7. **A "Round trip" switch in the editor creates both legs.**
8. **Deleting either leg asks whether to delete both.**
9. **Any journey except a car can be a round trip.**
10. **Round trips now.** The shape should be able to grow into more legs later.

### Decided with the plan

These were open questions; each is the recommended answer, accepted with the plan.

11. **The stored field is `legOf`**, not `returnOf`: it reads the same for a return and for any later leg, so the shape can grow without renaming a stored key. (Recommended, accepted with the plan.)
12. **Deleting only the outbound moves the booking reference, cost and payer to the return**, so nothing that was paid disappears. (Recommended, accepted with the plan.)
13. **A return moved before its outbound is allowed**, and its card says so ("Return is before the outbound"); the move is not refused. (Recommended, accepted with the plan.)

## The contract

### #6: clicking an empty day

- **Markup** (`travel.html`, `CONTRACT.md`): when a day is empty and the viewer can edit, its `li.day-empty` holds a `button.day-empty-add[data-action="day-menu"]` with the sentence. It uses the same action as the header's "...", so the script has one path. A viewer who cannot edit gets the old row with "Nothing planned yet." and no button.
- **Script** (`travel.js`): the `day-menu` action (`travel.js:1563`) already finds the day from `.day2` and calls `openAddMenu(button, { date })`, so the menu anchors to the clicked row. No other click on a day opens it.
- **Words:** "Nothing planned yet. Click to add." The phone form, "Tap to add", is chosen by the pointer (`matchMedia('(pointer: coarse)')`), not by the width.
- **Style** (`travel-lib-cards.css`): the row looks like today's empty row, with a hover and focus state from the theme tokens. It is a real button, reachable by keyboard.
- The Planner's version is bumped (`modules/travel/module.json`, `tools/module-versions.json`).

### #9: round trips

**Data** (`travel-lib.js`, `cleanItem`):

- A journey gains `legOf`: the id of the first leg of its booking (for a round trip, the outbound), or null. It is kept only on a `journey` whose `mode` is not `car`, and never on an item that is its own `legOf`. A later step can add more legs with the same field, in date order.
- On an item with `legOf`, `confirm`, `cost` and `paidBy` are cleared on save. The outbound holds them.
- Nothing stored changes for existing journeys.

**Reading the pair** (`travel-lib-plan.js`):

- `plan.returnFor(id)` returns the journey whose `legOf` is `id`, or null.
- `plan.outboundFor(item)` returns the outbound of a return, or null.
- A return whose outbound no longer exists reads as a one-way journey.
- Two returns for one outbound (from two people editing at once) read as the first by `order`. The editor offers to delete the second.

**What a person sees:**

- **Cards:** each leg is drawn on its own day, as any journey. Both cards carry a small "Round trip" mark with the other leg's date ("Return Fri 9 Oct" on the outbound, "Outbound Sat 3 Oct" on the return). The return shows the outbound's booking reference.
- **Bookings view:** one row for the outbound, with both dates and the route both ways ("Sat 3 Oct · Fri 9 Oct · LHR ⇄ JFK"). A return is not its own row, unless its outbound is gone.
- **Money view:** unchanged in code. The return has no cost of its own, so it is not listed and the booking is counted once.
- **Editor:**
  - A journey whose mode is not car has a **Round trip** switch. On a new journey, turning it on shows the return leg's fields below the outbound's: its date, departure and arrival (as #8 leaves them), number, and from and to, filled with the outbound's to and from swapped.
  - Saving creates the outbound, then the return with `legOf`.
  - Opening either leg of an existing pair opens this editor with both legs. Saving writes each leg that changed, with its own version, and a conflict is shown on that leg as today.
  - The booking reference, cost and payer are edited once, in the outbound's fields.
  - Turning the switch off on an existing pair asks "Remove the return leg?" and deletes it.
- **Delete:** deleting a leg of a pair asks, through `host.menu.show` anchored to the delete button: "Delete both legs", "Delete only this leg", "Cancel". Deleting only the outbound leaves the return as a one-way journey, and the booking reference, cost and payer move to it (decision 12).
- **Moving:** each leg moves on its own ("Move to", drag, Earlier and Later), since they are separate items. A return moved before its outbound is allowed, and its card says "Return is before the outbound" (decision 13).
- **Objects:** each leg is its own object, with its own `when`, so other modules (the Calendar, once #13 is built) see two dated journeys. The manifest does not change.

## Left to build, in order

1. **#6, clicking an empty day** (experience-design). The markup, the action, the words, the style, `CONTRACT.md`, and a version bump.
2. **#9, the pair in the data** (experience-design for `travel-lib.js` and `travel-lib-plan.js`, server-development for `tools/check-travel.mjs`). `legOf`, its cleaning, `returnFor` and `outboundFor`, the one-way fallback, and the checks. Nothing drawn yet.
3. **#9, what a person sees** (experience-design). The editor's switch and the second leg, the cards' mark, the Bookings row, the Money note, the delete question, `CONTRACT.md`, and a version bump.

Documentation (content-manager, after each step): the Planner's user guide, and [plan-travel](plan-travel.md)'s status.

## Verify

- **Step 1.** Live on a local server, in the Planner's own page, which needs no call: an empty day opens the add menu with that day filled in the editor; a day with things does not open it from blank space; a viewer who cannot edit sees no button; the keyboard reaches the row. On a phone-sized touch screen the sentence reads "Tap to add" (checked with the browser's touch emulation; a real phone is better). `check-modules` and `check-module-versions` pass.
- **Step 2.** Checked by a tool (`check-travel.mjs`): `legOf` kept and dropped by the rules above; a car or a self-pointing `legOf` refused; the booking fields cleared on a return; `returnFor` and `outboundFor`; a return with no outbound read as one-way; two returns for one outbound.
- **Step 3.** Live on a local server, without a call: create a round trip; both legs on their days with the mark; one Bookings row; the cost counted once in Money; edit both legs from either one; each choice of the delete question; turn the switch off. Two people editing one pair at the same time needs two browsers on one server (possible locally). The Planner inside a space's canvas needs the call service and is read as code only.

