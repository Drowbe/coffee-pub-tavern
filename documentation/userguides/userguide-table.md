# The Table

**Audience:** a player using Coffee Pub Tavern in a browser: joining a room, talking, chatting, and
stepping away.

## Join and leave

The join screen lists the rooms you belong to. Join is one click. The page then becomes the table:
the header stays, now naming the room you are in with a **Leave room** button, the tiles fill the
middle, and a bar of controls sits at the bottom edge like Zoom or Meet.

Left to right, the bar holds: microphone (with a live level meter inside the button), deafen, camera,
share screen, layout, away, reactions, settings, the room's launch link if it has one, and hang up. The
Modules button, Full screen and Pop out are in the header, to the left of Sign out. Keys: **M** microphone, **D** deafen, **V** camera, **C** chat, **R** reactions, **L**
layout, **1** to **6** send a reaction. As the window narrows, buttons tuck under a **More** button (the three-dot button): the extras first, then chat, then camera, then the microphone. At its smallest the bar is just **More** and leave. On a narrow window, such as a phone, opening chat puts the conference in a strip above the chat, with the toolbar under both.

## Leaving the call, staying in the room

The red hang-up button leaves the call, not the room. The conference closes, your microphone and camera
stop, you stop receiving anyone's audio and video, and your tile disappears for everyone else, but you
stay in the room and stay online, with the chat and the modules still open. The room's own **Leave
room** button, in the header, is what leaves the room.

With the conference closed the Modules button moves up to the header, next to Leave room. Its menu offers
**Rejoin call** to bring the conference back, along with the chat and the modules. If nothing at all is
open, the stage says so and points at that button. In a pop-out window, hang up brings the table back to
the page first.

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

Open chat from the **Modules** button (the puzzle piece) or with **C**. The button shows an unread count while the chat is closed. The Modules button is the one place to show and hide panes: its menu lists Chat and each module the room has on, and choosing one opens or closes it.

- **Formatting.** The buttons above the box add **bold**, *italic*, code and bullet lists, and the
  question mark shows the shortcuts.
- **Pictures.** Paste, drop or pick a picture to send it. Pictures larger than 1600 px or 1.5 MB are
  shrunk first.
- **Reply, copy and save.** Hover a message for **Reply** (it quotes the message and puts your cursor
  on the next line), **Copy** (the text, or the picture itself) and, on pictures, **Save**. The
  download button in the header saves the whole chat as a text file.
- **Emoji.** The smiley button offers the same emoji as the reactions tray.
- Everything travels over the media server and nothing is stored: someone who joins late sees only
  what comes after them.

Who may send messages or pictures is set per role on the Roles tab; if a permission is off the
chat box is hidden.

## Chat, docked, floating or in its own window

The conference has the same titlebar as the chat and every module: the same buttons to float it over the page (and dock it again), to open it in a window of its own, and to close it, which leaves the call. Chat opens as a column beside the video. Its header has the same buttons as a module's: one to make it a floating panel you can drag and resize (and a matching button to dock it again), one to open it in a window of its own, and the x to close it. The Calendar and other modules open as more columns after the chat, and the video always keeps some room. If you pop the whole call out, chat and modules come with it. Close the chat's own window and the chat closes.

## Reactions

The smiley button in the bar opens a tray, set up by an admin on the Theme tab of the Manage page
(six by default: heart, thumbs up, thumbs down, laugh, question mark, and a die for a natural 20).
The first six are also keys **1** to **6**. A reaction floats up from your tile for a couple of
seconds on everyone's table, and up your Participant and Character boxes in OBS. Nothing is stored.

## Deafen

Mutes everyone else's audio on your end without touching your own microphone or leaving the call,
for when something else needs the room quiet for a minute. Only you are affected, and nobody is told.

## Away

The moon button pauses your microphone and camera and marks your tile so everyone knows. When you
click it, Tavern asks for an optional **away message** (up to 200 characters, several lines allowed).
Ctrl or Cmd plus Enter, or **Go away**, confirms. Everyone else sees your message on your tile in
place of "Away"; leave it empty to show plain "Away". Click the button again to come back, and only
the microphone and camera that were on before come back on.

Opening your profile or the Manage page from inside a call, or going to the room list, also marks you
as "Away" without asking for a message.

## Settings in the call

The settings popover holds your audio and video choices:

- **Audio.** Microphone choice, a level slider (0 to 300 percent), a noise gate that cuts the
  microphone below a threshold, and switches for the browser's noise suppression, echo cancellation
  and auto gain. Talk mode is open microphone or push to talk (hold Space by default). Hover another
  player's tile for a volume slider that applies only on your side.
- **Video.** Camera choice, quality (360p, 540p or 720p, up to the ceiling the admin sets), and a
  mirror for your own preview. Background is off, **blur**, or a **custom image** you upload on your
  profile page. Blur and custom images run on your own device and load their model only the first
  time you turn one on; nothing external is fetched.

Your own settings for these are also on your profile page.

## Your profile and Manage over the call

Your profile and the Manage page open in an overlay from inside a call rather than navigating away,
because leaving the page would drop the call. A **Back to** button in that page's header returns you.

## Install it as an app, and pop it out

To run the table without browser bars, install it as an app: Chrome and Edge show **Install as an
app** in the settings popover, Safari on macOS has **File, Add to Dock**, and iPhones and iPads use
**Share, Add to Home Screen**.

In Chrome and Edge the **pop out** button in the header (next to Full screen) moves the whole app, header
and every pane included, into a small window and back; **Full screen** applies to the whole app too. The
page behind shows **Bring the app back**, and the button in the header becomes **Pop it back in**. Popped
out, the header, the conference's titlebar and the toolbar all slide away when the pointer rests and come
back on any movement, leaving only the tiles. A header link (your profile, the rooms, a module's page)
brings the app back to the page first.

A pane in a window of its own can come back as a docked column or a floating panel, from the buttons on its titlebar. That includes a module: its window has a titlebar with the same buttons, which work while the room page that opened it is still open.

The conference can also go alone into a window of its own with the button on its titlebar, leaving the
chat and the modules on the page. Closing that window leaves the call.
