# Maps: the markup and behaviour contract

**Audience:** whoever writes `maps.js` (the modules side) and whoever styles it (`maps.html`, `maps.css`, the map style; the interface side). This is the agreement between them, in the same form as the Travel module's.

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
- State: `.selected` on the pin whose card is open (drawn larger, with a ring, and above the others); `.dragging` while one of the admin's own places is being moved; `.draft` on the pin of the place being added (dashed).
- The label is hidden below a zoom level the script chooses (a CSS class on the pin is not needed: it omits `.pin-label`).

## The panel

The header holds `[data-slot=heading]` ("Places" or "Place"), `[data-slot=count]`, a back button (`data-action="back"`, shown only while a place is open) and `data-action="close-panel"`.

**The list** (`#panel-body`): an optional `.notice`, then `.group-title` "Added here" and one `.place-row` per place added in Maps, then `.group-title` "From other modules" and one `.place-row` per item with a place. A row: an icon, `.title`, `.sub` (the address for a place; "Module · when" for an item). `.selected` on the row of the open place (also the pin's). With nothing at all: one `tpl-empty` paragraph.

**A place** (`article.place[data-id][data-kind=place|item]`): `[data-slot=title]`, `.place-where` (`[data-slot=where]`, `[data-slot=coords]` in monospace), `[data-slot=notes]`, for an item `[data-slot=source]` (its module's icon, "from Travel · Day 3" in `[data-slot=from]`, and `[data-action=open]`), `[data-slot=owners]` (`.owner`, one initial each), and `.place-actions`:
- `a[data-action=open-in-maps]`: the primary action. Its `href` is a `geo:lat,lng?q=lat,lng(name)` link where that works, and the platform's own maps link on iOS; the script chooses.
- `button[data-action=copy-coords]`, and, for a `place` only, `edit` and `delete`. An `item` is read-only here; changing it happens in the module that owns it (`open`).

## Search (only when the admin set a search address)

`#search > input[type=search]` and, while there are results, `ul.results#results` of `li > button.result` (`.on` on the highlighted one; arrow keys move it, Enter picks it); each has `[data-slot=title]` and `small[data-slot=sub]`. Picking one moves the map there and starts adding a place at that spot (a draft pin and the editor). Failure or no result: a `.note` item in the list ("No results", "Search is not available right now"). With no address set the whole `#search` is `hidden`.

## Adding a place

Three ways, all ending at the editor with the coordinates filled in:
1. **`data-action=add-place`** turns on adding: `.map.adding` (a crosshair cursor) and `#banner`. A click on the map puts the `.draft` pin there and opens the editor. `data-action=cancel` in the banner (or Escape) leaves adding.
2. **The host's bottom bar** (the same quick-add the other modules have; `tavern.bar.set` with a `quickadd` item, placeholder "Paste a place, coordinates or a map link"). The script reads the text: a coordinate pair ("38.7075, -9.1364"), a map link (`geo:`, `?ll=`, `@lat,lng`, `#map=zoom/lat/lng`) puts a draft pin there; anything else goes to search if a search address is set, else `#note` says "Search is not set up. Paste coordinates or a map link, or click the map."
3. **A search result** (above).

**The editor** (`#editor > form#form`): `f-title`, `f-lat`, `f-lng` (both validated as numbers in range; the pin moves as they are edited), `f-notes`, `#f-by` (who last changed it), `#f-error`, `#f-save`, `#f-cancel`, `#f-delete` (only when editing). A place added in Maps can also be dragged: `.dragging`, and its coordinates are saved on drop.

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

- **Added in Maps:** `{ id, title, lat, lng, notes, owners, by }` in the module's own store, one stored value per place (`place:<id>`), with the store's versions so two people editing different places never collide.
- **Another module's item:** a card with a `place` (`{ lat, lng, name? }`) next to `when`. Maps names no module: it takes every card in the room that has one, through the cards conduit, and draws the module's icon from the card.
- **Giving an item a place:** dropping an item on the map, and the action "Put this on the map", each add a place in Maps that links back to it.

## Not decided yet

Routes and directions (out of scope), an offline area, and heat or category layers.
