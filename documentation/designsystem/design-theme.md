# Theme and Design Tokens

**Audience:** anyone styling a page, a panel or a module against Coffee Pub Tavern, who needs the
colors to follow whatever theme the admin has chosen.

Admins can re-theme Tavern from the Theme tab of the Manage page, including light themes. A theme
changes colors only, never layout. Anything drawn with a fixed color will be unreadable on some
server, so every color must come from the tokens below.

## How a theme reaches a page

Every page links `/theme.css` after `style.css`. The server renders it from the active theme as
`:root` overrides of the seven base tokens, and an untouched server sends an empty file, so it looks
exactly like the defaults in `style.css`. Because it is an ordinary stylesheet link, the popped-out
call window picks the theme up too, when the page clones its stylesheets into the new window.

## The tokens

The theme editor sets the first seven. The rest are derived from them with `color-mix`, so they follow
automatically.

| Token | Use |
|---|---|
| `--bg` | page background |
| `--bg-card` | panels and cards |
| `--border` | outlines and dividers |
| `--text` | body text |
| `--text-dim` | secondary text |
| `--accent` | links, highlights and primary buttons |
| `--on-accent` | text and icons drawn on an `--accent` background |
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
5. A fixed color is acceptable only where it carries a meaning the theme must not change, such as the
   red of a muted badge, and then its text is fixed too so the pair stays readable.
6. Anything drawn on its own, such as a canvas or SVG, reads the tokens with `getComputedStyle` and
   redraws when the theme changes.

A fixed dark background under theme-colored text is the classic failure: it looks correct on the
default theme and unreadable on a light one.

## Modules

A module runs in a sandboxed frame, so it cannot see Tavern's stylesheet. The host is designed to pass
the current theme into every module frame on load and whenever it changes, applied as CSS custom
properties on the module's own `:root`, so a module written to the rules above follows the theme with
no code. The same six rules apply to module authors.
