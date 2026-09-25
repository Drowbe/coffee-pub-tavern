# Environment Templates Plan

**Audience:** Thomas, who decides what a template sets and how an environment follows it, and the sessions that build it: server-development (`server/`, the host registry, the checks) and experience-design (the pages, the console, the SDK's words).

**Status:** Approved by Thomas on September 25, 2026 (reworked 2026-09-24); nothing built. Built right after [plan-names](plan-names.md) step 5c, before its steps 6 to 10. Asked for by Thomas: "Environment profiles: an environment can have a profile, e.g. "travel", that sets it up for that use: what things are called, icons, which modules are on, and possibly more." Named a **template**, since "profile" already means a space's profile and a person's profile page. On the words, Thomas (2026-09-24): "based on the template, the level name and code name NEVER change, but what's exposed to the user could change." Everything the first draft said about rooms and tables is done by plan-names and is not repeated here.

## What it is today

This is the code after plan-names steps 1 to 5a; steps 5b (the pages) and 5c (the SDK and the bundled modules) come before this plan is built.

- **Words.** Every word a person reads is typed into the pages and the server one at a time. The level and role words ("space", "spaces", "owner", "member") appear throughout `public/*.html`, `public/*.js` and the server's messages; the primary nav's Spaces link is `label: 'Spaces'` (`public/brand.js:181`). Pages fill branded text by `data-brand` attributes in `loadBranding()` (`public/brand.js:73-110`), from `GET /api/branding` (`branding()`, `server/index.js:833-835`). `tools/check-names.mjs --words` already scans what a person reads, for the old names only.
- **The environment's name** is `settings.environmentName` (`server/store.js:189`), set on first build by `environmentFor()` (`server/index.js:379`).
- **Icons.** `settings.homeIcon` (default `couch`, `store.js:47`, `190`), validated against the environment's own icon list (`iconIds()`, `store.js:708`, seeded from `STARTER_ICONS`, `store.js:40`), used for the home icon and the Spaces link. Each module's `icon` is its manifest's.
- **Module names.** A module's name is its manifest's `name` only. The Travel module's id is `travel` and its name "Planner" (version 0.7.30 today). The server sends `manifest.name` in about twelve places, among them the module's own context (`server/index.js:4014`), the nav, the widgets and the Modules tab.
- **The SDK.** `host.locale()` answers `{ language, clock, currency, currencies }` (`public/sdk/host.js:293`, `443`), the generic channel for how the environment shows things. No template id or environment identity reaches a module.
- **The Lobby** is seeded once as "Lobby", "Where everyone meets." (`store.js:493`). A new space starts with the `roleplaying` profile unless `addSpace()` is told otherwise (`store.js:1126`, `574`).
- **Which modules are on.** A bundled module is installed, enabled for the environment, then turned on per space (`allSpaces` or `spaces` on its registry entry, `server/modules.js:664`, `835`). `install.auto` installs and enables a bundled module once per environment, recorded (`autoInstallBundled()`, `server/index.js:424`). Conference and Chat are built in (`BUILTIN_MODULES`, `server/index.js:2634`): Conference has an environment-wide switch (`conferenceEnabled`); Chat has none. A billing plan's `modules` list is the hard limit on what an environment may enable.
- **Where an environment starts.** `hostRegistry.addEnvironment({ slug, name, plan })` (`server/host-registry.js:300`), from the console's `POST /api/host/environments` (`server/index.js:1058`) and the product page's `POST /api/product/signup` (`server/index.js:1612`). The first build of an environment runs `environmentFor()`. "Apply once and record it" is already how `install.auto`, the built-in themes, the starter icons and the names migration's parts work.

## Decisions

1. **The name is "template".** "Profile" already means a space's profile and a person's page; "plan" already means a billing plan.
2. **Mixed.** Words and icons follow the template live. Settings and modules are applied once, when the environment is created.
3. **Defaults, never locks.** The owner can change anything a template set. Only the billing plan limits what an environment may use.
4. **Picked at creation only**: the host console's create form and the product page's sign-up form, and `TEMPLATE=` on a single-environment install. Unset, everything is as today. Never switched afterwards.
5. **Bundled only**: `templates/<id>.json` in the repository, released with the image.
6. **Separate from billing plans.** A template module the environment's plan does not include is skipped, and the skip is recorded and shown.
7. **A template's modules are on in every space**, and new spaces start with them.
8. **The words are the Names.** The keys are exactly the levels (`host`, `environment`, `space`, `aside`, `canvas`, `module`, `object`) and the roles (`admin`, `owner`, `moderator`, `member`, `guest`). A template maps each to its words. The code names never change; only what a person reads does.
9. **Modules keep their names; a template gives them a display name.** Thomas: "'Planner' is the module name. The host will enable that for the environment. BUT for travel, because of our templates, 'Planner' will be exposed to the user as 'Trip Planner' or 'Itinerary' or whatever is declared in the template. SO, in the settings for the environment, we will call it what the template declares... but it would behoove us to append the proper module name to the version number... so they see both the title 'Itinerary' and the version 'planner v123.34.455'." A template declares module display names and icons; Manage shows the display name, with the module's own name and version beside it.
10. **The travel template**: the modules Planner (`travel`), Places, Maps, Research, Calendar and Chat, with the Conference on (Thomas: "On"); the space word is **Trip**.
11. **Chat and Conference as optional modules is not a blocker.** The travel template turns both on, as they are today. Making them switchable belongs to [plan-optional-conference](plan-optional-conference.md), a later plan of its own.
12. **Words reach pages and modules without the template.** Pages read them through `data-word` and a `word()` helper; modules through `host.locale().words`. No template id reaches a page's logic or a module (the conduit rule).

Recommended, and accepted by Thomas at approval (September 25, 2026):

13. **`TEMPLATE` on a hosted server is ignored**, with a log line on start; there, templates come from the console and sign-up.
14. **The record is the template's own**, not a names migration part: `template: { id, appliedAt, skipped }` in `app.json`. A migration part means "data a newer build wrote", which an older build must refuse; a template is not that.
15. **The word check is a mode of `check-names`**: `--words` gains the level-word rule below, rather than a separate `check-words.mjs`. Template files get their own `tools/check-templates.mjs`, since that is checking data, not names.

Decided at approval (September 25, 2026):

16. **Beside a display name, Manage shows the module's own name and version**: "Itinerary", with "Planner v0.7.30" beside it (the manifest's `name`, not its id).
17. **The travel template's defaults**: Planner shown as "Itinerary"; the Lobby named "Home base", described "Everyone on every trip."; the home icon `suitcase-rolling`; new trips start with the Participants profile.
18. **Owners and templates can change every word except `host` and `admin`**, which are the host's own words. That is ten keys; `host` and `admin` always read their default words.

