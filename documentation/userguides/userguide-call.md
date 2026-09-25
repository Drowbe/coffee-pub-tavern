# The Call

**Audience:** a player using Coffee Pub Magpie in a browser: joining a space, talking, chatting, and
stepping away.

The words here are the defaults. An environment set up from a template, or renamed by its owner, may call a space,
a module or an aside something else; the buttons and menus follow its words (see [Templates](userguide-templates.md)).

## Join and leave

The join screen lists the spaces you belong to. Join is one click. The page then becomes the call:
the header stays, now naming the space you are in, with the space bar under it (see below), the tiles fill the
middle, and a bar of controls sits at the bottom edge.

Left to right, the bar holds: microphone (with a live level meter inside the button), deafen, camera,
share screen, layout, away, reactions, settings, the space's launch link if it has one, and hang up.
The space bar under the header has the modules, **Full screen**, **Pop out** and **Leave space**. Keys: **M** microphone, **D** deafen, **V** camera, **C** chat, **R** reactions, **L**
layout, **1** to **6** send a reaction. As the window narrows, buttons tuck under a **More** button (the three-dot button): the extras first, then chat, then camera, then the microphone. At its smallest the bar is just **More** and leave. On a narrow window, such as a phone, opening chat puts the conference in a strip above the chat, with the toolbar under both.

## What opens when you join

Each space remembers the modules you had open when you last used it, in which mode (docked, floating or in
a window), and how big, and opens them again when you join. A space you have not used before opens with
the conference. Hanging up is remembered too, so hang up and leave, and the space opens without the
conference next time; the **Join with** button on the space list changes that before you join (see
[Spaces](userguide-spaces.md)).

## Leaving the call, staying in the space

The red hang-up button leaves the call, not the space. The conference closes, your microphone and camera
stop, you stop receiving anyone's audio and video, and your tile disappears for everyone else, but you
stay in the space and stay online, with the chat and the modules still open. The space's own **Leave
space** button, at the right of the space bar, is what leaves the space.

With the conference closed, the space bar under the header still opens the chat and the modules. It
offers **Rejoin call** to bring the conference back, along with the chat and the modules. If nothing at
all is open, the canvas says so and points at that button. In a pop-out window, hang up brings the app back
to the page first.

A role without **See and join the conference** joins with the conference closed and cannot reopen it: the
person has the chat and the modules only.

A player with no camera or microphone still joins; whatever is missing is named in the status line
and your Online picture stands in for the camera.

## Layouts

Choose grid, strip or spotlight with the layout button. Grid shows everyone equally. Strip is one row,
or one column when the window is taller than wide. Spotlight is one big tile with the rest small; it
follows whoever is speaking unless you click a tile to pin it. Drag tiles into any order. Layout,
order and pin are remembered in your browser.

## Chat

Open chat from the **space bar**, under the header, or with **C**. The space bar is the one place to show and hide modules on the canvas: it has a switch for the conference, the chat and each module the space has on, on when the module is open, and clicking one opens or closes it. A module with something unread shows a count.

- **Formatting.** The icons button to the left of the box opens a small layer above it with the
  picture button, **bold**, *italic*, code, bullet lists and emoji, and a question mark that shows the
  shortcuts. It closes when you click elsewhere or press Escape, so the chat bar stays one row.
- **Pictures.** Paste, drop or pick a picture (the picture button is in that layer) to send it. Pictures larger than 1600 px or 1.5 MB are
  shrunk first.
- **Reply, copy and save.** Hover a message for **Reply** (it quotes the message and puts your cursor
  on the next line), **Copy** (the text, or the picture itself) and, on pictures, **Save**. The
  download button in the header saves the whole chat as a text file.
- **Emoji.** The smiley button offers the same emoji as the reactions tray.
- **History.** Text messages travel live over the media server, and the server also keeps a rolling
  window for each space: the last 500 messages, none older than 30 days. Whoever joins, late or from
  another browser, sees what was said above a line that marks where they came in. Pictures are live
  only and are not kept. An aside or a private conversation has no chat. **Clear chat**
  hides what came before from your view on that browser; it does not delete anything for anyone else.

Who may send messages or pictures is set per role on the Roles tab; if a permission is off the
chat box is hidden.

## Chat, docked, floating or in its own window

