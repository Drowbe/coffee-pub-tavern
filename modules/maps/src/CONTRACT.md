# Maps: the markup and behaviour contract

**Audience:** whoever writes `maps.js` (the modules side) and whoever styles it (`maps.html`, `maps.css`, the map style; the interface side). This is the agreement between them, in the same form as the Travel module's.

**What Maps is.** A map of every place the room has: a view with **no data of its own**. It draws every card in the room that carries a `place` (the Places module's places, and any other module's items that have one), grouped by the module they come from. Saving a new place from the map hands it to the Places module through the `addPlace` action; if nothing provides that action, the add tools are hidden and the sheet says "Install Places to save places".

**Canonical markup.** The elements a script clones are the `<template>` elements in `maps.html` (`tpl-pin`, `tpl-pin-cluster`, `tpl-row`, `tpl-group-title`, `tpl-empty`, `tpl-notice`, `tpl-place`, `tpl-owner`, `tpl-result`, and the `tpl-state-*` blocks). The script fills a clone by hooks only, `[data-slot=name]` (textContent) and `[data-icon=name]` (the inline SVG from `tavern.ui.icon`), and toggles the state classes and data attributes below. If this text and the templates disagree, the templates win; tell the interface side. `design/map.html` is the reference rendering: open it in a browser to see every state, dark and light, at phone, pane and wide sizes. The map itself is a drawn stand-in there; the real one is MapLibre.

**How it works.** `maps.css` styles the elements by their classes and attributes. The script builds these elements and toggles states; it never sets a style. The one exception is a pin's position, which the map library sets on its marker element.

**Rules that hold everywhere**
- Colours come only from the theme tokens (`--bg`, `--bg-section`, `--bg-card`, `--border`, `--text`, `--text-dim`, `--accent`, `--on-accent`, `--danger`), in the page and in the map style. A light theme must give a light map.
- Nothing has a fixed pixel height; the module fills its pane. No `100vh`.
- Text from people goes in with `textContent`, never as HTML. An icon is `<span class="ic" data-icon="name">`.
- **The credit is always on the map:** `.attribution` ("© OpenStreetMap contributors", linking to the licence page) is in the bottom-right of every map. No setting hides it, and the script never removes it. If the tile file's metadata names another credit (a tile builder's), the script appends it inside the same element.
- No default remote tiles and no call to any service unless the admin set one: the map reads the admin's file (`tavern.files.url`) and, if set, the search address.

## The page

```
<div id="app" class="app [listonly]">              the whole page; un-hidden when loaded
  <div class="stage">
    <div id="map" class="map [adding]">            the map library draws here; pins are markers in it
    <div class="mapbar">                           what floats over the top of the map
      <div id="search" class="search">             only when a search address is set (hidden otherwise)
      <div class="tools"> add-place, toggle-panel
    <div id="ctrl-zoom" class="maplibregl-ctrl-top-right">   zoom in, out, locate me
    <div class="maplibregl-ctrl-bottom-right"><div class="attribution">
    <div id="banner" class="banner">               'Click the map to place a pin' while adding
    <div id="state" class="state">                 replaces the map (see States)
  <aside id="panel" class="panel" data-state="open|peek">   the list, or the place being looked at
  <div id="editor" class="editor">                 the dialog for a place
```

## Wide and narrow

- **Wide** (the frame is 720 px or more): the panel is a 340 px column on the right, always open (`data-state="open"`); `toggle-panel` hides and shows it.
- **Phone or narrow pane** (under 720 px): the panel is a **sheet** over the foot of the map with a handle (`.sheet-handle`). `data-state="peek"` shows only its header ("Places", the count); `open` shows up to 72% of the pane. The script sets `open` when a place is selected and `peek` when it is closed. The search box takes the full first row and the tools sit under it; the credit sits above the sheet's peek.

## Pins (markers on the map)

`<button class="pin" data-kind="place|item|cluster" data-id="…">` with `.pin-body` (an icon, or a count for a cluster) and `.pin-label`.
- `place`: a place added in Maps (accent fill, a location icon). `item`: another module's item with a `place` on its card (card fill, that module's icon). Clusters replace pins that would overlap; a cluster is `.pin.cluster` and clicking it zooms in.
- State: `.selected` on the pin whose card is open (drawn larger, with a ring, and above the others); `.draft` on the pin of the place being added (dashed).
- The label is hidden below a zoom level the script chooses (a CSS class on the pin is not needed: it omits `.pin-label`).

## The panel

The header holds `[data-slot=heading]` ("Places" or "Place"), `[data-slot=count]`, a back button (`data-action="back"`, shown only while a place is open) and `data-action="close-panel"`.