## The contract

### The vocabulary

| Key | Names | Default words (one / many) |
|---|---|---|
| `host` | the whole server | host / hosts |
| `environment` | what people sign in to | environment / environments |
| `space` | a space | space / spaces |
| `aside` | a temporary space for a quick call | aside / asides |
| `canvas` | where modules are used in a space | canvas / canvases |
| `module` | a tool on the canvas | module / modules |
| `object` | a thing a module holds | object / objects |
| `admin` | the server's admin | admin / admins |
| `owner` | who runs the environment | owner / owners |
| `moderator` | who runs things in one space | moderator / moderators |
| `member` | a person with an account | member / members |
| `guest` | a person in by a guest link | guest / guests |

- **A word's shape** is `{ one, many, a? }`: the singular, the plural, and the article when it is not the usual one ("an aside"). Capitals come from the helper, never from a second copy. English only, the one language there is; a later language adds a set per language under the same keys.
- **Where a word comes from, in order:** the owner's own (`settings.words.<key>`), else the template's, else the default. `host` and `admin` are the host's own words and always read their defaults (decision 18); neither an owner nor a template can change them. Resolved on the server, per request, so a template file's change is live on the next release.
- **No other keys.** The first draft's `call`, `chat`, `lobby` and `private` are not levels and are dropped. The Lobby's name is stored on the space (below). Chat and Conference are built-in modules, named by module display names. "Private" describes an aside and stays a fixed word. Adding a key means adding a level, which is a change to CLAUDE.md's Names first.

### Module display names and icons

- A template may give a module a display name and an icon (`moduleNames`, `moduleIcons`, by module id, bundled or built in: `travel`, `conference`, `chat`). The owner may change or clear either.
- The server sends the display name wherever it sends a module's name today (the Modules tab, the nav, the dashboard's widgets, the canvas's module switches, and `host.info.module.name` on the module's own page), and the icon likewise. A module that prints its own name reads it from there, never from its manifest text.
- **Manage shows both.** A module's card on the Modules tab shows the display name as its title and, where the version is shown, the module's own name and version: "Itinerary", with "Planner v0.7.30" beside it. With no display name, the card reads as today.
- A template naming module ids is data, like a billing plan's module list: nothing in the code knows which template names which module.

### The template file

`templates/<id>.json`, checked by `tools/check-templates.mjs`:

