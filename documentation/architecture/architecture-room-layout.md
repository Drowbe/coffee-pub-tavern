# Room Layout Architecture

**Audience:** developers changing the room page in Coffee Pub Tavern: the conference, the chat, or anything that docks beside them.

How the table's layout is built and the rules that keep it predictable. What a player sees is in [userguide-table](../userguides/userguide-table.md); colors are in [design-theme](../designsystem/design-theme.md).

## The grid

The stage (`#stage` in `public/room.html`) is a CSS grid. Each **module** owns a column with two parts: a **content** area (`.mod-content`) and an **action bar** (`.mod-bar`). The bars share the bottom row, so they line up, and that row is as tall as the tallest bar. Nothing is measured.

```
+-------------------------------+--------------------+
| video content                 | chat content       |
+-------------------------------+--------------------+
| video bar (toolbar)           | chat bar (format,  |
|                               | message box)       |
+-------------------------------+--------------------+
```

- **Columns.** One column per docked pane, in order: the conference, the chat, then modules. `syncDock()` in `public/room-modules.js` sets the whole template as `--stage-cols`: one column is flexible (`minmax(0, 1fr)`) and the others are fixed widths. The flexible column is the conference when it is docked, else the first docked pane, so the stage never has an empty column. `.is-flex` marks it and hides its resize handle.
- **Rows.** `minmax(0, 1fr)` for content, then `auto` for the bars.
- **Modules.** A `.module` element has `display: contents`, so its content and bar become items of the stage grid, placed by `grid-column` and `grid-row`. Video is `.module-video`, chat is `.module-chat` (the `#chat` element).
- **Closing a pane** hides it and removes its column, so the others take the width. With nothing open the stage shows `#stage-empty`.

The chat's resize handle (`#chat-resize`) is its own grid item spanning both rows, on the chat column's left edge, so dragging it moves the content and the bar together.

## Docked and floating

A bar is a cell in the bottom row of its column. In the popped-out window (`body.popout`) the conference keeps its titlebar and its toolbar, and both slide away when the stage goes `.idle` (nothing has moved for a moment): the titlebar up, the toolbar down. Idle takes them out of the flow (`position: absolute` plus a transform), so the tiles take the whole window, and the next movement slides them back. The chat bar stays docked, because the message box needs a fixed place.

A pane that is *floating* (a panel over the page) or in a window of its own has its content and bar stacked in that panel or window; there is no floating bar.

## Popovers

The settings popover, the reactions tray and the overflow menu live inside the video bar's wrapper and hang off it with `bottom: calc(100% + 10px)`. They follow the bar in either state and never depend on a guessed pixel offset.

## Narrow windows

`applyLayout()` in `public/room.js` sets `narrow` on the stage below 640px wide (and `compact` below 460px, `tiny` below 300px, which only shrink sizes). With `narrow` and chat open, the grid is a single column. In the conference too (`.conference-open` on the stage), the conference stays visible as a strip above the chat: the conference content, the chat content, the chat bar, then the toolbar. The conference is never hidden while the person is in the call, because a hidden conference would leave their microphone or camera live without them seeing it. With the conference closed, the chat takes the whole column.

## Rules

- **The header height is one token.** `--module-header-h` sets every module header strip so neighbouring columns line up. Nothing else sets a module header height.
- **No measured heights.** `--barh` and `--floatbar-h` are gone. Anchor to the bar instead of measuring it, and let the row size itself.
- **No hand-subtracted widths.** A module that needs room gets a column; nobody writes `calc(100% - chat-w)`.
- **Colors come from tokens.** See [design-theme](../designsystem/design-theme.md).

`tools/check-room-layout.mjs` enforces the first three, and runs as part of `npm run check`.

## Panes: the conference, the chat and modules

The conference and the chat are panes like a module: `public/room-modules.js` manages all three. Each pane can be **docked** (a column of the grid: conference, chat, then modules in the order they opened), **floating** (a draggable, resizable panel in a layer on the page) or in a **window** of its own, and each has the same titlebar buttons to switch (dock or float, open in a window, close). The conference's close button leaves the call. The chat is a native pane: its DOM already exists in the page, and the pane manager moves it between the stage, a floating panel and a popup window (a node moved to another document keeps its listeners, which is also how the whole stage pops out). A module is a frame the host builds in the same places.

