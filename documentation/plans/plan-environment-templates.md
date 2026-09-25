# Environment Templates Plan

**Audience:** Thomas, who decides what a template sets and how an environment follows it, and the sessions that build it: server-development (`server/`, the host registry, the checks) and experience-design (the pages, the console, the SDK's words).

**Status:** Addendum 2 (#68), "Templates grow", approved 2026-09-25: built (2026-09-25). The switching addendum (GitHub #59) is built (2026-09-25). Approved by Thomas on September 25, 2026 (reworked 2026-09-24); **done** (2026-09-25): steps 1 to 3 built. Deferred: the chat and the conference as modules a template can switch off stay in [plan-optional-conference](plan-optional-conference.md); more templates come later, each only a new file. Built right after [plan-names](plan-names.md) step 5c, before its steps 6 to 10. Asked for by Thomas: "Environment profiles: an environment can have a profile, e.g. "travel", that sets it up for that use: what things are called, icons, which modules are on, and possibly more." Named a **template**, since "profile" already means a space's profile and a person's profile page. On the words, Thomas (2026-09-24): "based on the template, the level name and code name NEVER change, but what's exposed to the user could change." Everything the first draft said about rooms and tables is done by plan-names and is not repeated here.

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
4. **Picked at creation**: the host console's create form and the product page's sign-up form, and `TEMPLATE=` on a single-environment install. Unset, everything is as today. Amended 2026-09-25: an owner or the host admin can also give an existing environment a template, or switch to another (see "Addendum: switching a template"); `TEMPLATE=` stays creation only.
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
   - **Built (2026-09-25).** `server/words.js`, `branding()`'s `words`, `settings.words` with `ownWords`, the server's messages through the words, Manage > Environment > **Words**, `public/words.js` with `data-word` and `data-fill`, `host.locale().words`, `host.util.word` and `host.util.fillWords`, the nine bundled modules converted and bumped, and `check-names --words` enforced in `server/`, `public/` and `modules/`. Two differences from the contract above: the words are saved with `PATCH /api/settings`, not `PUT`; and the pages have a `data-fill` attribute beside `data-word`, for placeholders in text and attributes. Not yet: text from a module's `module.json` still uses the default words (step 2). Documented in [architecture-overview](../architecture/architecture-overview.md) ("Words"), [api-module-sdk](../api/api-module-sdk.md) and the Manage guide. Verified live: with no words set, 44 page visits in every role and 28 API refusals read identically to the previous build; with words set, they read naturally everywhere checked; two hosted environments never leak words, the browser cache included. Read as code only: the call page in a real call.
2. **Module display names and icons** (server-development, then experience-design). The resolved display name and icon everywhere a module's name is sent, `host.info.module`, `PATCH /api/modules/:id`, the Modules tab's card with the module's own name and version.
   - Done when: `npm run check` passes and a module with no display name reads as today.
   - Verify: live, an owner's display name for Planner shown on the Modules tab (with "Planner v<version>" beside it), in the nav, on the dashboard and on the module's own page; `check-modules` covers the field.
   - **Built (2026-09-25).** **Shown as** on every Modules card (Conference and Chat too), `PATCH /api/modules/:id` `{ displayName, displayIcon }` with its refusals, `displayName`, `displayIcon`, `ownDisplayName` and `ownDisplayIcon` on `GET /api/modules`, the display name and icon everywhere a module is named and as `host.info.module`, and the text of `module.json` in the environment's words (the placeholders, all nine bundled manifests converted and bumped, and `check-names --words` reading manifests). Decided by the project manager while building: a module's own icon is always allowed as its display icon; a display icon must be a plain solid icon; and a widget keeps its own title, since the display name replaces the module's name, not a widget's label. Documented in [architecture-modules](../architecture/architecture-modules.md), [api-modules](../api/api-modules.md), [api-module-sdk](../api/api-module-sdk.md) and the Modules guide. Verified live.
3. **Templates** (server-development first, then experience-design). `server/templates.js`, `templates/travel.json`, `tools/check-templates.mjs`, the record, applying once in `environmentFor()`, entitlement skips, live words and icons from the template, `TEMPLATE=`, the create and sign-up fields, the console, Manage's note and skipped list.
   - Done when: `npm run check` passes with `check-templates`.
   - Verify: live on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: create a travel environment on the console with a plan that leaves Maps out, sign in, and check the words ("trip" everywhere), the modules on in the Lobby and in a new trip, Planner shown by its display name, the Environment panel's skipped list, and an owner changing a word, the home icon and a module name back; sign up from the product page with the template. Without `BASE_DOMAIN`: `TEMPLATE=travel` on a fresh `DATA_DIR`; the same variable on an existing directory (ignored, logged); an unknown id refusing to start. The Conference in a real call is read as code only.
   - **Built (2026-09-25).** `server/templates.js`, `templates/travel.json` (copied by the Dockerfile) and `tools/check-templates.mjs`; the choice on the host console's New environment form (with a **Plan** choice), on the product page's sign-up and as `TEMPLATE` on a fresh single install; applied once and recorded in `app.json`'s `template` with what was skipped and why; the words, home icon and module names and icons followed live, under the owner's own; the marks in Manage and the **Template** panel; the record carried by backup and restore; Planner 0.7.35. Documented in [userguide-templates](../userguides/userguide-templates.md) and [architecture-environments](../architecture/architecture-environments.md) ("Templates"). Verified live on hosted and single installs.

The documentation (a user guide section on templates for owners, the host operator's `TEMPLATE` and console notes, the SDK's `host.locale().words` and `host.util.word`) is content-manager's, after each step lands.

## Note: the Lobby (2026-09-25)

The rule in [plan-modules](plan-modules.md) ("Addendum: the Lobby is for being together", GitHub issue #63) applies to templates. "In every space" here means every space except the Lobby, for any module that does not declare `surfaces.canvas.lobby: true` (the Calendar does). A template, applied at creation or offered on a switch, never puts another module in the Lobby. The Lobby's name and description still come from the template. In the Lobby, chat is always on, the conference follows the environment's switch and the Calendar is there only if it is on; a template turns none of them on there by force (Thomas, 2026-09-25). The switch's offer lists a module as missing only for the spaces it may be in.

## Addendum: switching a template

**Status:** approved 2026-09-25; **built** (2026-09-25), both steps. GitHub issue #59. As built: the question before a switch adds "Then you choose what else it turns on."; the choice sits on Manage's Template tab (addendum 2) rather than Environment; `GET /api/environment/template` and `GET /api/host/environments/:slug/template` read the offer again; a switched record carries `switchedAt`, so it is never applied on its own at a start; and the home icon is stored only when an owner picks one (an old stored default is cleared once). Documented in [architecture-environments](../architecture/architecture-environments.md), "Templates", and [userguide-templates](../userguides/userguide-templates.md).

### The decision

Asked whether an existing environment can take a template, or change to another, Thomas answered: "Yes, owner or host." This amends decision 4.

- An owner (Manage > Environment gains a **Template** choice) or the host admin (the console) can give an existing environment a template, or switch it to another, or to none.
- Switching changes the words, the home icon and the module display names and icons at once. The owner's own choices still win.
- Switching offers to turn on the template's modules. It never turns anything off, removes a module or touches data.
- A switch is recorded the way a template applied at creation is.

### What it is today

The record is `template: { id, appliedAt, skipped }` in `app.json` (`cleanTemplateRecord`, `server/store.js`). `useTemplate()` in `server/index.js` records a template only for a fresh environment and reads the live part from the recorded id on every build (`templates.useLive`). `applyRecordedTemplate()` runs `templates.applyTemplate()` once, while `appliedAt` is empty. Two things it does are wrong for a switch: it sets `conferenceEnabled` to whether the template lists the conference, which can turn the conference off, and it clears `settings.homeIcon`, which would undo an owner's own home icon. The console's `PATCH /api/host/environments/:slug` changes only the registry entry, and the owner's `PATCH /api/settings` passes its body to `store.updateSettings`.

### The contract

**Switching** changes only the live part, at once:

- The record's `id` becomes the new template's (or the record is removed for none). `templates.useLive()` runs against the new template, so the words, the home icon and the module display names and icons follow it on the next request. The owner's own words (`settings.words`), home icon (`settings.homeIcon`) and module display names and icons (`PATCH /api/modules/:id`) are untouched and still win. `appliedAt` and `skipped` are cleared: the new template's once-only part has not been applied.
- The template's icons are added to the environment's icon list, so the pickers show them. Nothing is removed from the list.
- **None** removes the record: the words, the home icon and the module names and icons go back to their defaults (or the owner's own), and nothing else changes.
- A hosted environment's registry entry follows the record, as today.

**The offer.** The answer to a switch lists what the new template would add, and the person switching confirms what they want:

- **Modules**: each module the template lists (with what it requires) that is not already on in every space, with whether the plan allows it. Confirmed modules are installed if needed, enabled and put in every space (`allSpaces: true`), as at creation; one the plan does not include is skipped and recorded, as at creation. The conference is offered when the template lists it and it is off; it is never turned off.
- **The Lobby's name and description, and the new-space defaults** (`spaceDefaults.profile`): offered, unticked, since the Lobby's words are the owner's by now; applied only when ticked.
- When the offer is confirmed (even with nothing ticked), `appliedAt` is written and `skipped` records what was skipped, so the offer is not made again for that template.

**Never touched by a switch:** a module's on or off (except turning on what is confirmed), a module's spaces beyond adding `allSpaces` for a confirmed one, any module's data, the spaces and their members, the environment's settings (decision 1 below), the owner's words, icons and module names, and the billing plan.

**Routes:**

- Owner: `PATCH /api/settings { template: "<id>" | "none" }`. `template` is taken out of the body before `store.updateSettings`; an unknown id answers 400 "There is no template called <id>."; the same id as now answers 200 with nothing changed. The answer is the settings, as today, plus `template` (the view Manage shows) and `offer: { modules: [{ id, name, allowed, why? }], lobby: { name, description } | null, spaceDefaults: { profile } | null }`.
- Owner: `POST /api/environment/template/apply { modules: [ids], lobby: boolean, spaceDefaults: boolean }` applies the confirmed part of the offer for the recorded template; 409 when there is no recorded template or it is already applied.
- Host: `PATCH /api/host/environments/:slug { template }` does the same switch on that environment (building it if it is not built yet) and answers the environment with `template` and `offer`; `POST /api/host/environments/:slug/template/apply` takes the same body as the owner's.
- `GET /api/environment` and the console's environment list show the template and, when its offer is still open, that it is.

**The record.** `template: { id, appliedAt, skipped }` as today. Each switch is also added to `templateHistory: [{ from, to, at, by }]` in `app.json` (`by` is the owner's key or `host`), kept to the last 20 and not shown to owners (decision 3 below).

**`TEMPLATE=`** is unchanged: it picks a template for a new data directory only. On an existing one it is ignored with its log line, as today; switching a single-environment install is done in Manage.

**The pages.**

- Manage > Environment: a **Template** choice (None, then each template's name and description) beside the note naming the current one. Choosing one asks "Switch to <name>? Words, icons and module names change now. Nothing is turned off or removed." Then the offer: the modules as ticked boxes (the plan's refusals shown, not ticked), the Lobby and the new-space profile as unticked boxes, and **Apply** (Apply with nothing ticked closes the offer).
- The host console: the same choice and offer on an environment's card.

### Left to build, in order

1. **The server** (server-development). The switch in the store and `templates.js` (a switch variant of `applyTemplate` that never turns the conference off, never clears `homeIcon`, and applies only what is confirmed); the offer; the four routes; `templateHistory`; `check-templates` running a switch twice against a throwaway store.
   - Done when: `npm run check` passes.
   - Verify: checked by the tool; live on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: an environment made with no template switched to travel by its owner (the words read "trip" at once, the offer lists the modules, applying it turns them on in every space, a module the plan leaves out is skipped and recorded), then switched to none (the words go back, the modules stay on, their data untouched), and the same from the console; an owner's own word and home icon surviving both switches; a single-environment install switched in Manage.
2. **The pages** (experience-design). The Template choice and the offer on Manage > Environment and on the console's environment card.
   - Done when: the pages pass `npm run check`.
   - Verify: live in a browser on the same servers, both switches from both places. Nothing here needs a call.

The documentation (the owner's user guide on switching, the console's) is content-manager's, after each step lands.

### Decided at approval (2026-09-25)

Thomas answered the addendum's four questions as recommended:

1. **A switch does not offer the template's settings** (language, clock, currency, sign-in text and the rest of its allowed list). They are the owner's by now.
2. **Modules the previous template turned on are left on**, and in every space. A switch never turns anything off.
3. **`templateHistory` is kept**, the last 20 switches, for support and the console; it is not shown to owners.
4. **Switching back to a template used before makes its offer again**, listing only what is missing.

## Addendum 2: templates grow

**Status:** approved 2026-09-25; **built** (2026-09-25), step 3b's move of **Reactions** and **Icons** to Manage's Template tab included. Checked by the tools and a headless smoke test only; the live verification of steps 3a and 3b is still to come. GitHub issue #68. Documented in [architecture-environments](../architecture/architecture-environments.md), "Templates", and [userguide-templates](../userguides/userguide-templates.md). As built: the icon set is its own field, `iconSet`, and `icons` stays `{ home }`; the record also keeps `applied`, a fingerprint of each applied-once part, which decides what an update offers; the console has no one-step "Start from" (a bundled template is exported, then imported under a new id). Builds on the switching addendum (#59), the Lobby note (#63) and [plan-themes](plan-themes.md) (#67).

### The decision

Thomas (#68): "we need a 'template' tab in the environment to group the template-related stuff. In admin, we need to be able to define them too. My assumption over time is there will be more and more 'template' goodness... e.g. emoticons, icon sets, default theme choice, etc." He answered the questions that followed as recommended:

1. **The host defines templates.** They are made and edited on the host console and kept in `host.json`, beside the bundled ones. A single-environment install picks from the bundled templates plus template files it imports; it has no template editor in Manage.
2. **What a template holds grows: reactions, an icon set and a default theme, each applied once.** Only the display parts stay live: words, the home icon, module display names and icons.
3. **Editing a template in use.** Its live parts reach every environment made from it at once, unless the owner chose their own. New modules and the other applied-once parts are offered on the Template tab, never forced. A template has a version, and the offer lists only what is new since the version that environment applied.
4. **No role defaults in templates yet.**
5. **Template files.** `<name>.magpie-template.json`, with `magpieTemplate: 1`, embedding its theme in the theme file's shape ([plan-themes](plan-themes.md)).
6. **A Template tab in Manage** holds what the environment was made from and switching, the left-out modules, Words, module display names and icons (the Modules cards link there), and the home icon. Reactions and the icon list move there once templates hold them. Old links keep working.
7. **A template in use cannot be deleted**, only hidden from new choices.

The Lobby rule (#63) holds for every template, bundled, host-made or imported: a template never puts a module in the Lobby unless the Lobby allows it.

### What it is today

Templates are bundled files only (`templates/<id>.json`, read by `server/templates.js` at start); `GET /api/host/templates` lists them. The template controls are spread across Manage: the made-from note, the left-out modules and the home icon's template choice on Environment (`public/admin.html:284-313`), **Words** on Environment (`admin.html:324`), "Shown as" on each Modules card, and **Reactions** and **Icons** on Theme (`admin.html:154-172`, validated by `cleanReactions` and `cleanIcons`, `server/store.js:382`, `403`). The record is `template: { id, appliedAt, skipped }` in `app.json`, with `templateHistory` from the switching addendum.

### The contract

**Where templates come from.**

- **Bundled**: `templates/<id>.json`, read-only, released with the image.
- **Host**: `host.json` `templates: [{ ...the template, version, hidden, createdAt, updatedAt }]`, made and edited on the console.
- **Imported, single install**: `app.json` `templates: [...]`, from files an owner imports on the Template tab, so a backup carries them. On a hosted server owners do not import templates; they choose from the host's list.
- **Ids are unique across all of them.** A new or imported template whose id is already taken is refused with 409 "There is already a template called <id>." (the import offers a new id). If a later release ships a bundled template with an id a host or imported template already has, the existing one keeps the id and the bundled one is not offered on that server, with a log line; an environment's template never changes under it.

**The template's shape grows** (the same checks in `server/templates.js` and `tools/check-templates.mjs` for every source):

- `version`: a whole number. The host's templates count up on every save; a bundled file carries its own, raised by hand when its applied-once part changes.
- `reactions`: `[{ id, glyph, label }]`, the same shape and checks as `cleanReactions`. Applied once: at creation it becomes the environment's reactions list.
- `icons`: Font Awesome Free names. Applied once: added to the environment's icon list, never removing one.
- `theme`: an embedded theme in the theme file's shape (`{ name, author?, light, dark }`), checked as a theme import is. Applied once: added as a new theme (renamed "Name (2)" on a clash, never overwriting) and made active, with `settings.themeMode` if the template sets it. `settings.activeThemeId` naming a built-in keeps working for a template with no `theme`.
- No `roles` (decision 4).
- The rest is as today: `words`, `icons.home`, `moduleNames`, `moduleIcons` (live); `modules`, `settings`, `lobby`, `spaceDefaults` (once).

**The record** gains `appliedVersion`: `template: { id, appliedAt, appliedVersion, skipped }`.

**When a template changes** (a host edit, or a new release's bundled file):

- The live parts follow at once: the next request reads the words, home icon and module names and icons from the template's current version. An owner's own choices still win.
- The Template tab shows an offer when the template's `version` is above the environment's `appliedVersion`: the modules it now lists that are not on (outside the Lobby), and, unticked, its reactions, icons, theme, Lobby and new-space defaults when they differ from what was applied. Confirming (even with nothing ticked) records the new `appliedVersion`. This is the switching addendum's offer, run for the same template.
- Nothing is forced, turned off or removed, and no data is touched.

**Hidden and deleted.** A host template can be hidden: it is no longer offered on the create form, sign-up or a switch, and environments made from it keep reading it. Deleting answers 409 "Environments use this template: <names>. Hide it instead." while any environment's record names it; one no environment uses can be deleted.

**Template files.** `<name>.magpie-template.json`: `{ "magpieTemplate": 1, ...the template's fields, "theme": { the theme file's fields } }`, at most 64 KB. Import checks it as a template (a newer `magpieTemplate` refused: "This template was made by a newer version of Magpie."; unknown keys dropped and listed, as a theme import does). A bundled template can be exported too, so the host can start one of its own from it.

**Host routes** (host admin only):

- `GET /api/host/templates`: every template, `{ id, name, description, source: 'bundled' | 'host', version, hidden, usedBy: [slugs] }`.
- `POST /api/host/templates`: a new host template.
- `PATCH /api/host/templates/:id`: edit a host template (its `version` goes up); 403 "Bundled templates can't be edited; export one to start your own." for a bundled one.
- `PATCH /api/host/templates/:id { hidden }`: hide or show a host template.
- `DELETE /api/host/templates/:id`: only when unused (above).
- `GET /api/host/templates/:id/export` and `POST /api/host/templates/import`, answering `{ template, dropped }`.

**Owner routes.**

- `GET /api/environment/template`: the Template tab's view: made from (name, source, version), `appliedVersion`, the left-out modules, the open offer if any, and the choices for a switch (hosted: the host's shown templates and the bundled ones; single: the bundled ones and the imported ones).
- The switching addendum's `PATCH /api/settings { template }` and `POST /api/environment/template/apply` serve both a switch and an update offer.
- Single install only: `POST /api/templates/import` and `GET /api/templates/:id/export`; `DELETE /api/templates/:id` for an imported one no longer in use.

**Manage's Template tab** (`/admin#template`), top to bottom:

- **Made from**, with the template's name and version, the Template choice and the switch (the switching addendum), and the offer when one is open.
- **Left out**: what the plan skipped.
- **Words** (moved from Environment).
- **Module names and icons**: every module with its display name and icon, and "Planner v0.7.30" beside each; each Modules card's "Shown as" becomes a link to its row here.
- **Home icon** (the template's choice, moved from Environment).
- **Reactions** and **Icons** move here from Theme in the step that makes templates hold them.
- A single install also gets **Import a template** and **Export** here.
- Old links keep working: `#environment`, `#settings` and `#server` still open Environment, `#theme` still opens Theme, and a link to a moved section opens the Template tab at it.

**The host console** gains a **Templates** tab: the list (source, version, hidden, used by), a template editor for host templates (the fields above, with the module list showing that the Lobby keeps its own rule), Hide, Delete when unused, Export, Import, and "Start from" a bundled template (an export and import in one step).

### Left to build, in order

1. **Theme files** ([plan-themes](plan-themes.md), #67): the foundation for a template's `theme`.
2. **The Template tab, switching and the Lobby rule** (experience-design for the tab; server-development for the switching addendum's routes and [plan-modules](plan-modules.md)' Lobby addendum). The tab gathers what exists today; switching and the Lobby rule land with it.
   - Verify: live on `BASE_DOMAIN=localhost` and on a single install under `/tmp`: every control works from its new place, old links open the right tab, a switch and its offer, the Lobby keeping only what it allows.
3. **Templates grow** (server-development, then experience-design).
   - **3a. The server.** The shape's new fields and `version`, `appliedVersion` and the update offer, host templates in `host.json` with their routes, template files, the single install's imported templates, the id rules, hide and delete, `check-templates` for all of it.
     - Done when: `npm run check` passes.
     - Verify: checked by the tool (every source through the same checks; an update offer listing only what is new; apply twice gives the same result); live, a host template made on the console, an environment made from it, the template edited (the words change at once, a new module offered on the Template tab, nothing forced), hidden (gone from the create form, the environment unchanged), refused deletion while in use; a template exported and imported on a single install; a bundled template exported and started from.
   - **3b. The pages.** The console's Templates tab and editor; reactions and icons moving to the Template tab; the single install's import and export.
     - Verify: live in a browser on the same servers. Nothing here needs a call.
4. **The documentation** (content-manager): the owners' guide to the Template tab, the host's guide to templates on the console, and the template file.

### Decided (2026-09-25, by the project manager while building)

1. **`iconSet` is a separate field.** A template's icons for the environment's icon list are `iconSet: [names]`; `icons` stays `{ home }`.
2. **An owner on a hosted server can export** the template their environment uses, and only that one (open question 2, as recommended). Import and delete stay the host's.
3. **Applied fingerprints decide what an update offers.** The record keeps `applied`, a fingerprint of each applied-once part as it was when last applied or passed over; an update offers only the parts the template changed since, rather than whatever differs from the environment now.
4. **An import keeps the file's version.**
5. **A bundled template's version is raised by hand** (open question 3, as recommended), and enforced: `tools/template-versions.json` records each bundled template's version with a fingerprint of its applied-once part, `check-templates` fails when the part changed and the version didn't, and `node tools/check-templates.mjs --update` records the new ones.

### Open questions

1. **A host template edited while the offer is open.** Recommended: the offer always compares with the template's current version, so the owner sees one offer, never a queue.
2. **An owner on a hosted server exporting their environment's template as a file.** Recommended: yes, read-only (export only), so they can take it to a single install; import stays the host's.
3. **A bundled template's `version`.** Recommended: raised by hand only when its applied-once part changes; a change to words or icons alone needs no new version, since those are live.