```json
{
  "id": "travel",
  "name": "Travel",
  "description": "Plan trips together: the itinerary, places, maps, research and a calendar.",
  "words": { "space": { "one": "trip", "many": "trips" } },
  "icons": { "home": "suitcase-rolling" },
  "moduleNames": { "travel": "Itinerary" },
  "moduleIcons": {},
  "modules": ["travel", "places", "maps", "research", "calendar", "chat", "conference"],
  "settings": {},
  "lobby": { "name": "Home base", "description": "Everyone on every trip." },
  "spaceDefaults": { "profile": "participants" }
}
```

- `words`: any of the ten changeable keys (every key but `host` and `admin`, decision 18); the rest keep their defaults. Live.
- `icons.home`: the home icon and the Spaces link's. A Font Awesome Free name. Live; applied once as well, by adding it to the environment's icon list so the owner's icon picker shows it.
- `moduleNames`, `moduleIcons`: live.
- `modules`: bundled module ids and the built-in `conference` and `chat`. Applied once. A bundled module listed is installed, enabled and on in every space (`allSpaces: true`), with its `requires` added (Maps needs Places). `conference` listed leaves `conferenceEnabled` on; left out, it is switched off. `chat` must be listed until plan-optional-conference gives Chat a switch; `check-templates` refuses a template that leaves it out.
- `settings`: values for a fixed list the owner can set anyway (language, clock, currency, `loginText`, `allowRegistration`, `mfaRequired`, the call features, the active built-in theme and its mode), each through `store.updateSettings`. Applied once.
- `lobby`: the Lobby's name and description, stored on the space. Applied once; afterwards they are the owner's, like any space's.
- `spaceDefaults`: what a new space starts with; `profile` only (`roleplaying`, `participants` or `characters`). Kept on the environment and read by `addSpace()` for every space made later.

The travel values above are decided (decision 17).

### Server

- **Loading.** `server/templates.js` reads `templates/*.json` at start, validates each with the same rules as `check-templates.mjs`, and refuses to start on an invalid one. `templates.get(id)`, `templates.list()` answering `[{ id, name, description }]`.
- **Recording.** `app.json` keeps `template: { id, appliedAt, skipped: [{ id, why }] }` (decision 14), so an export and a restore carry it. A hosted environment's registry entry keeps `template: id` too, for the console. An environment made before this plan has no `template` and is exactly as today. An environment whose recorded template id this build does not have reads the default words, and the log says so once.
- **Applying once.** In `environmentFor()`, after `buildEnvironment`, an environment with a template id and no `appliedAt` has it applied, in order: settings, the Lobby, the space defaults, the home icon into the icon list, then the modules (installed as `autoInstallBundled()` does, enabled, `allSpaces: true`; `conferenceEnabled` set), then `appliedAt` is written. It runs before `autoInstallBundled()`, and never twice. A module that fails to install is recorded in `skipped` with its reason.
- **Entitlement.** A module the plan's `modules` list does not include is not installed and is recorded as `{ id, why: 'not in the plan' }`. The template never widens a plan.
- **Live words and icons.** `branding()` gains `words` (every key, resolved) and the resolved `homeIcon`. For an environment made from a template, `settings.homeIcon` starts unset, meaning "the template's"; an owner's choice sets it. Module display names and icons are resolved the same way (the owner's, else the template's, else the manifest's).
- **The owner's changes.** `PUT /api/settings` takes `words: { <key>: { one, many, a? } | null }` for the ten changeable keys (`host` or `admin` answers 400) (null returns that key to the template's word or the default) and `homeIcon: null`. `PATCH /api/modules/:id` takes `displayName` and `displayIcon`, null to clear.
- **Creating.** `POST /api/host/environments` and `POST /api/product/signup` take an optional `template` (an id; an unknown one answers 400 "There is no template called <id>."). `GET /api/host/templates` and `GET /api/product`'s new `templates` list them. `GET /api/host/environments` shows each environment's template and its `skipped` list. `GET /api/environment` gains `template: { name, skipped }` for the owner's Environment panel.
- **`TEMPLATE=` on a single-environment install.** Checked at start: an unknown id refuses to start, listing the known ones. On a new data directory (no `app.json` yet), the template is recorded and applied as above. On an existing data directory with no template recorded, it is ignored with a log line, since a template is picked at creation only (decision 4). On one with a different template recorded, the recorded one wins and the log says so once. With `BASE_DOMAIN` set, `TEMPLATE` is ignored with a log line (decision 13).
- **Server messages** that name a level ("no such space", "you are not a member of that space") are built from the resolved words, through one helper.

### Pages