Docked panes set `--stage-cols` on the stage and each part's `grid-column`; the fixed columns together may not take more than the stage minus a minimum for the flexible one, and shrink in step past that. The chat's width is one of those columns, remembered in `prefs.chatWidth`.

When the call is popped out, the stage moves to the popup window and every pane follows it: docked panes are inside the stage and go with it, a floating chat is carried across, and each module is opened again in the new window, because a frame cannot move between windows without reloading and its messages arrive in the window it lives in. Closing the popout brings everything back.

## The conference pane

The conference's titlebar (`.conference-head`, a `.mod-header` at `--module-header-h`) is the first thing in its content, above the tiles. The overlays for asides, the recall countdown and away (`#aside-overlay`, `#recall-overlay`, `#away-overlay`) are inside the same content, so they cover the conference wherever it is.

Floating or in a window, the conference is not inside the stage, but its tiles and toolbar are styled by an ancestor `.stage`, so the pane manager wraps it in a `.stage.conference-stage` (`def.wrap`). Page code finds its elements through `$()`, which falls back to the conference element, and reads the conference's size (not the stage's) for the `compact` and `tiny` classes. A window has its own document, so the conference registers `onWindow` to attach the idle, outside-click and key listeners there. Moving the conference between docked, floating and a window passes `moving: true` to `onChange`, so the call keeps running; only opening or closing it starts or stops the call.

The header at the top of the page holds the controls for the whole app, at the right: the Modules button, Full screen and Pop out, then Sign out. Full screen and Pop out apply to the whole stage (they show their exit and pop-in forms while active). In the popped-out window the header is out of reach, so the conference's titlebar shows its own Modules and Full screen buttons (`.conf-popout-only`) and the Modules menu opens under them.

## The conference and the call

Being in the room and being in the conference are separate. The page stays connected to the room's LiveKit session for the chat and the modules (chat travels over LiveKit's data channel), and sends and receives audio and video only while the conference pane is open.

- The conference is a native pane (`id: 'conference'`, `order: -1`, `flex: true`, docked only). Its `onChange` in `public/room.js` runs `startCall()` when it opens and `stopCall()` when it closes. The page connects with `autoSubscribe: false`; `startCall()` subscribes to everyone's tracks and publishes the microphone, and `stopCall()` unpublishes, unsubscribes and removes the tiles.
- A participant attribute, `call` (`on` or `off`), says whether a person is in the conference. The server sets it in the token; the page changes it with `setAttributes`. A tile exists only for a person whose attribute is not `off`, and only while I am in the conference myself (`shownInCall()`). `/api/table` reports `inCall` per person, and the aside route refuses anyone who is not in the conference.
- The hang-up button closes the conference pane, which leaves the call and stays in the room. Leave room, in the header, disconnects. Closing the pane in a pop-out window first brings the stage back to the page.
- The Modules menu (`#modules-menu`) is a child of the stage, not of the toolbar, so it works with the conference closed: it opens above the toolbar's Modules button, or under the Modules button the header shows while the conference is closed. The conference's menu entry reads "Rejoin call" while it is closed.
- The "See and join the conference" permission is enforced in the token: without it the token cannot publish or subscribe, and the pane cannot be opened.

## Docked modules

An installed module can dock as a column after the chat. `public/room-modules.js` adds a `.module.module-docked` element to the stage holding a `.dock-resize` handle and a `.mod-content` with a host-drawn `.mod-header` (at `--module-header-h`) and the module's frame. If the module has set an action bar (`tavern.bar.set`), the section also holds a `.dock-bar` in the bottom row of its column, so its buttons line up with the video toolbar and the chat box, and the content sits above it; with no bar the content spans both rows. The stage sets `--stage-cols` and places each column, so the template is one column per docked pane, with the conference or the first pane flexible. Dragging a column's left edge changes only that column's width.

On a narrow window docked modules are hidden and a module opens floating instead.

The next docked module needs nothing here: it is the same element with the next column number.
