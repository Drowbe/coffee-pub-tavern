# Canvas Architecture

**Audience:** developers changing the space page in Collaborator: the canvas, and the modules on it (the conference, the chat and installed modules).

How a space's canvas is built and the rules that keep it predictable. The conference and the chat are built-in modules, handled the same way as an installed one. What a player sees is in [userguide-call](../userguides/userguide-call.md); colors are in [design-theme](../designsystem/design-theme.md).

## The grid

The canvas (`#canvas` in `public/space.html`) is a CSS grid. Each **module** owns a column with two parts: a **content** area (`.mod-content`) and an **action bar** (`.mod-bar`). The bars share the bottom row, so they line up, and that row is as tall as the tallest bar. Nothing is measured.

```
+-------------------------------+--------------------+
| video content                 | chat content       |
+-------------------------------+--------------------+
| video bar (toolbar)           | chat bar (format,  |
|                               | message box)       |
+-------------------------------+--------------------+
```

- **Columns.** One column per docked module, in order: the conference, the chat, then installed modules. `syncDock()` in `public/canvas.js` sets the whole template as `--canvas-cols`: one column is flexible (`minmax(0, 1fr)`) and the others are fixed widths. The flexible column is the conference when it is docked, else the first docked module, so the canvas never has an empty column. `.is-flex` marks it and hides its resize handle.
- **Rows.** `minmax(0, 1fr)` for content, then `auto` for the bars.
- **Modules.** A `.module` element has `display: contents`, so its content and bar become items of the canvas grid, placed by `grid-column` and `grid-row`. Video is `.module-video`, chat is `.module-chat` (the `#chat` element).
- **Closing a module** hides it and removes its column, so the others take the width. With nothing open the canvas shows `#canvas-empty`.

