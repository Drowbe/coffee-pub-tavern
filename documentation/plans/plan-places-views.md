# Places, Maps and Views Plan

**Audience:** the author deciding how Places and Maps divide the work, and whoever builds it afterwards.

**Status:** Proposed by the interface side from the author's direction. Nothing here is built. Places 0.2.0 and Maps 0.3.0 exist today; this plan changes where things live between them.

## Direction (from the author)

- **Dependency.** Maps needs Places; Places does not need Maps. Places alone is a complete module. Places offers nothing map-related when Maps is absent.
- **Anything done through the map that is about a place belongs in Places.** Maps becomes a view.
- **Search is powered by Places.** Search finds places; the Search address becomes a Places setting, and Maps shows the results on the map.
- **Views: my, room, global.** The same places seen at three scopes.
- **"My" belongs to the person's Profile**, not to a room. It is agnostic of any room and of any module that uses it. The Research module (planned) keeps what a person researched there. None of this is specific to Travel; Travel is the first module that must do it very well.

## Dependency

- A module may declare `requires: ["<module id>"]` in `module.json`. It is the only place a manifest names another module; at run time every module still reaches another only through the generic conduits (actions, refs, the card's `place`).
- Modules tab: Maps cannot be enabled until Places is installed and enabled, and the row says why. Disabling Places while Maps is enabled warns first.
- `uses` stays for the optional case (Places using another module's actions when one is there).

## What moves

| Now in Maps | Where it lives after |
|---|---|
| Save a place (name, notes, category) | Places. The map's "Add place" gesture stays a map gesture: it picks a point, then asks Places to save. |
| Paste coordinates or a map link | Places (its bottom bar already takes both). |
| Search box and the Search address setting | Places. Results are places-to-be; Maps draws them as candidate pins and a pick saves through Places. |
| The list of places, groups, "Open in my maps app", "Copy coordinates" | Places' row menu. Maps keeps a list of what is on the map only if it still earns its place (see below). |
| The pins, clusters, the map file, the credit | Maps. |

Maps' own list panel overlaps Places' list whenever both are open (a narrow pane on a desktop shows both). Decision needed: keep the map's list only for items other modules put on the map ("From ..."), and only in the phone layout, or drop it and rely on Places' list beside the map.

## Views: my, room, global

- **My.** Places that belong to the person, in their Profile. Visible in every room they are in, never to others unless shared to a room.
- **Room.** Places shared with a room. What exists today.
- **Global.** Places for the whole server (a company's offices, a group's regular haunts), set by moderators.
- A place can be copied up (my to room) or down. A card in another module that holds a pointer to a place keeps working across scopes only if the viewer may see that place; otherwise it shows as unavailable, as any pointer does today.
- Places shows a view switcher in its header (a segmented control, phone-safe); Maps draws whichever view is selected, and can show several at once.

## Who builds what

- **Interface side:** the Places header with the view switcher, the row menu with the map items, the trimmed Maps (pins, add gesture, candidate pins), the Modules tab "requires" wording, mocks and contracts first.
- **Server Development:** `requires` in the manifest and its checks, Profile-scoped storage for a module's data (my), the scope rules for pointers across views, moving search, and the version bumps.

## Open questions

1. Does a module's data in the Profile use the same store and change events as a room's, with a different owner? (Server Development.)
2. Global places: who may edit? Proposed: moderators.
3. Copy or move when promoting a place from my to room? Proposed: copy, with the original kept.
4. Does Maps keep any list panel?
