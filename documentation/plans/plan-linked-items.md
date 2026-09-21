# Linked Items Plan

**Audience:** the author deciding how links between modules are kept true, and whoever builds it afterwards.

**Status:** Proposed by the interface side from a bug the author found. Nothing here is built.

## The bug that started it

Add a poll to a plan; the plan shows it. Delete the poll. The plan still shows the poll, and choosing it opens an "edit" dialog for a poll that no longer exists. The same is true of anything one module points at from another: a task, an event, a place, a stay.

## What exists

- A pointer (`{ module, kind, id, scope, room }`) names an item in another module. A module asks `tavern.refs.resolve` for its card, and the server answers per viewer: a card, or an error such as "that item is no longer there" (404).
- The server keeps a table of what points at what (`setLinks`), so an item can ask what links to it (`linksTo`, backlinks).
- Modules can hear what happens in others (`events.subscribe`), for example a poll finishing.
- Planner items keep a stored copy of what they show (a title) as well as the pointer.

## What is missing

1. **Nothing tells a holder that the item went.** A deleted item resolves to an error, but the Planner shows its stored title anyway, as if all were well, and its click handler opens the item's editor.
2. **Nothing cleans up.** The dead link stays for ever, on every page that held it.
3. **Nothing carries a change across.** Rename an item and a stored copy is stale. Move an event's date and the plan does not move with it.
4. **Access changes are invisible.** A room leaving, a permission removed or an item made private should change what each viewer sees, without the holder guessing.

## Rules (the author's, made specific)

- **Delete deletes everywhere.** When an item is deleted, every link to it goes: removed from the plans, tasks and pages that held it, or, where something has to be left for a person to see, a clear "no longer available" placeholder with one action: **Remove**. It never opens the editor of an item that is not there.
- **Update updates everywhere.** A holder shows what the item says now (title, place, done, dates), read from its card, never from a copy it stored. A stored copy is only the fallback while the card cannot be read.
- **Dates move.** A linked item that has a date (an event, a poll's result) and is placed by that date moves when the date changes. A person can pin an item to a day instead, and then it does not move.
- **Visibility and access change everywhere.** What a viewer may see is decided per viewer at the time of reading. Losing access shows "not available to you" (not "deleted": the viewer must not learn more than they may). Regaining it shows the item again.

## Design

1. **The server knows the graph, so the server tells holders.** Every write or delete of an item that has a pointer key in the link table raises a generic change: `deleted`, `updated` (its card changed) or `access` (who may see it changed). Modules do not have to remember to announce anything; the store is where it is seen. Holders hear it as `tavern.refs.onChange(fn)`, with `{ ref, change }`, whenever their page is open.
2. **Holders declare what they hold, so the server can clean up when no page is open.** A module names in `module.json` which of its stored items hold a pointer and in which field, and what should happen: `refs.holds: [{ key: "item:", field: "ref", onDelete: "remove" | "mark", sync: { title: "title", date: "when" } }]`. `remove` deletes the holding item; `mark` sets it aside as "gone" (for a place a person still wants to see was there). `sync` names the fields kept in step with the card. The server applies these itself, so the result is right even if nobody has the plan open.
3. **A resolve answer has a state.** `card`, or `{ state: "gone" | "hidden" }`, never a bare error the holder has to interpret. `gone`: the item no longer exists. `hidden`: it exists but this viewer may not see it.
4. **Holders draw the states.** A "gone" holder is a muted placeholder (a broken-link icon, the last known title struck through, "No longer available", a **Remove** action); a "hidden" one says "Not available to you". Neither opens an editor. The design side draws these once (for the card family in Planner, the small pill in Places, the row in a task), and every module that links follows the same look.
5. **Personal items** follow the same rules with one more: a pointer to something in Mine resolves only for its owner and is `hidden` for everyone else, so it is never stored on a shared item without making a room copy first (built for a plan).

## Order of work

1. **Now, to stop the visible bug:** the `state` in resolve answers, and holders using it: Planner shows the gone placeholder, never opens the editor of a missing item, and offers Remove. (Server Development, with the placeholder design from the interface side.)
2. The server raising `deleted` and `updated` from the store and delivering them (`refs.onChange`), and holders refreshing live.
3. `refs.holds` and the server-side cleanup and sync, starting with delete and title.
4. Date sync for placed items, and the pin-to-a-day choice.
5. Access changes as a change event, so viewers update without a reload.

## Open questions

1. Delete: remove or mark, by default? Proposed: remove for plan entries and task links (they only ever pointed), mark for a saved place inside a plan that a person may want to see was once there.
2. Does deleting an item that others link to warn first ("Used by 2 plans")? Proposed: yes, using the backlinks that already exist, in the owner module's delete confirmation.
