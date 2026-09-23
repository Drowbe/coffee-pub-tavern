# Drop Plan: what dropping one module's item on another does

**Audience:** whoever is building or changing what happens when something is dragged from one module and dropped on another, and the author deciding what comes next.

**Status:** Built through step 10 (the SDK helper, the carried card, every module retrofitted, the docs), verified by `tools/check-drop.mjs` and by real drops in a browser (see Verify). Left: the chat as a target (step 11, host-side) and the open questions. The transport (a drag brokered by the host between module frames, `tavern.refs.draggable` and `tavern.refs.dropTarget`) was built before this plan; the decision -- what a drop *does* -- was not shared: each module decided on its own, four different ways. This plan made that one shared tool, `tavern.refs.dropMenu`, the same move as `tavern.menu.show` and `tavern.ui.viewSwitch`, and retrofitted every module onto it. Documented in [api-module-sdk](../api/api-module-sdk.md) ("Dragging"). Delete this plan when the last item is done or moved to the TODO.

## Why

Modules are meant to amplify each other: research dropped on a day of a plan, a task dropped on a calendar day, a card the assistant wrote dropped anywhere, should each offer everything the modules around them can do with it. Today they mostly do not. An audit (September 2026) found:

- Carrying the item is one system. The host brokers the drag across frames, no module names another, and every module uses the same `draggable`/`dropTarget` contract. That part is right and stays.
- Deciding what the drop does is four systems. Calendar and Planner build a menu of choices from `actions.list({ accepts })` and `actions.pick` -- the right idea, copied between them. To-do and Polls only create a link. Research always starts a new note. Maps looks one action up by a hardcoded name. Places and Assistant cannot receive a drop at all, and Assistant's cards cannot be dragged, though its contract says they can. Chat takes only image files.
- The menus that do exist offer almost nothing. Calendar and Planner offer an action only when one of its inputs is typed to exactly the dropped kind (`ref:todo:task`). Only three actions in the whole system are typed that way (`todo:linkTask`, `todo:setTaskDue`, `places:setPlacePoint`), so every action that takes a plain `ref` -- `createTask`, `saveNote`, `addStop`, `askAssistant`, `showOnMap` -- is never offered on a drop. The server's `accepts` filter (`GET /api/bus/actions`) already keeps them; the modules throw them away.
- Some drops do not link back. Calendar's `createEvent` ignores the `ref` it is handed and never calls `setLinks`, so an event made from a dropped task does not show the task.

So what exists is a linking system with a menu bolted onto two modules, not a capability system. Nothing in the *design* was wrong; each module just reinvented the last step.

## Decisions

1. **One decision, in the SDK.** A module never decides for itself what can be done with a dropped item. It says what is under the pointer and what it would offer of its own; the SDK asks the other modules and shows one menu. Every module gets the same menu, and a module installed later appears in everyone's drop menus with no change to them. Nothing names a module.
2. **A drop context with standard names.** What a target can say about a drop is a small fixed vocabulary (below). An action is offered when every required input can be filled from it. This is the "shared shapes" plan-modules.md left open, made real for drops.
3. **A drop is about the item and what is here -- nobody else's business.** What a drop offers is the target's own offers, plus what the dropped item's *own* module can do with it *here*: an action of that module, taking the item by its exact kind (`ref:todo:task`) and using something from under the pointer (the target item, the day, the spot) -- set this task's due date to this day, link this task to this event, put this place at this spot. A third module making something new of the item (an event, a task, a note, a question from a research note dropped on a plan) is left out however well its inputs fill: that is about the item, not about here, and belongs where the item lives. The first version offered those too (a plain `ref` input took the dropped item), and a research note dropped on a plan day asked whether you wanted a calendar event, a task or the assistant instead -- "why is it asking me to do unrelated things?" -- which decided this. The fill rules (a plain `ref` takes the dropped item) stay, for the item's own module's actions and for `offersFor`'s callers. A card the drag carried has no module of its own, so only the target's own offers apply to it.
4. **What is dragged can be an item or a card.** A ref is the normal case. A module that has nothing stored -- Assistant's answer cards -- drags the card itself (title, kind, content, place, date). The drop context always has a card (resolved from the ref, or carried); actions that need a `ref` are offered only for a ref, actions that take a title, a date, a place or text work for both. This is "Send all to plan", one card at a time, by hand.
5. **Link back is a rule.** An action that creates something from a `ref` input calls `setLinks` on the new item, so the link shows from both ends. Audit each provider when retrofitting.
6. **Own offers stay the module's.** "Add as event on Tuesday", "Put it on day 3", "Save as a place" are the target's own, first in the menu, phrased by the module that knows the spot. The SDK adds the rest. An own offer may say `when(ctx)` it applies (Places offers to save only an item that has a position), and the SDK leaves it out otherwise. The map has no own offer: "put it here" is whatever module offers to place its own item at a position, filled from the map's `place`.
7. **The old `drop` handler stays** for a module's own items (Planner reorders its own entries by drag). The helper is for something from elsewhere.
8. **A provider says what its `ref` input needs of the item.** `needs: ["place"]` (or `date`, `text`, `subtitle`) on an action in `actions.provides` keeps it out of the menu for an item whose card has none -- "Show on the map" and "Save it as a place" for a task. Decided after the first live drop: a task on a calendar day offered seven things, three of them nonsense, and the fill rules alone cannot know that a map needs a position.
9. **Exact kind, and something from here.** Within decision 3: an action of the item's own module that takes it only as any `ref` (a task from a task) is left out, and one that used nothing from under the pointer (only the item's own title and pointer) is left out too -- it is about the item, not about here.

