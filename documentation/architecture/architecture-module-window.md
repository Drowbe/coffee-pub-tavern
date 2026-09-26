# Module Window Architecture

**Audience:** developers building or changing a module's chrome, or the host code that draws it
(`public/module-host.js`, `public/canvas.js`, `public/sdk/host.js`).

Every module a person can open -- docked beside the call, floating over it, in a window of its own, or
its own standalone page -- is drawn from the same four zones, in the same order, whichever chrome it is
in. This is what keeps a module's own code identical wherever it is shown: it never draws its own
titlebar, and it never needs to know whether it is docked, floating, popped out or on its own page.

## The four zones

```
+----------------------------------------------------+
| Titlebar   name                    [icons] [X]      |  host.header.set, the host's own buttons
+----------------------------------------------------+
| Toolbar    text | tabs | ===progress=== | [buttons]  |  host.toolbar.set (optional)
+----------------------------------------------------+
|                                                      |
|  Content                                            |  the module's frame; the drop area
|                                                      |
+----------------------------------------------------+
| Action bar                   [...] [Link] [Add note] |  host.bar.set (optional)
+----------------------------------------------------+
```

- **Titlebar.** Identifies the module and holds window-level actions: the host's own dock/float/window/close
  buttons, plus whatever icon buttons the module adds with `host.header.set`, ahead of the host's own and
  set off by a pipe. Always present wherever a module is on the canvas or in a window; absent on a module's own page
  unless it is popped out (there is nothing to identify or act on when the page already says which module it
  is).
- **Toolbar.** Optional, under the titlebar: information, tabs or a progress bar about the module's current
  state -- a filter, a view switch, an import's progress. Not window-level (that's the titlebar) and not the
  module's primary input (that's the action bar). Set with `host.toolbar.set`. Present everywhere the
  titlebar is, and also on a module's own page even when it is not popped out (unlike the titlebar, a
  standalone page still has room under its own header for one). **It is not a second row of titlebar
  icons.** A view or filter switch is `type: 'tabs'`, not `type: 'button'` items repeating what the
  titlebar already looks like -- a tab can still carry an icon when the icon itself means something
  (Places' Mine/This space/Everyone), that is a different thing from a button row standing in for the
  titlebar. `type: 'button'` is for the one action that goes with the toolbar's own state (a Sync button
  next to an import's progress, say), not a place to relocate the titlebar's row. See "Reusable toolbar
  tools" below before building one from raw items.
- **Content.** The module's frame or in-page root. This is the section that scrolls, and the drop target for
  a dragged ref, either as a whole or onto specific items within it.
- **Action bar.** Optional, along the bottom: the module's primary actions -- an Add button and the few
  that go with it. Set with `host.bar.set`. Typing belongs in Chat, not here: a module registers a command
  (`commands` in `module.json`) and Chat routes the text to it ([plan-one-input](../plans/plan-one-input.md)).
  The quick-add field item still exists, but no bundled module uses it since #58. Docked, it is a cell in the canvas's shared bottom row, lined up
  with the call's own control strip and the chat box (see [architecture-canvas](architecture-canvas.md));
  elsewhere it is a strip under the module. The call's own bottom control strip and the chat's input row are
  the same idea as a module's action bar, drawn natively rather than through `bar.set` because they predate
  it -- not a different concept with a different name.

A module never draws its own titlebar or reimplements dock/float/close: `public/module-host.js` draws all
four zones from what a module hands it (`header`, `toolbar`, `bar`, and the frame itself), so the same
`bar.set`/`header.set`/`toolbar.set` calls work whether the module is docked (`public/canvas.js`), floating,
popped into its own window (`public/module.js`, only when popped out for the titlebar; the toolbar and action
bar are there regardless), or the module's own standalone page.

## Overflow

Each zone folds what it can't show into a "..." the host draws and opens (`toggleOverflow` in
`public/module-host.js`) -- the host's own analogue of `host.menu.show`, needed because that one draws
inside a module's own frame and these three are the host's chrome, outside it. The "..." is drawn by
`drawMoreButton`, the same look as `host.ui.moreButton` (`.sdk-more`) inside a module. In every zone it sits
on the **left**, and leftover items come off the left, so the rightmost item stays. An item marked
`overflow: true` always goes into the "...", for something you always want tucked away (a destructive
action, say).

- **Action bar** (`drawModuleBar`). Fitted by width, not by count. The primary item sits on the far right,
  the other items to its left in the order given, then the "..." at the far left. A `ResizeObserver` on the
  bar redraws it as the module is resized; while the bar overflows its width, the leftmost remaining
  secondary moves into the "...". The primary never folds. A quick-add item is drawn first and never folds.
  At most 10 items are taken.
- **Titlebar and toolbar.** At most five items, by `splitOverflow(items, max)`, which both handlers call the
  same way. Only `type: 'button'` toolbar items count; a `text`, `tabs`, `progress` or `slider` item always
  shows, since it says something about the module (or is itself the control) rather than being one more
  action alongside others.

## Reusable toolbar tools

