# Server Settings

**Audience:** an admin running a Coffee Pub Tavern server, working through the Manage page.

Open the Manage page with the gear icon in the header. It has six tabs, in this order: **Server**,
**Theme**, **Rooms**, **Roles**, **Users** and **Modules**, plus **About**. Only admins see it.

## Server

- **Server name and icon.** The name shows in the header and the browser tab. The icon is any image;
  it is used in the header, as the favicon, and on the sign-in page. Click it to change it, and the
  small **x** over its corner to clear it.
- **Home icon.** The icon beside the server name wherever it is a link back to the room list. You
  choose from the Font Awesome list on the Theme tab.
- **Call features.** Turns screen sharing, asides, private conversations and reactions on or off for
  everyone, and sets the highest video quality anyone can pick.
- **Sign-in page.** A background picture behind the sign-in box, and the text under the password field.
- **Sign-up.** Self-service `/register` on or off, and invite links into specific rooms. See
  [Accounts, roles and permissions](userguide-accounts.md).
- **Participant video defaults.** The talking border, its color and width; the name plate, with its
  layout (six corner and edge positions, including a full-width strip), box color, font color, font size
  and transparency; and the color and size behind a Participant picture. These are the same for
  everyone. There are matching **Character borders** and dimming and tint levels for Offline, Aside and
  Private members.
- **OBS access.** The stream key that OBS view links carry. Show, copy or regenerate it; regenerating
  stops every existing link working.

## Theme

- **Theme.** Recolors the app to match your own branding; it changes colors only, never layout. Pick a
  theme and **Apply**, or adjust the seven base colors (background, card background, border, text, dim
  text, primary accent and text on accent) and save them as a new theme. Under **Header, buttons and
  icons** you can also set the header background and text, the icon color and its hover, the Primary
  accent hover, and the Secondary accent with its text and hover. Each of these is on **Auto** by
  default, which keeps it derived from the base colors; untick Auto to choose the color yourself. The
  preview, including a sample header, shows the result live before anything is saved. "Default" is how
  the app has always looked.
- **Default Images.** The Participant pictures a member shows once neither they nor the room they are
  in has set one; the last fallback before the box goes transparent.
- **Guest images.** The Participant pictures every guest shows, since a guest has no account of their
  own.
- **Reactions.** The emoji tray at the table and on stream, also offered in chat. Add, remove, reorder
  and edit the emoji and label, or leave the list empty to turn reactions off. The first six are keys
  **1** to **6**.
- **Font Awesome.** The icons you want available. Paste an icon's HTML from fontawesome.com, for example
  `<i class="fa-solid fa-dice"></i>`, and the preview shows it. These icons are the choices offered for a
  room's launch link and the home icon. Only the Free icons that ship with Tavern will draw.

## Rooms and Users

Both are rosters: a thumbnail, a name and a link to that one thing's own page. See
[Rooms](userguide-rooms.md) and [Accounts, roles and permissions](userguide-accounts.md).

## Roles

The grid of what each role can do. See [Accounts, roles and permissions](userguide-accounts.md).

## Modules

Upload and manage add-on features. See [Modules](userguide-modules.md).

## About

The version, the licence, and the credits for the open-source software Tavern is built on.
