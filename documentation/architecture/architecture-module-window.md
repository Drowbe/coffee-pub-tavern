# Module Window Architecture

**Audience:** developers building or changing a module's chrome, or the host code that draws it
(`public/module-host.js`, `public/room-modules.js`, `public/sdk/tavern.js`).

Every module a person can open -- docked beside the call, floating over it, in a window of its own, or
its own standalone page -- is drawn from the same four zones, in the same order, whichever chrome it is
in. This is what keeps a module's own code identical wherever it is shown: it never draws its own
titlebar, and it never needs to know whether it is docked, floating, popped out or on its own page.

## The four zones

```
+----------------------------------------------------+
| Titlebar   name                    [icons] [X]      |  tavern.header.set, the pane's own buttons
+----------------------------------------------------+
| Toolbar    text | tabs | ===progress=== | [buttons]  |  tavern.toolbar.set (optional)
+----------------------------------------------------+
|                                                      |
|  Content                                            |  the module's frame; the drop area
|                                                      |
+----------------------------------------------------+
| Action bar                              [Add] [...] |  tavern.bar.set (optional)
+----------------------------------------------------+
```

- **Titlebar.** Identifies the module and holds window-level actions: the host's own dock/float/window/close
  buttons, plus whatever icon buttons the module adds with `tavern.header.set`, ahead of the pane's own and
  set off by a pipe. Always present wherever a module has a pane or a window; absent on a module's own page
  unless it is popped out (there is nothing to identify or act on when the page already says which module it
  is).