The toolbar is a small kit (`text`, `tabs`, `progress`, `slider`, `button`), not a place for each module to
invent its own filter row from scratch. Where a pattern repeats, it gets a real helper in `host.ui`
instead of every module hand-rolling the same item array, the same signature-diffing (so a redraw does not
call `toolbar.set` when nothing actually changed) and the same `host.on('toolbar', ...)` wiring.

`host.ui.viewSwitch({ id, options, value, onChange })` is the first of these: a labelled view or filter
switch, the toolbar's most common tool. It owns the diffing and the event listener; a module calls
`switcher.set(value, options?)` on every render and it only redraws when the value or a label actually
changed (an open count in one option's label, say). Four modules were duplicating this by hand before it
existed (Polls, Calendar, To-do, Planner, each with its own `headerSig`/`syncHeader` pair) -- all four now
call the one helper. Reach for it, or add a new `host.ui.*` helper alongside it, before writing a second
copy of that boilerplate; see "Shared tools" in `api-module-sdk.md` for the same rule applied elsewhere in
the SDK.

## The action menu

A menu of independent actions with their own handlers -- a row's "...", a right-click, the + on a joint --
is `host.menu.show({ id, items, at, anchor })`, drawn inside the module's own frame. See
[api-module-sdk](../api/api-module-sdk.md) ("An action menu") for the shape. The host's own overflow menus
(above) are the same idea applied to the host's own chrome, where a module cannot reach to draw one itself;
they share no code with `host.menu.show` (different documents, in general -- a sandboxed module frame and
the space or module page around it), only the same visual language and the same "showing the same id again
closes it" rule.

## Reuse across dock and float

Switching a docked module to floating (or back) does not rebuild it: `moveModule()` in
`public/canvas.js` pulls the frame (or in-page container), the action bar, the toolbar and the
titlebar's custom-icons span out of the old chrome and moves those same DOM nodes into the new chrome,
so whatever the module is holding onto (a conversation, a draft, a scroll position) survives the switch.
Only the class that lays each one out changes. A window is a real new page, so that still goes through
`closeModule` + `popOut` instead -- a frame cannot move between windows without reloading.

This is why the toolbar and action bar are real elements the host hands into `mountModule` (not markup the
module builds), the same as the titlebar's custom span: whichever zone's DOM node is not moved on a mode
switch would otherwise lose whatever `host.toolbar.set`/`host.bar.set` last drew into it, or worse, leave
`module-host.js`'s own reference to it pointing at a detached node.

## Rules

- **The "..." is one icon, and one control.** Every "more" affordance -- the host's overflow in a titlebar, a
  toolbar or an action bar, a card's own menu, a day's, a place's, a poll's, the call's More -- is Font Awesome's
  `ellipsis-vertical`, centered. Inside a module it is `host.ui.moreButton` (class `.sdk-more`, styled by the SDK);
  in the host's chrome it is `drawMoreButton`, with the same class. Not the
  horizontal `ellipsis`, and not a text glyph standing in for it. It opens `host.menu.show` (a module's own) or
  the host's overflow menu; both look the same. Found by hand once (a vertical glyph on a poll, a horizontal
  icon everywhere else), which is what the check below is for.
- **A menu is one of two things.** `host.menu.show` inside a module, `toggleOverflow` for the host's own chrome,
  and `host.actions.pick` (the drop menu, a choice) draws in `menu.show`'s look. Nothing draws its own list of
  actions.

`tools/check-module-window.mjs` enforces the first rule mechanically (the icon, and a `<button>` in a module's markup
with `ellipsis-vertical` must carry `sdk-more`; the call's own More is exempt), as part of `npm run check`, the way
`check-canvas.mjs` enforces the canvas grid's; add a rule there when the next drift shows the shape of one.

## What is not built yet

- **More enforcement.** The zones themselves (a module drawing its own titlebar-like row instead of using
  `header.set`, a bespoke action list instead of `menu.show`) are not checked yet; worth adding to
  `check-module-window.mjs` once a violation shows what to match.
- **Language, not code.** `architecture-canvas.md` still calls the call's own bottom control strip "the
  video toolbar"/"the call toolbar" in places. It is the same idea as a module's action bar (above); the
  wording there should catch up, without needing the call's own native implementation to actually move onto
  `bar.set`.
- **A toolbar search/filter tool.** Places and Research each still have their own free-text filter field
  drawn in the page, not the toolbar -- `host.toolbar.set` has no item type for a text input yet, only
  `tabs` for a fixed set of choices. Worth a `type: 'search'` (or a `host.ui.*` helper wrapping one) once a
  second module wants it, rather than guessing its shape from one.

Every module's own "..." menu that was a flat list of actions is on `host.menu.show` now (Places, Research,
Travel's gap-add, Polls). What is deliberately still native: Travel's item menu (`#item-menu`) and Places'
and Research's edit dialogs are real forms with selects and fields, not a list of independent actions --
forcing those onto `host.menu.show` would be a regression, not a retrofit, since it only draws a flat
list of `{ label, icon, onClick }` rows.