**The list** (`#panel-body`): an optional `.notice`, then one `.group-title` per module that has places ("Places", "Travel", "Calendar", by the module's name; Places first) and one `.place-row` per card with a `place`. A row: the module's icon, `.title`, `.sub` (the address or subtitle from the card). `.selected` on the row of the open place (also the pin's). With nothing at all: one `tpl-empty` paragraph.

**A place** (`article.place[data-id][data-kind=place|item]`; `place` is a Places place, `item` another module's item with a position): `[data-slot=title]`, `.place-where` (`[data-slot=where]`, `[data-slot=coords]` in monospace), `[data-slot=notes]`, for an item `[data-slot=source]` (its module's icon, "from Travel · Day 3" in `[data-slot=from]`, and `[data-action=open]`), `[data-slot=owners]` (`.owner`, one initial each), and `.place-actions`:
- `a[data-action=open-in-maps]`: the primary action. Its `href` is a `geo:lat,lng?q=lat,lng(name)` link where that works, and the platform's own maps link on iOS; the script chooses.
- `button[data-action=copy-coords]`. Every place is read-only here; changing it happens in the module that owns it (`open`, which brings you to the place in Places or to the item in its own module).

## Search (only when the admin set a search address)

`#search > input[type=search]` and, while there are results, `ul.results#results` of `li > button.result` (`.on` on the highlighted one; arrow keys move it, Enter picks it); each has `[data-slot=title]` and `small[data-slot=sub]`. Picking one moves the map there and starts adding a place at that spot (a draft pin and the editor). Failure or no result: a `.note` item in the list ("No results", "Search is not available right now"). With no address set the whole `#search` is `hidden`.

## Adding a place

Three ways, all ending at the editor with the coordinates filled in:
1. **`data-action=add-place`** turns on adding: `.map.adding` (a crosshair cursor) and `#banner`. A click on the map puts the `.draft` pin there and opens the editor. `data-action=cancel` in the banner (or Escape) leaves adding.
2. **The host's bottom bar** (the same quick-add the other modules have; `tavern.bar.set` with a `quickadd` item, placeholder "Paste a place, coordinates or a map link"). The script reads the text: a coordinate pair ("38.7075, -9.1364"), a map link (`geo:`, `?ll=`, `@lat,lng`, `#map=zoom/lat/lng`) puts a draft pin there; anything else goes to search if a search address is set, else `#note` says "Search is not set up. Paste coordinates or a map link, or click the map."
3. **A search result** (above).

**The dialog** (`#editor > form#form`, "Save this place"): `f-title`, `f-notes`, `#f-where` (the coordinates and address it will save, read-only), `#f-error`, `#f-save` ("Save to Places") and `#f-cancel`. Saving calls the `addPlace` action with the name, notes and position; when it is done the draft pin becomes the saved place's pin (the Places module's card arrives through the cards conduit). Nothing here edits or deletes a place, and pins are not draggable.

## States

| State | What the script renders |
|---|---|
| Loading | `#state` (un-hidden) holds `tpl-state-loading` |
| No map file, an admin | `#state` holds `tpl-state-nomap-admin`, with `[data-action=open-settings]` |
| No map file, anyone else | `tpl-state-nomap-member`; the list is shown full width (`.app.listonly`) |
| The map file will not load | `tpl-state-error` with `[data-action=retry]` |
| No WebGL on this device | `.app.listonly`, and a `tpl-notice` at the top of the list: the places are listed, each with open-in-my-maps-app |
| No places yet | the map, and `tpl-empty` in the list |
| Search not set up | `#search` hidden; nothing else changes |
| A place changed by someone else while it is open in the editor | `#f-error` says so (the script's version conflict message) |

## The map style (`maps.css` is not enough: the map is drawn by the library)

The script builds the map's style from the theme tokens at load and again when the theme changes (reading `getComputedStyle` of the root), so the map is never a fixed dark or light picture. The style is the interface side's to specify and the script's to build; the mapping, by the basemap schema's layer names:

| Layer | Colour |
|---|---|
| background, `earth` | `--bg-section` |
| `landuse` (parks, woods), `natural` | `--accent` 9% over `--bg-section` |
| `water` | `--text` 9% over `--bg-section` |
| `roads` major | `--text` 16% over `--bg-section`; minor and paths `--border` |
| `buildings` | `--text` 6% over `--bg-section` (from zoom 15) |
| `boundaries` | `--text-dim`, dashed |
| `places` labels | `--text` for cities, `--text-dim` for the rest, halo `--bg-section` |
| `pois` | not drawn: the pins are the points of interest |

No sprite or icon font is needed. Labels use one Latin glyph set at first (see the plan). Fewer layers than a general basemap on purpose: it keeps the file small to read and the map calm behind the pins.

## Where a place comes from

- **Every card in the room with a `place`** (`{ lat, lng, name? }`), through the cards conduit. Places produces them (a place with a position); Travel, the Calendar and others may too. Maps names no module: it draws the module's icon from the card and groups the list "From <module>".
- **A new place** is created by the module that provides `addPlace` (Places today), never stored by Maps. If nothing provides it, Maps is view-only.
- **Giving another module's item a place** stays with that module.

## Once search and saving move to Places (see plan-places-views.md)

Maps becomes a view of places and a gesture to choose a point. What stays: the pins, clusters, the map file, the credit, `add-place` (click the map to choose a point), `open-in-maps` and `copy-coords` on a selected place. What changes in the design (the scripts follow when Server Development builds the actions):
- **`#search`** keeps its place on the map, but its results come from Places (an action that returns a few results), so they are the same as the ones Places shows when its bar searches. A result is drawn as a **candidate pin** (`.pin.candidate`: dashed outline, surface fill, no count); picking one (`data-action=save-found` in its callout) asks Places to save it.
- **Saving** is Places' dialog: after a click on the map the map asks Places to add a place at that point (the `addPlace` action with the position) and Places opens its own dialog. The map's `#editor` goes away, with `f-title`, `f-notes` and `#f-where`; the draft pin stays until Places has saved or the person cancels.
- **No list panel.** Maps requires Places, so Places is the list (decided by the author). `#panel`, its rows, groups and the phone sheet go away; the map shows pins, and an item from another module opens in its own module. Selecting a pin shows its callout on the map.
- **A pin from mine** (the person scope) has `data-scope="person"`, which draws the small person mark on it.
- **Views** (mine, this room, everyone): Maps draws whichever view Places has selected, and a pin from mine wears a small person mark so it is not mistaken for a shared one.

## Not decided yet

Routes and directions (out of scope), an offline area, and heat or category layers.