**When the columns do not fit.** If the fixed columns together are wider than the canvas leaves them (the canvas minus the conference's minimum), `syncDock()` shows them squeezed in step and the conference stays at its minimum. A drag would then change a stored width that is not what is on screen, so `settleDock()` (called as a drag starts) gives each fixed module the width it is showing, and `takeWidthFromOthers()` takes the width for a widening column from the other fixed columns, not from the conference or from the column being dragged. Narrowing a column then gives the width to the conference.

**Reordering.** A docked module is dragged by its titlebar (`wireReorder()` in `public/canvas.js`; buttons in the bar still click, and a press that does not move is a click). While it moves, `.canvas.reordering` is set and the module's parts wear `.module-lifted`; the pointer's place among the other columns (their widths read from the canvas's computed `grid-template-columns`) gives the new index, the docked modules' `order` values are reassigned in that sequence, and `syncDock()` moves the columns live. The order is remembered with the layout (`__open`), and `restore()` applies it to every module, the conference and the chat included. It does nothing on a narrow canvas, where the modules are tabs.

The chat's resize handle (`#chat-resize`) is its own grid item spanning both rows, on the chat column's left edge, so dragging it moves the content and the bar together.

## Docked and floating

A bar is a cell in the bottom row of its column. In the popped-out window (`body.popout`) the conference keeps its titlebar and its toolbar, and both slide away when the canvas goes `.idle` (nothing has moved for a moment): the titlebar up, the toolbar down. Idle takes them out of the flow (`position: absolute` plus a transform), so the tiles take the whole window, and the next movement slides them back. The chat bar stays docked, because the message box needs a fixed place.

A module that is *floating* (over the page, in the floating layer) or in a window of its own has its content and bar stacked in that floating frame or window; there is no floating bar.

**Free or snapped.** Floating is free by default: anywhere over the page, any size, the box (`{ x, y, w, h }`) remembered per module. A floating module's titlebar has a toggle (`[data-snap]`, `aria-pressed`) that makes it *snap* instead: it sits in the cells of a grid laid over the canvas (as many cells as the canvas fits at the grid's pitch, never fewer than one, with a 16px gutter; the whole window when the canvas is not shown; a module never takes fewer cells than its smallest size needs), dragging moves it a cell at a time, resizing grows it a cell at a time, and what is remembered is its cells (`cell: { col, row, cols, rows }`, beside the box), so a window resize re-tiles it into the grid the new size makes rather than just keeping it on screen. Turning snap on settles the module into the cells nearest its box at once; turning it off leaves it where it is, free again. The grid itself (`.snap-grid` in the floating layer, sized to the canvas, the cell pitch in `--snap-cw`/`--snap-ch`) is drawn only while a snapped module is being dragged or resized (`.module-layer.snapping`). `snapGrid`, `snapCell`, `cellBox` and `settleSnap` in `public/canvas.js` are the whole of it. Two canvas-level controls sit in the space bar (the `snap-all` switch and the `snap-size` slider, registered in `public/space.js` with the nav registry and wired to `canvas.snapAll`/`setSnapPitch`): a switch that puts every module that can float onto the grid: the docked ones are floated first (their docked mode remembered in `__snap.before`) and every floating module snaps, each one's own switch following; any module opened later opens floating and snapped (`preferredMode`, `api_openBuiltin`); turned off, the modules that were docked when it went on dock again and the rest stay floating, free. A module on a narrow canvas (a phone) is left docked either way. And, while it is on, a slider for the grid's pitch (a cell's width, 60 to 320px, 130 by default; a cell is 0.77 as tall), which refits every snapped module to the cells nearest its box and shows the grid while it moves. Both are remembered with the space's layout (`__snap: { all, pitch }`), so a space keeps its grid. Docked and window are untouched, and a module's DOM keeps its identity through every snap, the same as through a free drag. Snap is a way of floating, not a replacement for docking: the dock's "one flexible column never leaves a gap" rule does not apply to it, and more than one snapped module may share a cell (the later one in front), as free modules may overlap. The way back is the bar's **Dock all** (the `dock-all` tool, `canvas.dockAll()`): every floating module that can be a column docks, and the canvas-level switch goes off first with nothing remembered to restore, since it would float a module again the moment it opened; a module in its own window, or one that can only float, is left alone.

## Popovers

The settings popover, the reactions tray and the overflow menu live inside the video bar's wrapper and hang off it with `bottom: calc(100% + 10px)`. They follow the bar in either state and never depend on a guessed pixel offset.

## Narrow windows

`applyLayout()` in `public/space.js` sets `narrow` on the canvas below 640px wide (and `compact` below 460px, `tiny` below 300px, which only shrink sizes). With `narrow` the grid is a single column and one view is shown at a time: the conference, the chat or a module takes the whole canvas, with its bar under it. The views that are not shown stay open and are hidden with `.narrow-hidden` (`syncView()` in `public/canvas.js`), so a call keeps running with the microphone and camera as they were while the chat is read. Because the microphone can be live with the conference hidden, the conference's tab carries the `in-call` class while the call is on, for the phone's tab bar to mark. `view` starts on the conference after a join and moves to whatever is opened.

## Rules

- **The header height is one token.** `--module-header-h` sets every module header strip so neighbouring columns line up. Nothing else sets a module header height.
- **The bottom row has one control height.** `--bar-control-h` (38px) is the height of every control in the shared bottom row: the call toolbar's buttons (`.fbtn`), the chat's icons button, input and Send, and each module's quick-add field and button. The bars pad by the same 8px, so a single-line bar is the same height in every cell and the controls line up; a multi-line chat message grows the chat cell upward from the bottom edge. Nothing else sets a control height in that row.
- **No measured heights.** `--barh` and `--floatbar-h` are gone. Anchor to the bar instead of measuring it, and let the row size itself.
- **No hand-subtracted widths.** A module that needs width gets a column; nobody writes `calc(100% - chat-w)`.
- **Colors come from tokens.** See [design-theme](../designsystem/design-theme.md).

`tools/check-canvas.mjs` enforces the first three, and runs as part of `npm run check`.

## Modules: the conference, the chat and installed modules

The conference and the chat are built-in modules (`registerBuiltin` in `public/canvas.js`), and `public/canvas.js` manages them and installed modules alike. Each module can be **docked** (a column of the grid: conference, chat, then modules in the order they opened), **floating** (draggable and resizable, in a layer on the page) or in a **window** of its own, and each has the same titlebar buttons to switch (dock or float, open in a window, close). The conference's close button leaves the call. The chat is a native module: its DOM already exists in the page, and the canvas manager moves it between the canvas, the floating layer and a popup window (a node moved to another document keeps its listeners, which is also how the whole canvas pops out). An installed module is a frame the host builds in the same places, but switching between docked and floating (`setMode` → `moveModule`) moves that same frame (and its action bar and header buttons) into the new chrome instead of rebuilding it, the same reasoning as the chat: whatever the module is holding onto (a conversation, a draft, ...) survives the switch. Only a window is a real new page — a frame cannot move between windows without reloading — so popping out still opens the module fresh, and coming back from it does too.

Docked modules set `--canvas-cols` on the canvas and each part's `grid-column`; the fixed columns together may not take more than the canvas minus a minimum for the flexible one, and shrink in step past that. The chat's width is one of those columns, remembered in `prefs.chatWidth`.

When the call is popped out, the canvas moves to the popup window and every module follows it: docked modules are inside the canvas and go with it, a floating chat is carried across, and each module is opened again in the new window, because a frame cannot move between windows without reloading and its messages arrive in the window it lives in. Closing the popout brings everything back.

## The conference module

The conference's titlebar (`.conference-head`, a `.mod-header` at `--module-header-h`) is the first thing in its content, above the tiles. The overlays for asides, the recall countdown and away (`#aside-overlay`, `#recall-overlay`, `#away-overlay`) are inside the same content, so they cover the conference wherever it is.

Floating or in a window, the conference is not inside the canvas, but its tiles and toolbar are styled by an ancestor `.canvas`, so the canvas manager wraps it in a `.canvas.conference-canvas` (`def.wrap`). Page code finds its elements through `$()`, which falls back to the conference element, and reads the conference's size (not the canvas's) for the `compact` and `tiny` classes. A window has its own document, so the conference registers `onWindow` to attach the idle, outside-click and key listeners there. A module's `pagehide` handler is registered only after its window has loaded, because the blank page a popup starts as also fires `pagehide` when it navigates, and that must not read as the person closing it. Moving the conference between docked, floating and a window passes `moving: true` to `onChange`, so the call keeps running; only opening or closing it starts or stops the call.

The header at the top of the page has two rows, each in three zones (see [architecture-navigation](architecture-navigation.md)). The first is the primary nav (the system: the logo and where you are; the core navigation; your profile, Manage, the time, Sign out). The second is the secondary nav, the **space bar** (`#subnav`, built in `public/space.js`, only in a space): on the left the space's name and `#modules-menu`, a row of switches for the modules (`public/canvas.js` renders them and treats the `subnav-modules` class as an always-open, in-place list); the middle is the space's own information and navigation (empty so far); on the right the canvas-level snap, Full screen, Pop out, Pull participants back, a divider and Leave space (`leave-space`). Full screen and Pop out apply to the whole app (they show their exit and pop-in forms while active). Pop out moves the header (`#topbar`) and the canvas into the popup, so every control works where you are; the page behind shows `#away` with a "Bring the app back" button. Code that reads header parts looks inside the header element as well as the document (`byId`/`qsa` in `public/brand.js`, and `$()` in `public/space.js`). The header's links would navigate the popup away from the space, so a click on one in the popup brings the app back first and then acts on the page. Idle hides the header along with the titlebar and toolbar (`.popout:has(.canvas.idle) .topbar`).

## Phones

Below 640px (the width `applyLayout()` calls `narrow`) the space page is a phone layout, in one `@media (max-width: 640px)` block at the end of `public/style.css`: a slim header, then the canvas, then the space bar as a tab bar (icon over name, the accent color for an open module; Full screen and Pop out are hidden, Leave stays). `public/space.js` moves `#subnav` out of the header and after the canvas on a phone (and back when the window widens), so the bar is the last thing in the page's column and the call toolbar sits directly above it; nothing measures or pads for it. Its own bottom padding is the safe-area inset, which keeps the icons clear of a browser's bottom bar. `body.in-space` is `position: fixed; top: 0` with `height: 100dvh` (no `inset: 0`, no `100%`): see the measurements below. The tab bar switches the view: the highlighted tab (`.on`) is the view being shown, tapping another tab shows it, and tapping never closes a module or hangs up (the hang-up button and the conference's own close are the way out of the call). The other views stay open but hidden, so the call keeps running, and because the microphone can be live while the conference is hidden, the Conference tab carries a dot while you are in the call: green with the microphone off, red while it is live (`reflectMic()` in `public/space.js` sets `data-mic` on `#modules-menu`, and `canvas.js` puts `in-call` on the tab).

### What an iPhone reports (measured with /diag.html)

iPhone 13 Pro Max, iOS 26.6, portrait, screen 428 x 926:

| | `window.innerHeight` | `100dvh` / `svh` / `lvh` | `100%` | fixed `bottom:0` ends at | safe-area top / bottom |
|---|---|---|---|---|---|
| Chrome tab, address bar showing | 740 | 740 / 740 / 777 | 740 | 740 (just above the bar) | 0 / 0 |
| Home-screen app, `viewport-fit=cover` | 926 | 926 / 879 / 926 | 879 | 926 | 47 / 34 |
| Home-screen app, `viewport-fit=auto` | 879 | 879 (all) | 879 | 879 | 0 / 0 |

- In Chrome the page starts below the status bar and ends above the address bar; `100dvh` is exactly the visible height, and a fixed `bottom: 0` is right. The safe-area insets are 0 there, so nothing may depend on them in a browser tab.
- An element pinned with both `top: 0` and `bottom: 0` (`inset: 0`) took the large viewport (777), which put the bottom 37px under Chrome's bar.
- In the home-screen app with `cover` the page is under the status bar (top inset 47) and the home indicator (bottom inset 34), and the insets are real, so the header and the tab bar pad by them. `100%` is 47px short there (the strip under the tab bar), so nothing uses it for the height.
- The home-screen app runs in Safari's engine (its user agent says Safari), not Chrome's.
`/diag.html` (linked from Manage, About) reports these numbers for any device.

## Remembered layouts

Each space remembers its own layout in the browser (`localStorage`, key `app.canvas.<space id>`; `public/brand.js` moves the old `app.panels`, `app.panels.<id>` and `tavern.panels.<id>` keys to these once on load, only where the new key is empty): the modules that were open when it was last used (`__open`, ids in column order) and, per module, its mode, docked width, floating box and window size. `app.canvas` alone (moved from `app.panels`) is what earlier versions kept for every space, and is the starting point for a space with nothing saved.

- `createCanvas()` in `public/canvas.js` writes the open list from `update()` (`snapshot()`), so any change of modules is remembered. Nothing is written while the manager is suspended: from the start of a space's teardown (`suspend()`, called first in the Disconnected handler) until the next join has restored its modules (`restore()`), and while a pop-out reopens the modules. Closing every module on the way out therefore never becomes the layout. An aside has no space id and remembers nothing.
- `restore()` runs after a join connects: it opens the saved modules (natives first, then modules the space has on), or just the conference for a space with nothing saved. A module the person no longer has (a permission taken away, a module turned off) is skipped. Hanging up before leaving is remembered like any other change, so the next join has no conference.
- The space list's "Join with" button writes the same list (`setJoinModules()`) without joining, so a person can choose a chat-only or Calendar-only join. It lists the conference, the chat and the space's modules, minus what the role does not allow.

## The conference and the call

Being in the space and being in the conference are separate. The page stays connected to the space's LiveKit session for the chat and the modules (chat travels over LiveKit's data channel), and sends and receives audio and video only while the conference module is open.

- The conference is a native module (`id: 'conference'`, `order: -1`, `flex: true`, docked only). Its `onChange` in `public/space.js` runs `startCall()` when it opens and `stopCall()` when it closes. The page connects with `autoSubscribe: false`; `startCall()` subscribes to everyone's tracks and publishes the microphone, and `stopCall()` unpublishes, unsubscribes and removes the tiles.
- A participant attribute, `call` (`on` or `off`), says whether a person is in the conference. The server sets it in the token; the page changes it with `setAttributes`. A tile exists only for a person whose attribute is not `off`, and only while I am in the conference myself (`shownInCall()`). `GET /api/presence` reports `inCall` per person, and the aside route (`POST /api/asides`) refuses anyone who is not in the conference.
- The hang-up button closes the conference module, which leaves the call and stays in the space. Leave space, at the right of the space bar, disconnects. Closing the module in a pop-out window first brings the canvas back to the page.
- The module switches (`#modules-menu`) are in the space bar, not the toolbar, so they work with the conference closed. The conference's menu entry reads "Rejoin call" while it is closed.
- The "See and join the conference" permission is enforced in the token: without it the token cannot publish or subscribe, and the module cannot be opened.

## Docked installed modules

An installed module can dock as a column after the chat. `public/canvas.js` adds a `.module.module-docked` element to the canvas holding a `.dock-resize` handle and a `.mod-content` with a host-drawn `.mod-header` (at `--module-header-h`) and the module's frame. If the module has set an action bar (`host.bar.set`), the section also holds a `.dock-bar` in the bottom row of its column, so its buttons line up with the video toolbar and the chat box, and the content sits above it; with no bar the content spans both rows. The canvas sets `--canvas-cols` and places each column, so the template is one column per docked module, with the conference or the first module flexible. Dragging a column's left edge changes only that column's width.

On a narrow window one view is shown at a time (see the narrow rules above). A module opens docked, laid out as the chat is (the canvas gets `module-open`, set by `syncDock`, beside `chat-open` and `conference-open`): it fills the canvas, its action bar below it. A module that cannot dock still floats. Its titlebar buttons are 44px wide for touch, at the shared header height.

The next docked module needs nothing here: it is the same element with the next column number.
