# The Table

**Audience:** a player using Coffee Pub Tavern in a browser: joining a room, talking, chatting, and
stepping away.

## Join and leave

The join screen lists the rooms you belong to. Join is one click. The page then becomes the table:
the header stays, now naming the room you are in with a **Leave room** button, the tiles fill the
middle, and a bar of controls sits at the bottom edge like Zoom or Meet.

Left to right, the bar holds: microphone (with a live level meter inside the button), deafen, camera,
share screen, layout, away, chat, reactions, settings, the room's launch link if it has one, and
leave. Keys: **M** microphone, **D** deafen, **V** camera, **C** chat, **R** reactions, **L**
layout, **1** to **6** send a reaction. As the window narrows, buttons tuck under a **More** button (the three-dot button): the extras first, then chat, then camera, then the microphone. At its smallest the bar is just **More** and leave. On a narrow window, such as a phone, opening chat replaces the video with the chat while the toolbar stays under it, and the chat button brings the video back.

A player with no camera or microphone still joins; whatever is missing is named in the status line
and your Online picture stands in for the camera.

## Layouts

Choose grid, strip or spotlight with the layout button. Grid shows everyone equally. Strip is one row,
or one column when the window is taller than wide. Spotlight is one big tile with the rest small; it
follows whoever is speaking unless you click a tile to pin it. Drag tiles into any order. Layout,
order and pin are remembered in your browser.

## Chat

Open chat with the speech-bubble button or **C**. It shows an unread badge while closed.

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

Chat opens as a column beside the video. Its header has the same buttons as a module's: one to make it a floating panel you can drag and resize (and a matching button to dock it again), one to open it in a window of its own, and the x to close it. The Calendar and other modules open as more columns after the chat, and the video always keeps some room. If you pop the whole call out, chat and modules come with it. Close the chat's own window and the chat closes.

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

In Chrome and Edge the **pop out** button moves the whole table into a small always-on-top window and
back. Popped out, there is no header: the controls become a round bar floating over the tiles that
fades away when the pointer rests and comes back on any movement. The page behind keeps its header and
offers **Bring it back here**.