- **One helper.** `public/brand.js` gains `word(key, { many, cap, a })`, filled from `/api/branding`'s `words`, and a `data-word="space"` attribute (with `data-word-form="many"`, `"cap"`, `"a"`) that `loadBranding()` fills as it fills `data-brand`. Every level and role word typed into the pages becomes one or the other; the Spaces link's label becomes `word('space', { many: true, cap: true })`.
- **Nothing reads a template id.** No page branches on the template; pages only read words.
- **Manage.** The Environment tab gains a **Words** group: each of the ten changeable keys with its one and many, blank for the template's or the default word, and a note naming the template the environment was made from ("Made from the Travel template"). The Modules tab gains a display name and an icon on each module's card, and shows the module's own name and version beside the display name. The Environment panel lists what was skipped ("Not in your plan: Maps").
- **The host console.** The create form gains a **Template** choice (None, then each template's name and description). The environment list shows each one's template and what was skipped.
- **The sign-up form** on the product page gains the same choice when the host has any templates.

### SDK

- `host.locale()` gains `words`: the same resolved object the pages get. `host.util.word(key, { many, cap, a })` applies it, so a module never copies the capitals and plural rules.
- `host.info.module.name` and `.icon` are the module's display name and icon in this environment.
- No template id, template name or environment identity reaches a module. A module written against `host.locale().words` works under any template and none. Bundled modules that print a level word move to `host.util.word` and get a version bump.

### `check-names --words` and `check-templates`

- **`tools/check-names.mjs --words`** gains a rule: a level or role word (either form, any capital) typed into a page's text, the SDK's text or a server message, rather than going through `word()`, `data-word` or the server's word helper, fails. The allow-list takes the few places where the word is not the level (for example "a guest link" in the host console's own words, if any). It also checks that every key the pages use exists in the vocabulary with both forms.
- **`tools/check-templates.mjs`** checks each template file: known fields and types, known changeable vocabulary keys (not `host` or `admin`) with `one` and `many`, module ids that are bundled or built in, `chat` present, Font Awesome Free icon names, allowed settings only, a known `profile`; and runs the apply step twice against a throwaway store, with the same result both times, and with a plan that leaves one module out recording it as skipped.
- `npm run check` runs both.

## Left to build, in order

Built after plan-names step 5c: the pages and the SDK already use the Names' code names, so the words go in once. plan-names steps 6 to 10 come after; anything they touch that a person reads already goes through `word()` and must keep doing so (`check-names --words` holds them to it).

1. **The words** (server-development, then experience-design). The vocabulary and its defaults in one server module; `branding()`'s `words`; `settings.words` and `PUT /api/settings`; the server's messages through the helper; `word()` and `data-word` in the pages, and every level and role word converted; `host.locale().words` and `host.util.word`; bundled modules that print a level word moved and bumped; the Words group on Manage; the `--words` rule.
   - Done when: `check-names --words` passes with the new rule, and an environment with no template reads exactly as before.
   - Verify: checked by the tool (every page's text before and after, word for word); live, an owner's word for `space` shown on every page and in a bundled module that prints it; server messages read as code where they only happen in a call.
2. **Module display names and icons** (server-development, then experience-design). The resolved display name and icon everywhere a module's name is sent, `host.info.module`, `PATCH /api/modules/:id`, the Modules tab's card with the module's own name and version.
   - Done when: `npm run check` passes and a module with no display name reads as today.
   - Verify: live, an owner's display name for Planner shown on the Modules tab (with "Planner v<version>" beside it), in the nav, on the dashboard and on the module's own page; `check-modules` covers the field.
3. **Templates** (server-development first, then experience-design). `server/templates.js`, `templates/travel.json`, `tools/check-templates.mjs`, the record, applying once in `environmentFor()`, entitlement skips, live words and icons from the template, `TEMPLATE=`, the create and sign-up fields, the console, Manage's note and skipped list.
   - Done when: `npm run check` passes with `check-templates`.
   - Verify: live on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: create a travel environment on the console with a plan that leaves Maps out, sign in, and check the words ("trip" everywhere), the modules on in the Lobby and in a new trip, Planner shown by its display name, the Environment panel's skipped list, and an owner changing a word, the home icon and a module name back; sign up from the product page with the template. Without `BASE_DOMAIN`: `TEMPLATE=travel` on a fresh `DATA_DIR`; the same variable on an existing directory (ignored, logged); an unknown id refusing to start. The Conference in a real call is read as code only.

The documentation (a user guide section on templates for owners, the host operator's `TEMPLATE` and console notes, the SDK's `host.locale().words` and `host.util.word`) is content-manager's, after each step lands.
