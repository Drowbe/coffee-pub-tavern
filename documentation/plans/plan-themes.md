# Themes Plan

**Audience:** Thomas, who decided how themes are shared, and the sessions that build it: server-development (`server/`, the routes, the checks), experience-design (Manage > Theme) and content-manager (the owners' guide to creating themes).

**Status:** approved 2026-09-25; server built (step 1), pages landing (step 2), guide written (step 3, `userguide-themes.md`, ahead of the pages so it is ready when they land). GitHub issue #67. Thomas asked for theme import and export next, and whether the wiki had a place on creating themes (it does not: `userguide-environment-settings.md` has one paragraph on Manage > Theme, and `designsystem/design-theme.md` is for people building pages and modules).

## What it is today

- **A theme belongs to one environment.** `settings.themes[]` in `app.json`, each `{ id, name, light, dark }`; `settings.activeThemeId` picks one (`null` is **Strong Coffee**, the default, never stored: `DEFAULT_THEME`, `server/store.js:325`); `settings.themeMode` is the environment's default light or dark; since #62 each person may choose their own (`users[].themeMode`).
- **A set** holds seven required colors (`THEME_BASE`, `store.js:317`: `bg`, `bgSection`, `border`, `text`, `textDim`, `accent`, `onAccent`) and nine optional ones, where `null` means Auto, derived from the base (`THEME_OPTIONAL`, `store.js:316`: `card`, `headerBg`, `headerText`, `icon`, `iconHover`, `primaryHover`, `secondary`, `secondaryText`, `secondaryHover`). Either set may be missing; the other then shows in both modes. `addTheme` (`store.js:1005`) makes a theme with one mode's set; `updateTheme` (`store.js:1019`) starts a missing set from the other.
- **Only colors.** Every value must be `#rrggbb` (`cleanColor`, `store.js:369`), names are clean text up to 40 characters, and `server/theme-css.js` writes `/theme.css` from a fixed map of keys to CSS custom properties. No CSS can come in through a theme.
- **Built-ins.** Calming Teal (`staying-blonde`) and Burnt Orange (`willhavebeen`), seeded once with fixed ids, then ordinary themes the owner can edit or delete. Strong Coffee's dark set is `style.css`'s own palette, so it is stored as `null`.
- **Routes**, owner only: `GET` and `POST /api/themes`, `PATCH` and `DELETE /api/themes/:id` (`server/index.js:4879-4882`).
- **Manage > Theme** (`public/admin.html:59-113`): the chooser, the light or dark default, Apply, a preview, the seven base colors and the nine optional ones with their Auto boxes.
- **Templates** may set `activeThemeId` to a built-in id or `null`, and `themeMode` (`server/templates.js:40-41`), but cannot carry a theme of their own.

## Decisions

Thomas answered every question as recommended (2026-09-25):

1. **A theme is shared as a file.** `<name>.magpie-theme.json`, holding `{ "magpieTheme": 1, "name", "author"?, "light", "dark" }`, with the documented keys only.
2. **A name already in use is never overwritten.** The import is added as a new theme named "Name (2)" (then "(3)", and so on).
3. **`author` is optional free text**, up to 60 characters, shown on import.
4. **No host library now; files only.** Later, if wanted: bundled `themes/<id>.json` first, then a host library.
5. **Templates will carry a theme later**, by naming a bundled theme file, not in this step.
6. **Strong Coffee exports like any theme**, with its dark palette written out rather than `null`.

## The contract

### The file

```json
{
  "magpieTheme": 1,
  "name": "Harbour",
  "author": "Thomas",
  "light": { "bg": "#ffffff", "bgSection": "#f5f7f8", "border": "#dde3e6", "text": "#222222", "textDim": "#6b7479", "accent": "#1c7c8c", "onAccent": "#ffffff", "card": null, "headerBg": null, "headerText": null, "icon": null, "iconHover": null, "primaryHover": null, "secondary": null, "secondaryText": null, "secondaryHover": null },
  "dark": { "bg": "#10181b", "...": "the same keys" }
}
```

- **Export** writes every key of each set the theme has: the seven base colors and the nine optional ones, `null` for Auto. A theme with only one set exports that set and `null` for the other. Keys are the stored names, never CSS property names, so `server/theme-css.js` stays the one place that maps a key to CSS. The file name is the theme's name made safe for a file (letters, digits and hyphens, lower case), then `.magpie-theme.json`.
- **Import** reads the file and:
  - refuses anything over 16 KB, or that is not a JSON object: 400 "That isn't a Magpie theme file.";
  - refuses a missing `magpieTheme`, or one that is not a whole number: the same sentence;
  - refuses a `magpieTheme` above what this server knows: 400 "This theme was made by a newer version of Magpie.";
  - drops every key it does not know, at the top level and inside each set, and lists them in `dropped` (for example `["light.glow", "font"]`);
  - takes each set through `sanitizeTheme`, the same check as a theme made in Manage: each color must be `#rrggbb`, and a set missing any of the seven base colors is dropped whole (and named in `dropped` as `"dark"`);
  - refuses a file left with no complete set: 400 "This theme has no complete light or dark set: each needs all seven base colors.";
  - cleans `name` to 40 characters ("Theme" when empty) and `author` to 60 characters of plain text;
  - adds it as a new theme with a new id, renamed "Name (2)" when the name is taken (decision 2);
  - never changes the active theme or the default mode.

### Server

- **`GET /api/themes/:id/export`**, owner only. `:id` is a theme's id, or `default` for Strong Coffee (decision 6). Answers the file with `Content-Disposition: attachment; filename="<name>.magpie-theme.json"`; 404 "no such theme" for an unknown id.
- **`POST /api/themes/import`**, owner only, taking the file's JSON as the body (a 16 KB limit on this route). Answers `{ theme, dropped }`, or 400 with one of the sentences above.
- **`author` is kept on the theme** (`{ id, name, author?, light, dark }`), so a theme exported again still names who made it. `GET /api/themes` answers it; `sanitizeTheme` cleans it; Manage does not edit it.
- **`tools/check-themes.mjs`**, run by `npm run check`: exports each built-in and Strong Coffee and imports them back to the same colors; refuses an oversize file, a newer version, a file with no complete set and a value that is not a color; drops unknown keys and reports them; renames on a name clash; and a value such as `red; background: url(x)` never reaches `/theme.css`.

### Pages

On Manage > Theme, beside the chooser:

- **Export** downloads the theme shown in the chooser (Strong Coffee included).
- **Import…** opens a file picker for `.json`. After a good import, the new theme is chosen in the chooser and previewed, not applied, and the status line says what came in: "Imported Harbour by Thomas." with, when anything was dropped, "Left out: light.glow, font." A refused file shows the server's sentence. The owner presses Apply to use it, as with any theme.

### The owners' guide: "Creating themes"

A new user guide, `userguide-themes.md`, for owners, which the Theme paragraph in `userguide-environment-settings.md` then points to. Content-manager's, after the pages step. Its outline:

1. What a theme changes: colors only, never the layout; every page and module follows it.
2. The seven base colors, one line each on where it shows (the labels in `admin.html:96-102` are the starting point).
3. The optional colors and Auto: what each overrides, and when to set one rather than leave it on Auto.
4. Light and dark: one theme holds both; the environment's default mode and each person's own; making the second set from the first; keeping text readable on the background and on the accent.
5. Previewing, then Apply.
6. Sharing a theme: Export, Import, what happens when the name is taken, the author line, and that a theme file can only hold colors.
7. The built-ins and Strong Coffee, and starting from one of them.

## Left to build, in order

1. **The server** (server-development). The two routes, the import checks through `sanitizeTheme`, the rename on a clash, `author` on a theme, Strong Coffee's export, and `tools/check-themes.mjs`.
   - Done when: `npm run check` passes with `check-themes`.
   - Verify: checked by the tool; live on a throwaway `DATA_DIR` under `/tmp`: export each built-in and Strong Coffee, import each back (named "(2)"), and compare `/theme.css` with the original applied; import a hand-edited file with an unknown key, a bad color and a missing dark set, and read what was dropped.
2. **The pages** (experience-design). Export and Import… on Manage > Theme, the preview after an import, the status line.
   - Done when: `npm run check` passes.
   - Verify: live in a browser on the same server: export, import in another environment (on `BASE_DOMAIN=localhost`) and apply it there, and a refused file's sentence shown. Nothing here needs a call.
3. **The guide** (content-manager). `userguide-themes.md` from the outline above, and the pointer from `userguide-environment-settings.md`.
   - Verify: `npm run check:docs` and `npm run docs:build`.

Later, not in this plan: bundled `themes/<id>.json` (the built-ins could move there from `store.js`), a template naming one (decision 5), and a host library if wanted (decision 4).

## Open questions

1. **`author` on a theme made in Manage.** Recommended: none; only an imported theme has one, and an owner cannot type one. The alternative is an Author field on the Theme tab, which is only useful once people share many themes.
2. **Importing to the host console.** Recommended: not in this step; the host admin signs in to an environment as its admin and imports there.