- **Toolbar.** Optional, under the titlebar: information, tabs or a progress bar about the module's current
  state -- a filter, a view switch, an import's progress. Not window-level (that's the titlebar) and not the
  module's primary input (that's the action bar). Set with `tavern.toolbar.set`. Present everywhere the
  titlebar is, and also on a module's own page even when it is not popped out (unlike the titlebar, a
  standalone page still has room under its own header for one). **It is not a second row of titlebar
  icons.** A view or filter switch is `type: 'tabs'`, not `type: 'button'` items repeating what the
  titlebar already looks like -- a tab can still carry an icon when the icon itself means something
  (Places' Mine/This room/Everyone), that is a different thing from a button row standing in for the
  titlebar. `type: 'button'` is for the one action that goes with the toolbar's own state (a Sync button
  next to an import's progress, say), not a place to relocate the titlebar's row. See "Reusable toolbar
  tools" below before building one from raw items.
- **Content.** The module's frame or in-page root. This is the section that scrolls, and the drop target for
  a dragged ref, either as a whole or onto specific items within it.
- **Action bar.** Optional, along the bottom: the module's primary inputs and actions -- an Add button, a
  quick-add field. Set with `tavern.bar.set`. Docked, it is a cell in the room's shared bottom row, lined up
  with the call's own control strip and the chat box (see [architecture-room-layout](architecture-room-layout.md));
  elsewhere it is a strip under the module. The call's own bottom control strip and the chat's input row are
  the same idea as a module's action bar, drawn natively rather than through `bar.set` because they predate
  it -- not a different concept with a different name.

A module never draws its own titlebar or reimplements dock/float/close: `public/module-host.js` draws all
four zones from what a module hands it (`header`, `toolbar`, `bar`, and the frame itself), so the same
`bar.set`/`header.set`/`toolbar.set` calls work whether the pane is docked (`public/room-modules.js`), floating,
popped into its own window (`public/module.js`, only when popped out for the titlebar; the toolbar and action
bar are there regardless), or the module's own standalone page.

## Overflow

`header.set`, `bar.set` and `toolbar.set` each show at most five items before folding the rest into a
"..." the host draws and opens (`toggleOverflow` in `public/module-host.js`) -- the host's own analogue of
`tavern.menu.show`, needed because that one draws inside a module's own frame and these three are the
host's chrome, outside it. An item marked `overflow: true` always goes into the "..." regardless of how many
you set, for something you always want tucked away (a destructive action, say). A `bar.set` quick-add item is
exempt and never counts toward the five. Only `type: 'button'` toolbar items count; a `text`, `tabs`,
`progress` or `slider` item always shows, since it says something about the module (or is itself the
control) rather than being one more action alongside others.

`splitOverflow(items, max)` in `public/module-host.js` is the one place this is decided; each of the three
`.set` handlers calls it the same way, so a module cannot get a different overflow rule in one zone than
another.

## Reusable toolbar tools

The toolbar is a small kit (`text`, `tabs`, `progress`, `slider`, `button`), not a place for each module to
invent its own filter row from scratch. Where a pattern repeats, it gets a real helper in `tavern.ui`
instead of every module hand-rolling the same item array, the same signature-diffing (so a redraw does not
call `toolbar.set` when nothing actually changed) and the same `tavern.on('toolbar', ...)` wiring.

`tavern.ui.viewSwitch({ id, options, value, onChange })` is the first of these: a labelled view or filter
switch, the toolbar's most common tool. It owns the diffing and the event listener; a module calls
`switcher.set(value, options?)` on every render and it only redraws when the value or a label actually
changed (an open count in one option's label, say). Four modules were duplicating this by hand before it
existed (Polls, Calendar, To-do, Planner, each with its own `headerSig`/`syncHeader` pair) -- all four now
call the one helper. Reach for it, or add a new `tavern.ui.*` helper alongside it, before writing a second
copy of that boilerplate; see "Shared tools" in `api-module-sdk.md` for the same rule applied elsewhere in
the SDK.

## The action menu

A menu of independent actions with their own handlers -- a row's "...", a right-click, the + on a joint --
is `tavern.menu.show({ id, items, at, anchor })`, drawn inside the module's own frame. See
[api-module-sdk](../api/api-module-sdk.md) ("An action menu") for the shape. The host's own overflow menus
(above) are the same idea applied to the host's own chrome, where a module cannot reach to draw one itself;
they share no code with `tavern.menu.show` (different documents, in general -- a sandboxed module frame and
the room or module page around it), only the same visual language and the same "showing the same id again
closes it" rule.

## Reuse across dock and float

Switching a docked module to floating (or back) does not rebuild it: `moveModulePane()` in
`public/room-modules.js` pulls the frame (or in-page container), the action bar, the toolbar and the
titlebar's custom-icons span out of the old chrome and moves those same DOM nodes into the new chrome,
so whatever the module is holding onto (a conversation, a draft, a scroll position) survives the switch.
Only the class that lays each one out changes. A window is a real new page, so that still goes through
`closePane` + `popOut` instead -- a frame cannot move between windows without reloading.

This is why the toolbar and action bar are real elements the host hands into `mountModule` (not markup the
module builds), the same as the titlebar's custom span: whichever zone's DOM node is not moved on a mode
switch would otherwise lose whatever `tavern.toolbar.set`/`tavern.bar.set` last drew into it, or worse, leave
`module-host.js`'s own reference to it pointing at a detached node.

## Rules

- **The "..." is one icon.** Every "more" affordance -- the host's overflow at the end of a titlebar, a toolbar or
  an action bar, a card's own menu, a day's, the call's More -- is Font Awesome's `ellipsis-vertical`. Not the
  horizontal `ellipsis`, and not a text glyph standing in for it. It opens `tavern.menu.show` (a module's own) or
  the host's overflow menu; both look the same. Found by hand once (a vertical glyph on a poll, a horizontal
  icon everywhere else), which is what the check below is for.
- **A menu is one of two things.** `tavern.menu.show` inside a module, `toggleOverflow` for the host's own chrome,
  and `tavern.actions.pick` (the drop menu, a choice) draws in `menu.show`'s look. Nothing draws its own list of
  actions.

`tools/check-module-window.mjs` enforces the first rule mechanically, as part of `npm run check`, the way
`check-room-layout.mjs` enforces the room grid's; add a rule there when the next drift shows the shape of one.

## What is not built yet

- **More enforcement.** The zones themselves (a module drawing its own titlebar-like row instead of using
  `header.set`, a bespoke action list instead of `menu.show`) are not checked yet; worth adding to
  `check-module-window.mjs` once a violation shows what to match.
- **Language, not code.** `architecture-room-layout.md` still calls the call's own bottom control strip "the
  video toolbar"/"the call toolbar" in places. It is the same idea as a module's action bar (above); the
  wording there should catch up, without needing the call's own native implementation to actually move onto
  `bar.set`.
- **A toolbar search/filter tool.** Places and Research each still have their own free-text filter field
  drawn in the page, not the toolbar -- `tavern.toolbar.set` has no item type for a text input yet, only
  `tabs` for a fixed set of choices. Worth a `type: 'search'` (or a `tavern.ui.*` helper wrapping one) once a
  second module wants it, rather than guessing its shape from one.

Every module's own "..." menu that was a flat list of actions is on `tavern.menu.show` now (Places, Research,
Travel's gap-add, Polls). What is deliberately still native: Travel's item menu (`#item-menu`) and Places'
and Research's edit dialogs are real forms with selects and fields, not a list of independent actions --
forcing those onto `tavern.menu.show` would be a regression, not a retrofit, since it only draws a flat
list of `{ label, icon, onClick }` rows.
