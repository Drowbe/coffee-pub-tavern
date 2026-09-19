# Room Layout Plan

**Audience:** whoever is building the room page's layout, and the author reviewing it before any of it is built.

**Status:** In progress. Steps 1 to 5 of the build order are built and documented in [architecture-room-layout](../architecture/architecture-room-layout.md); step 6, modules docking into a column, is not. Delete this plan once step 6 lands.

## Why

Today the chat is an overlay pinned to the right of the stage, and the toolbar is shrunk to sit under the video only. That is the shape of a grid built out of absolute positions and measured values: `--barh`, `--chat-w` and `--floatbar-h` are set in several places and overridden by the popout and compact modes. Each new mode needs its own special case, which is how a popped-out window ended up with a blank strip under the chat. Installed modules would multiply the problem.

## The model

The room page is a grid. Every **module** (video conference, chat, and any installed module that docks) owns one column and has up to three parts: a header strip, a content area, and an action bar. The bars share one bottom row.

```
+------------------------------------------------------------+
| header (site header; absent when popped out)               |
+---------------------------+----------------+---------------+
| VIDEO content             | CHAT header    | module header |
|                           +----------------+ (optional)    |
|                           | CHAT content   | module content|
+---------------------------+----------------+---------------+
| VIDEO bar (mic, cam ...)  | CHAT bar       | module bar    |
|                           | (format, input)|               |
+---------------------------+----------------+---------------+
```

Columns are as many as there are visible modules. Rows are: content (takes the rest), bar (sizes to the tallest bar in that row). Because the bars are cells of one row, they line up whenever modules are used together. A module on its own has the same shape, so its footprint does not change.

## Decisions

| Area | Decision |
|---|---|
| Bottom row | Sizes to the tallest bar. Shorter bars are vertically centered in it. The chat input grows to about four lines, then scrolls, so the row is bounded. |
| Chat closed | Its column and bar disappear; the remaining columns take the width. |
| Installed modules | May dock as a column from the start, and may also float over the call. A module's manifest says which it supports. |
| Module header | Optional, and part of the content area, not a grid row. Its height is one fixed standard value, documented in the design system and enforced (below). Video has none. |
| Narrow screens | One module at a time with a switch between them; each keeps its own bar. With several docked modules the switch is a tab strip, one tab per module. |
| Fullscreen | The whole stage, both modules, as today. |
| Idle fade | A bar fades only while it floats (the popped-out pill). A docked bar never fades, because that would leave a gap. |

## Rules

**Docked and floating are the only two states of a bar.** Docked: it is a cell in the bottom row. Floating: it overlays its own module's content cell. The popout is the floating state for the video module. There is no third path and no measured height.

**The header height is a token.** A single value, for example `--module-header-h`, sets the height of every module header strip, so that headers across columns line up. Nothing sets its own header height. Chat's existing title strip (title, download, delete, close) is the first user.

**For installed modules the host draws the header.** A module's manifest gives a title and a few actions, and the host renders the strip at the standard height. That is the only way to enforce alignment for a module that lives in an iframe and cannot be trusted with the host's layout.

**A module's bar is clamped.** The host sets a minimum and a maximum bar height. A module in a frame reports the height it wants through the SDK's resize call, and the host clamps it into that range. A module cannot make the row taller than the maximum.

**Column widths.** Video takes the remaining width. Other columns have a default width, a minimum, and a drag handle on their left edge; the width applies to the content and the bar together because they are the same column.

**Enforcement.** A check script, like the documentation check, fails when stylesheet rules outside the layout section set a module header height, a bar height, or reintroduce `--barh`, `--floatbar-h` or a `calc()` that subtracts a chat width. The rules also go into [design-theme](../designsystem/design-theme.md) as design-system rules.

## What changes

- **`public/room.html`:** the stage becomes a grid of module columns. The chat composer (formatting buttons, input, Send, picture button) moves out of the chat panel into the chat module's bar cell.
- **`public/room.js`:** chat open and close toggles the column instead of an overlay class. The resize handle moves to the column edge. `applyLayout` and the popout code drop their bar-height handling. The ResizeObserver that sets `--floatbar-h` is deleted.
- **`public/style.css`:** the absolute positioning, the `calc(100% - chat-w)` toolbar width, `--barh` in three places and the compact and popout overrides are replaced by grid rules and a floating-bar modifier.
- **Things anchored to the toolbar** need re-checking: the reactions tray, the settings popovers, the aside and recall overlays, and the away prompt. They should follow the bar cell, but they are where regressions would show.

## Build order

1. Write the grid with video and chat as the two modules, docked. No behavior change intended.
2. Move the chat composer into the chat bar and add the input cap.
3. Popout as the floating state; delete the old measured values.
4. The narrow-screen switch.
5. The header token and the check script.
6. Modules dock into a column (after the host API exists; see [plan-modules](plan-modules.md)).

## Test matrix

Verified by hand in a real call, since a sandbox cannot connect to one: chat open and closed; fullscreen; popped out with chat open and closed; a narrow window and a phone width; both layouts (grid, strip, spotlight); and the tray, popovers, aside and recall overlays and away prompt in each. Record the unverified cases in `TODO.md`.