The conference has the same titlebar as the chat and every module: the same buttons to float it over the page (and dock it again), to open it in a window of its own, and to close it, which leaves the call. In its own window the titlebar has no close: closing that window brings the call back into the page where it was. **Hang up** on the toolbar leaves the call and keeps the conference open, which says "Not in a call"; the phone turns green, and pressing it dials you back in. Chat opens as a column beside the video. Its header has the same buttons as a module's: one to float it over the canvas, where you can drag and resize it (and a matching button to dock it again), one to open it in a window of its own, and the x to close it. A floating module also has a **Snap to a grid** button: on, the module sits in the cells of a grid over the call (you see the grid while you drag), moving and resizing a cell at a time and keeping its place when the window changes size; off, it floats freely, as before. Each module remembers its own choice. The space bar (beside **Full screen**) has the same switch for the whole canvas: on, every module that can float is put on the grid -- docked ones float first -- and any you open later comes up floating and snapped; a slider beside it sets how fine the grid is (you see the grid while you slide). Off, the modules that were docked when you switched it on dock again, and the rest float freely. The space remembers both. The Calendar and other modules open as more columns after the chat, and the video always keeps some of the width. If you pop the whole call out, chat and modules come with it. Close a module's own window and the module comes back into the page, docked or floating as it was before, with whatever it held untouched.

## Reactions

The smiley button in the bar opens a tray, set up by an owner on the Theme tab of the Manage page
(six by default: heart, thumbs up, thumbs down, laugh, question mark, and a die for a natural 20).
The first six are also keys **1** to **6**. A reaction floats up from your tile for a couple of
seconds on everyone's screen, and up your Participant and Character boxes in OBS. Nothing is stored.

## Deafen

Mutes everyone else's audio on your end without touching your own microphone or leaving the call,
for when something else needs quiet for a minute. Only you are affected, and nobody is told.

## Away

The moon button pauses your microphone and camera and marks your tile so everyone knows. When you
click it, Magpie asks for an optional **away message** (up to 200 characters, several lines allowed).
Ctrl or Cmd plus Enter, or **Go away**, confirms. Everyone else sees your message on your tile in
place of "Away"; leave it empty to show plain "Away". Click the button again to come back, and only
the microphone and camera that were on before come back on.

Opening your profile or the Manage page from inside a call, or going to the space list, also marks you
as "Away" without asking for a message.

## Settings in the call

The settings popover holds your audio and video choices:

- **Audio.** Microphone choice, a level slider (0 to 300 percent), a noise gate that cuts the
  microphone below a threshold, and switches for the browser's noise suppression, echo cancellation
  and auto gain. Talk mode is open microphone or push to talk (hold Space by default). Hover another
  player's tile for a volume slider that applies only on your side.
- **Video.** Camera choice, quality (360p, 540p or 720p, up to the ceiling the owner sets), and a
  mirror for your own preview. Background is off, **blur**, or a **custom image** you upload on your
  profile page. Blur and custom images run on your own device and load their model only the first
  time you turn one on; nothing external is fetched.

Your own settings for these are also on your profile page.

## Your profile and Manage over the call

Your profile and the Manage page open in an overlay from inside a call rather than navigating away,
because leaving the page would drop the call. A **Back to** button in that page's header returns you.

## Install it as an app, and pop it out

To run Magpie without browser bars, install it as an app: Chrome and Edge show **Install as an
app** in the settings popover, Safari on macOS has **File, Add to Dock**, and iPhones and iPads use
**Share, Add to Home Screen**.

In Chrome and Edge the **Pop out** button in the space bar (next to **Full screen**) moves the whole app, header
and every module included, into a small window and back; **Full screen** applies to the whole app too. The
page behind shows **Bring the app back**, and the button in the space bar becomes **Pop it back in**. Popped
out, the header, the conference's titlebar and the toolbar all slide away when the pointer rests and come
back on any movement, leaving only the tiles. A header link (your profile, the spaces, a module's page)
brings the app back to the page first.

A module in a window of its own, the chat and the conference included, can come back as a docked column or float over the canvas, from the buttons on its titlebar. Those buttons work while the space's page that opened the window is still open.

The conference can also go alone into a window of its own with the button on its titlebar, leaving the
chat and the modules on the page. Closing that window leaves the call.
