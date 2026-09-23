# Theme and Design Tokens

**Audience:** anyone styling a page, a panel or a module against Coffee Pub Magpie, who needs the
colors to follow whatever theme the admin has chosen.

Admins can re-theme Magpie from the Theme tab of the Manage page, including light themes. A theme
changes colors only, never layout. Anything drawn with a fixed color will be unreadable on some
server, so every color must come from the tokens below.

## How a theme reaches a page

Every page links `/theme.css` after `style.css`. The server renders it from the active theme as
`:root` overrides of the seven base tokens and of each optional token the theme sets, and an untouched server sends an empty file, so it looks
exactly like the defaults in `style.css`. Because it is an ordinary stylesheet link, the popped-out
call window picks the theme up too, when the page clones its stylesheets into the new window.

## The tokens

The theme editor sets the first seven, and may also set the eleven in the second group. Every token in the second
group follows the base colors until a theme sets it (**Auto**), so a theme that never touches one keeps
working. The rest are derived with `color-mix`.

| Token | Use |
|---|---|
| `--bg` | page background (labeled Page background in the theme editor) |
| `--bg-section` | section background: panels, popovers, the active tab (labeled Section background in the theme editor) |
| `--border` | outlines and dividers |
| `--text` | body text |
| `--text-dim` | secondary text |
| `--accent` | links, highlights and primary buttons |
| `--on-accent` | text and icons drawn on an `--accent` background |
| `--bg-card` | card background: the small items inside a section, such as member tiles, facts and thumbnails; Auto is `--bg-input` |
| `--header-bg` | header background, drawn as a soft gradient from this color; Auto is `--bg` |
| `--header-text` | header text, the server name, breadcrumb and signed-in name; Auto is `--text` |
| `--nav-primary-bg` | the primary nav's middle zone (the core navigation); Auto is `--header-bg` |
| `--nav-primary-edge-bg` | the primary nav's left and right zones (the logo and where you are; the system's actions and the time), a whisper darker; Auto is a 3% black overlay on the header colour |
| `--nav-secondary-bg` | the secondary nav (the space's bar at the table); Auto is a 2% black overlay on the header colour |
| `--icon` | icons in the page, chat and header; Auto is dim text on the page and a softened header text in the header |
| `--icon-hover` | icon hover; Auto is `--accent` |
| `--primary-hover` | Primary buttons on hover; Auto is a lighter `--accent` |
| `--secondary` | Secondary buttons, and the toolbar buttons at the table; Auto is `--surface` |
| `--secondary-text` | text on Secondary buttons; Auto is `--text` |
| `--secondary-hover` | Secondary buttons on hover; Auto is `--surface-hover` |
| `--bg-input` | inputs |
| `--surface`, `--surface-hover` | raised surfaces and their hover state |
| `--shade` | recessed areas |
| `--ok`, `--danger` | status colors |
| `--danger-text`, `--accent-hover` | lightened forms of danger and accent |

## Rules

1. Take every color from these tokens. For a see-through tint use `color-mix`, for example
   `color-mix(in srgb, var(--text) 8%, transparent)`, never `rgba(255, 255, 255, .08)`.
2. Text on an `--accent` background uses `--on-accent`, not white or black.
3. Never assume a dark background. Test every new surface with a dark and a light theme.
4. Scrims and shadows may stay black, because they darken whatever is behind them rather than
   standing in for a theme color.
5. A button is Primary (`--accent` with `--on-accent`) or Secondary (`--secondary` with `--secondary-text`); do not invent a third look. Hover comes from `--primary-hover` and `--secondary-hover`.
6. A fixed color is acceptable only where it carries a meaning the theme must not change, such as the
   red of a muted badge, and then its text is fixed too so the pair stays readable.
7. Anything drawn on its own, such as a canvas or SVG, reads the tokens with `getComputedStyle` and
   redraws when the theme changes.

A fixed dark background under theme-colored text is the classic failure: it looks correct on the
default theme and unreadable on a light one.

## Modules

A module runs in a sandboxed frame, so it cannot see Magpie's stylesheet. The host reads the current theme from the page's computed style and hands it to the module on start, and the module SDK sets it on the frame's `:root` as CSS custom properties. A module written to the rules above follows the theme with no code. Magpie also adds a small base stylesheet to each module page (`.btn`, `.btn-primary`, `.card`, styled inputs) built from the same tokens. The rules apply to module authors too; see [api-module-sdk](../api/api-module-sdk.md).
