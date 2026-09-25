# Server Settings

**Audience:** an owner running a Coffee Pub Magpie server, working through the Manage page.

Open the Manage page with the gear icon in the header. It has six tabs, in this order: **Server**,
**Theme**, **Rooms**, **Roles**, **Users** and **Modules**, plus **About**. Only owners (and, on a hosted server, the host admin) see it; anyone else asking for it is told "Owners only."

## Server

- **Environment** (a hosted server only). The plan's name, each cap with what is used, the overdue banner when a payment has lapsed, **Upgrade**, **Download a copy** and **Ask for deletion**. See [Your environment](userguide-environments.md).
- **Server name and icon.** The name shows in the header and the browser tab. The icon is any image;
  it is used in the header, as the favicon, and on the sign-in page. Click it to change it, and the
  small **x** over its corner to clear it.
- **Home icon.** The icon beside the server name wherever it is a link back to the room list. You
  choose from the Font Awesome list on the Theme tab.
- **Call features.** Turns screen sharing, asides, private conversations and reactions on or off for
  everyone, and sets the highest video quality anyone can pick.
- **Sign-in page.** A background picture behind the sign-in box, the text under the password field, and **Require two-step sign-in for everyone**: off (the default: anyone may set up an authenticator app on their profile) or on (everyone must, from their next sign-in; a session already open keeps working); see "Two-step sign-in" in [Accounts, roles and permissions](userguide-accounts.md). The switch is not shown when the server does not offer two-step sign-in (`ENABLE_MFA` in the compose file). The Users tab marks accounts that have set it up. Click the picture to upload your own, or choose **Choose from the library** for one of the pre-made backgrounds that ship with Magpie (filter by theme and style, pick one, **Use this background**). New pre-made images are added by putting files in `public/assets/images/backgrounds/`; see the README there for the format and file names.
- **Sign-up.** Self-service `/register` on or off, and invite links into specific rooms. See
  [Accounts, roles and permissions](userguide-accounts.md).
- **Access key.** The key that a keyed page's link carries in place of a sign-in (the Stream module's
  OBS views, `?s=...`). Show, copy or regenerate it; regenerating stops every existing link working.
  How the OBS boxes look (borders, the name plate, dimming) is the Stream module's own settings now; see
  [Magpie in OBS](userguide-obs.md).

## Language, time and money

On the Server tab. **Language** is the interface language (English, until translations arrive). **Clock** is how every time is shown, across the server and every module: 12-hour (10:30 PM, the default) or 24-hour (22:30). **Currency** is the one amounts are shown in (the Planner's costs and settling up), unless a trip names its own currency in Edit trip. The list has every currency by its code and name, the common ones first; the server refuses a code it doesn't know ("XYZ is not a currency this server knows. Choose one from the list, such as USD."). A code saved before this check keeps working and still shows in the list. A trip's own currency is still typed as three letters. Showing a trip's own currency with a conversion beside it needs a source of exchange rates, which is not set up yet.

## Theme

- **Theme.** Recolors the app to match your own branding; it changes colors only, never layout. Pick a
  theme and **Apply**, or adjust the seven base colors (page background, section background, border, text, dim
  text, primary accent and text on accent) and save them as a new theme. Under **Header, buttons and
  icons** you can also set the card background (the small boxes inside a section, such as member
  tiles), the header background and text, the icon color and its hover, the Primary
  accent hover, and the Secondary accent with its text and hover. Each of these is on **Auto** by
  default, which keeps it derived from the base colors; untick Auto to choose the color yourself. The
  preview, including a sample header, shows the result live before anything is saved. "Default" is how
  the app has always looked.
- **Default Images.** The Participant pictures a member shows once neither they nor the room they are
  in has set one; the last fallback before the box goes transparent.
- **Guest images.** The Participant pictures every guest shows, since a guest has no account of their
  own.
- **Reactions.** The emoji tray in the call and on stream, also offered in chat. Add, remove, reorder
  and edit the emoji and label, or leave the list empty to turn reactions off. The first six are keys
  **1** to **6**.
- **Font Awesome.** The icons you want available. Paste an icon's HTML from fontawesome.com, for example
  `<i class="fa-solid fa-dice"></i>`, and the preview shows it. These icons are the choices offered for a
  room's launch link and the home icon. Only the Free icons that ship with Magpie will draw, unless you
  have added your own Pro package (below).
- **Font Awesome Pro (optional).** If you have a Pro licence, drop your own "Web" download from your
  Font Awesome account (the folder with `css/`, `webfonts/` and `svgs/` in it, the Classic style) at
  `DATA_DIR/fontawesome-pro/` on the server and restart it. Magpie serves and draws from it ahead of
  the bundled Free set, falling back to Free for any style or icon it does not have. Nothing about your
  licence or your package ever leaves your own server: it is never built into the shared image, never
  uploaded, and no token for it lives in this repository.

## Rooms and Users

Both are rosters: a thumbnail, a name and a link to that one thing's own page. See
[Rooms](userguide-rooms.md) and [Accounts, roles and permissions](userguide-accounts.md).

## Roles

The grid of what each role can do. See [Accounts, roles and permissions](userguide-accounts.md).

## Modules

Upload and manage add-on features. See [Modules](userguide-modules.md).

## About

The version, the licence, and the credits for the open-source software Magpie is built on.
