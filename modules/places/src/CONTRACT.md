# Places: the markup and behaviour contract

**Audience:** whoever writes `places.js` (the modules side) and whoever styles it (`places.html`, `places.css`; the interface side).

**What Places is.** The room's saved places: named locations (a hotel, a restaurant, a viewpoint) with an address, an optional position, notes, a category and owners. It needs no map and no map file. Other modules point at a place through the links conduit (a trip stop, an event, a task); a place with a position also gives its card a `place`, so the Maps module draws it. Maps stores no places of its own.

**Canonical markup.** The elements a script clones are the `<template>` elements in `places.html` (`tpl-chip`, `tpl-group`, `tpl-place`, `tpl-owner`, `tpl-link`, `tpl-conflict`, `tpl-readonly`, `tpl-state-*`). The script fills a clone by hooks only, `[data-slot=name]` (textContent) and `[data-icon=name]` (the inline SVG from `tavern.ui.icon`), and toggles the state classes and data attributes below. If this text and the templates disagree, the templates win. `design/places.html` is the reference rendering: open it in a browser for every state, dark and light, at phone, pane and wide sizes.

**Rules that hold everywhere**
- Colours come only from the theme tokens. A light theme must work.
- Nothing has a fixed pixel height; the module fills its pane and scrolls inside it.
- **Narrow means the pane, not the window:** the script sets `.narrow` on `#app` from `tavern.rootElement.clientWidth < 720` (a ResizeObserver, not `matchMedia`, since a bundled module runs in the page). The stylesheet keys on `.app.narrow`.
- Text from people goes in with `textContent`, never as HTML. A category is always an icon and a label.
- No inline styles, with one exception: the item menu's `top` and `left`.

## The page

```
<div id="app" class="app [narrow]">
  <header class="head">                     h1 "Places", [data-slot=count], the filter
  <div id="chips" class="chips">            All, then one chip per category with its count; the shown one has .on
  <main id="body" class="body">             the groups, or a state
  <div id="item-menu" class="menu">         the place menu (hidden)
  <div id="editor" class="editor">          the dialog for one place (hidden)
```

## The list

`#body` holds one `section.group` per category that has places, in the order do, eat, stay, travel, other: an `h2.group-title` (the category's icon and name) and `div.rows` of `article.place-row`. With a category chip on, only that group shows. The filter box matches the title, address and notes as you type.

**A place** (`article.place-row[data-id][data-cat=do|eat|stay|travel|other]`, focusable, Enter opens it): `.mark` with the category icon; `.main` with `h3.title` and `p.sub[data-slot=address]` (absent when there is no address); `.meta` with **exactly one of** `[data-slot=pinned]` ("On the map", when the place has a position) or `[data-slot=nopos]` ("No position yet"), then `[data-slot=owners]` (`.owner`, one initial each) and `[data-slot=links]` (`.link` pills for the items that point at this place: an icon, `<b>` the kind, the title); `button.item-menu[data-action=menu]`. Clicking the row opens the dialog; the menu opens `#item-menu`.

## The place menu (`#item-menu`)

A popover the script places under the button that opened it. Entries: `edit` (its label reads "View" for someone who may not edit), `open-in-maps` (an `a` whose `href` is `geo:lat,lng?q=lat,lng(name)` where that works and the platform's own maps link on iOS, or a search by the address when there is no position; the script chooses), `copy-coords` (hidden without a position) and `delete` (`.danger`, hidden without edit rights). `[hidden]` closes it; a click elsewhere or Escape closes it.

## The dialog (`#editor`)

For someone who may edit: `form#form.editor-card` with `f-title`, `f-category`, `f-address`, `f-point` (a paste field: "38.6916, -9.2160", a `geo:` link or a map link with `?ll=`, `@lat,lng` or `#map=zoom/lat/lng`; the result shows in `#f-point-note`, "Coordinates found." or "No coordinates in that."), `f-notes`, `#f-owners` (a `label.check` per person of the room), `#f-links-out` with `a#f-open-in-maps`, `#f-used-by` (hidden when nothing points at the place) with `.links` of the `.link` pills, `#f-by` (who last changed it), `#f-error`, and `#f-save`, `#f-cancel` ("Close"), `#f-delete` (only when editing). The dialog for **a new place** has the title "Add a place" and no `#f-used-by`, `#f-delete` or `#f-links-out`.

For someone who may not edit: the same card with `tpl-readonly` in place of the fields (a `dl` of category, address, position, whose, then the notes), no Save or Delete.

**Conflict:** if someone else changed the place while it is open, a `tpl-conflict` bar is added above the buttons (`use-theirs`, `keep-mine`), and `#f-error` stays empty.

## Adding

The host's bottom bar quick-add (`tavern.bar.set` with a `quickadd` item, placeholder "Add a place: name, or paste coordinates or a map link"): a name creates a place with that title and opens the dialog to fill in the rest; coordinates or a map link in the text also set the position. `data-action=add-place` in the empty state does the same as an empty submit: it opens the dialog. Another module can ask for a place through the `addPlace` action; that creates one without opening anything.

## States

| State | What the script renders |
|---|---|
| Loading | `#body` holds `tpl-state-loading` |
| No places at all | `#body` holds `tpl-state-empty` with `[data-action=add-place]` (hidden for someone who may not edit); the head and chips are hidden |
| A filter matches nothing | `tpl-state-noresults` with `[data-action=clear-filter]` |
| Someone changed a place that is open | the conflict bar above |
| Error | `p#note.error` under the chips |

## What the map shows

A place with a position gives its card a `place` (`{ lat, lng, name }`), so it appears on the Maps module's map with this module's icon; opening it there brings you here. A place with only an address is listed here and opens its address in the person's maps app, and can be given a position later. That is why "On the map" and "No position yet" are shown: they say whether the map has it.

## Not decided yet

Tags beyond the five categories, sorting other than by name inside a group, importing a list, and sharing a place between rooms.