## The drop context

What a target module builds from the point under the pointer, all optional but `card`:

| Field | Type | Filled from |
|---|---|---|
| `ref` | pointer | the dropped item (absent for a bare card) |
| `card` | card | `refs.resolve(ref)`, or the card carried by the drag |
| `target` | pointer | the target's own item under the pointer, if any (an event, a task, a stop) |
| `date` | `YYYY-MM-DD` | the day under the pointer (a calendar cell, a plan's day) |
| `time` | `HH:MM` | the time under the pointer, when the target has one |
| `place` | `{ lat, lng, name? }` | the spot under the pointer (a map), else the card's own place |

**Filling an action's inputs** (each `name: type` in `actions.provides[].input`, `?` for optional):

- `ref:<module>:<kind>`: the dropped `ref` when it is that kind, else unfillable.
- `ref`: the dropped `ref`. A second plain `ref` input, or one whose name is `target`, takes `context.target`.
- `date`: `context.date`. `datetime`: `context.date` plus `context.time` when both exist.
- `string` named `title`: `card.title`. `text` named `notes`, `body` or `content`: `card.text` when the card carries it, else left empty (optional only).
- `place`, or `number` inputs named `lat` and `lng`: `context.place`.
- Anything else required: unfillable, the action is not offered.

An action is offered when every required input is filled **and** the dropped item filled at least one input (a `ref`, or the card's title, text or place for a bare card).

## The one helper

```js
// In a module's dropTarget.drop, for something from another module:
const context = spotAt(point);           // the module's own: { target?, date?, time?, place?, el }
tavern.refs.dropMenu(ref, point, {
  context,
  own: [                                 // the module's own offers, first in the menu
    { id: 'create', label: 'Add to the calendar as an event', hint: 'Tue 3 Oct', run: () => createEventOn(card.title, context.date) },
  ],
  remember: 'day',                       // with the dropped kind, the key actions.pick remembers the last choice under
});
```

`tavern.refs.dropMenu(dragged, point, { context, own, remember })`:

1. Resolves the dragged ref into a card (or takes the carried card); an item the viewer may not see stops here with a note, as today.
2. Asks `actions.list({ accepts: module:kind })` and fills each action's inputs from the context by the rules above; keeps the ones that fill.
3. Shows `own` then the actions with `actions.pick(offers, point, { remember })`; one offer runs at once with nothing asked, as `pick` already does.
4. Runs the chosen offer: an own offer's `run()`, or `actions.request(action, input, { wait: true })`; reports the outcome the way the module's note does today (`onDone`/`onError` callbacks, or a returned promise).
5. Traces every step to the `?debug=1` box, so a drop that offers nothing says why (which required input could not be filled).

`tavern.refs.offersFor(dragged, context)` is the same without the menu, for a module that wants the list (Assistant's "Send all to plan" could use it).

The drag payload gains a card: `tavern.refs.draggable(root, resolve)` may return `{ card: { title, kind?, content?, place?, date? }, label }` instead of `{ kind, id, ... }`. The host carries it as it carries a ref; `dropTarget`'s `over`/`drop` receive `dragged`, which is `{ ref }` or `{ card }`, and `dropMenu` takes either.

## What each module contributes

**As a target** (own offers, and what its spot says):

| Module | Spot gives | Own offers |
|---|---|---|
| Calendar | `date` (a day cell), `target` + `date` + `time` (an event) | Add as an event on that day |
| Planner | `date` (a day), `target` (an entry); a joint gives the day it follows | Put it on that day; Add as a stop |
| To-do | `target` (a task); the open editor as a target too | Link it to this task |
| Polls | `target` (an option of an open poll the person manages) | Link it to this option |
| Research | nothing under the pointer matters | Start a note about it |
| Places | nothing under the pointer matters | Save it as a place (when the card has a place or an address) |
| Maps | `place` (the map position under the pointer) | Put the pin here (its own, replacing the hardcoded `setPlacePoint` lookup) |
| Assistant | nothing under the pointer matters | Use it as context; Ask about it |
| Chat | the message box | Post it as a card (host-side; see below) |

**As a provider**, every action keeps its declared inputs; the retrofit checks each one against the vocabulary and that each creates a link back where it makes one. What shows up in a drop menu is an action typed to the module's own kind that uses something from under the pointer (`setTaskDue { task: ref:todo:task, date }`, `linkTask { task, target }`, `setPlacePoint { place, lat, lng }`); an action taking any `ref` (`createEvent`, `createTask`, `addStop`, `saveNote`, `askAssistant`) is for the finished-poll buttons, "Send all to plan" and the like, not for a drop.

**As a source**, every module that shows items keeps `draggable`; Assistant's answer cards become draggable as bare cards.

## Chat

The chat is not a module (it is the room page's own, `public/room.js`), so a ref dropped on it is a host-side drop: the page's own drop layer catches it (the host already lays one over every module frame while a drag is on) and posts the card as a chat message -- a small card in the thread that opens the item where it lives, the same card `refs.resolve` gives. Needs a message shape for a card next to text and pictures, on the server too. Second phase; it belongs with whoever owns chat and the message store.

## Left to build, in order

1. **SDK:** `dropMenu` and `offersFor`, the fill rules, the carried card in the drag payload, and tests for the fill rules (a small `tools/check-drop.mjs` with cases: each context field against each input type, and "unrelated action not offered").
2. **Calendar:** onto `dropMenu`; `createEvent` links the `ref` it is given; a dropped item on an event offers the actions that take a target.
3. **Planner:** onto `dropMenu` for items from elsewhere (its own reordering stays); the day-only "Put it on" offer keeps working; actions offered on a day, not only on an entry.
4. **To-do:** onto `dropMenu`; delete the leftover browser-drag handlers and the stale "an event or poll" comment; `createTask` links back.
5. **Polls:** onto `dropMenu`, its own "Link to this option" first.
6. **Research:** onto `dropMenu`, "Start a note about it" as its own offer instead of the only outcome; `saveNote`/`saveLink` link back (check).
7. **Maps:** onto `dropMenu`, "Put the pin here" as its own offer, the hardcoded action name gone.
8. **Places:** a drop target, "Save it as a place".
9. **Assistant:** cards draggable as bare cards; a drop target ("Use as context", "Ask about it").
10. **Docs:** api-module-sdk.md's Dragging section and "What a drop can do" rewritten around `dropMenu`; architecture-modules.md; each module's CONTRACT.md; the CHANGELOG.
11. **Chat** (second phase, host-side).

## Verify

Done live (September 2026), on a running server, with To-do, Calendar and Planner mounted side by side as the stage mounts them and the drag driven through the host's own brokering (`ptrForTest`):

- a task on a Calendar day: the day highlighted under the pointer; the menu offered the calendar's own "Add to the calendar as an event (Oct 3)", To-do's "Set this task's due date to its date", Planner's "Add it to the trip" and "Put it on the trip's itinerary"; choosing the due date set it (the task showed Oct 3) and the calendar said "done". Before `needs` and the own-module rule the same drop also offered "Save it as a place", "Show on the map" and "Add a task" -- that is what decided them.
- a card, as the assistant drags one (a restaurant with a place), on a day of the plan: the plan's own "Put it on Fri, Oct 2", then "Add it to the calendar", Places' "Save it as a place" and "Save a place here", To-do's "Add a task"; "Put it on" made a restaurant stop on that day, with the card's title.
- the remembered choice came first the second time the same kind was dropped on a day.

Still to walk, each the same code path as the two above: a task on an event; a poll on a Planner entry; an event on a To-do task and on the To-do editor; a task on a poll option; anything on Research, Places, Maps; anything on Assistant and an answer card on To-do and Research (Assistant and Research need the AI service configured, which the development server here does not have). Each with a note of what the menu offered:

- a task on a Calendar day; a task on an event
- a research note on a Planner day; a place on a Planner day; a poll on a Planner entry
- an event on a To-do task; a poll on a task; a task on the To-do editor
- a task on a Poll option
- anything on Research; anything on Places; anything on Maps
- an Assistant answer card on a Planner day, on Calendar, on To-do, on Research
- a drop that should offer nothing (a card with no place on Maps) says so, and says why in the trace

Known limit, unchanged: a drag reaches only modules in the same window; the popped-out app is one window, a module popped out on its own is another.

## Open questions

- Whether `pick` should show the source module's icon on each offer (it shows `hint: moduleName` today).
- How far the drop context should reach for text: a note's body is `card.text`, which `refs.resolve` leaves out of browsed cards for a reason. First version: only `title`, and text when the card was carried (an Assistant card).
