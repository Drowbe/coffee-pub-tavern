# Room Layout Architecture

**Audience:** developers changing the room page in Coffee Pub Tavern: the video conference, the chat, or anything that docks beside them.

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

- **Columns.** One column for video. `.stage.chat-open` adds a second, `var(--chat-w)` wide. The video column takes the rest.
- **Rows.** `minmax(0, 1fr)` for content, then `auto` for the bars.
- **Modules.** A `.module` element has `display: contents`, so its content and bar become items of the stage grid, placed by `grid-column` and `grid-row`. Video is `.module-video`, chat is `.module-chat` (the `#chat` element).
- **Closing chat** hides the chat module and removes its column, so the video content and its bar take the full width.

The chat's resize handle (`#chat-resize`) is its own grid item spanning both rows, on the chat column's left edge, so dragging it moves the content and the bar together.

## Docked and floating

A bar is either **docked**, a cell in the bottom row, or **floating**, laid over its own module's content. There is no third state.

The popped-out window makes the video bar floating: `.popout .video-bar` moves to the content's grid area, aligns to the bottom and centers, and the content spans both rows so the video takes the whole height. The toolbar becomes a pill. The chat bar stays docked, because the message box needs a fixed place. Only a floating bar fades when idle.

## Popovers

The settings popover, the reactions tray and the overflow menu live inside the video bar's wrapper and hang off it with `bottom: calc(100% + 10px)`. They follow the bar in either state and never depend on a guessed pixel offset.

## Narrow windows

`applyLayout()` in `public/room.js` sets `narrow` on the stage below 640px wide (and `compact` below 460px, `tiny` below 300px, which only shrink sizes). With `narrow` and chat open, the grid is a single column: the chat content, then the chat bar, then the video toolbar. The video content is hidden, and the toolbar's chat button closes the chat and brings the video back.

## Rules

- **The header height is one token.** `--module-header-h` sets every module header strip so neighbouring columns line up. Nothing else sets a module header height.
- **No measured heights.** `--barh` and `--floatbar-h` are gone. Anchor to the bar instead of measuring it, and let the row size itself.
- **No hand-subtracted widths.** A module that needs room gets a column; nobody writes `calc(100% - chat-w)`.
- **Colors come from tokens.** See [design-theme](../designsystem/design-theme.md).

`tools/check-room-layout.mjs` enforces the first three, and runs as part of `npm run check`.

## Docked modules

An installed module can dock as a column after the chat. `public/room-modules.js` adds a `.module.module-docked` element to the stage holding a `.dock-resize` handle and a `.mod-content` with a host-drawn `.mod-header` (at `--module-header-h`) and the module's frame. If the module has set an action bar (`tavern.bar.set`), the section also holds a `.dock-bar` in the bottom row of its column, so its buttons line up with the video toolbar and the chat box, and the content sits above it; with no bar the content spans both rows. The stage sets `--dock-cols` to the docked widths and places each column, so the template is `video | chat (0 until it opens) | docked columns`. Dragging a column's left edge changes only that column's width.

On a narrow window docked modules are hidden and a module opens floating instead; when the call is popped out they float over the main window and dock again on return.

The next docked module needs nothing here: it is the same element with the next column number.
