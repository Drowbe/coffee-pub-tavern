# Environment Templates Plan

**Audience:** the author deciding what a template sets and how an environment follows it, and the sessions that build it: server-development (`server/`, the host registry, the checks) and experience-design (the pages, the console, the SDK's words).

**Status:** decided 2026-09-24; nothing built. Asked for by the author: "Environment profiles: an environment can have a profile, e.g. "travel", that sets it up for that use: what things are called, icons, which modules are on, and possibly more." Named a **template**, since "profile" already means a space's profile and a person's profile page. On the old words, the author: "we are not supposed to even have the idea of rooms and tables anymore. Remove them. Further, I want to be clear that "spaces" is still the internal word (and same for our other names hierarchy), but the template will map that to a template-appropriate word."

**Blocked on [plan-names](plan-names.md) (2026-09-24).** The rename to the architecture's names comes first, and this plan will be reworked on top of it. What changes here once it lands:

- Open questions 1 (keeping `room` in the code) and 2 (the call's base name) and decision 11 (a `room` in the code) are replaced by plan-names: the code says `space`, and the call's name is no longer a stored setting.
- Removing `tableName` and `settings.room` moves from step 1 here to plan-names step 3.
- `tools/check-words.mjs` is not built; it becomes the `--words` mode of `tools/check-names.mjs`.
- The `owner` key's default word is "owner" everywhere, not "admin" on a single-environment install, since the role is `owner` on every install.
- The rest of this plan's code names follow plan-names: `allRooms` is `allSpaces`, `addRoom` is `addSpace`, `room.profile` is `space.profile`, built-in panes are built-in modules, and `serverName` is `environmentName`.
- This plan builds after plan-names step 5.

## What it is today

**Names.** Every word a person reads is typed into the pages and the server, one at a time:

- The environment's own name is the `serverName` setting (`server/store.js:176`), set once from the registry or `PRODUCT_NAME` on first start (`server/index.js:301`). The product's name is `PRODUCT_NAME` (`server/index.js:54`), the host's, not an environment's.
- "Space" and "spaces" are written into the pages about 110 times: `public/room.js` (22), `roomconfig.html` (14), `admin.html` (12), `landing.html` (9), `module-host.js` (8), `room.html` (7), `sdk/host.js` (6), `brand.js` (6), `admin.js` (5), and a few each in thirteen more files. The primary nav's Spaces link is `label: 'Spaces'` in `public/brand.js:150`.
- The Lobby's name and description are stored on the space, seeded once (`server/store.js:464`, "Everyone at the table."); an unnamed space falls back to `'Room'` and a new one to `'New room'` (`store.js:526`, `1066`).
- A module's name is its `module.json` `name` only (the Travel module's is "Planner"); nothing renames it per environment.
- Modules already get the environment's display settings from the SDK: `host.locale` is `{ language, clock, currency }` (`public/sdk/host.js:241`, `389`), which `host.util.time` and `host.util.money` apply. That is the generic channel words join.
- Pages fill branded text by `data-brand` attributes in `loadBranding()` (`public/brand.js:41-60`), from `GET /api/branding` (`branding()`, `server/index.js:709-711`).

**Rooms and tables, still in what people read.**

- `tableName` ("The Table"): a stored setting (`store.js:178`, validated at `688`), sent by `branding()` (`index.js:711`), a fallback in `brand.js:42` and a `data-brand="tableName"` fill at `brand.js:57` that no page uses any more, and the call page's name for the space it is in (`public/room.js:64`, `3304`, and the status lines built from it at `557`, `1904`, `2195`, `2201`, `2245`, `2279`, the chat export's file name at `1432`, the pop-out's title at `1584`, `3003`).
- "The table" in sentences: `admin.html:154`, `247`; `room.html:203`; `roomconfig.html:89`; `admin.js:102`, `133`, `147`, `157`, `234`, `721`; `register.js:14`; `profile.js:129`, `130`, `144` ("Admin: runs the table"), `577`; `room.js:214`, `223`, `630`, `1881`, `2063`, `2065`, `2118`, `2964`; the web app manifest's description (`index.js:1704`); server messages at `index.js:2172`, `2211`, `2216`, `2233`, `2435`. `dashboard.js`, `landing.html`, `module-host.js` and a few others use the word too and need the same sweep.
- "Room" in sentences: about fifty server messages (`index.js` 31 lines, `store.js` 14, `modules.js` 5, such as "no such room", "not a member of that room"), and the built-in panes' descriptions ("Voice and video for the room", `index.js:2475-2476`).
- `room: 'table'` (`store.js:179`) is **not** a word. It is the base name of every call on the call service (`livekitBase()`, `index.js:413-420`): the Lobby's call is `table`, another space's is `table-<id>`, and on a hosted server `<slug>-table`. The comment there says the Lobby keeps the base name "so links and the Studio from before rooms still work". `branding()` also sends it to every page, which reads nothing from it.

**Icons.** The `homeIcon` setting (default `couch`, `store.js:47`, `177`), also used for the Spaces link (`brand.js:150`); the uploaded site icon (`/img/site/icon`, `index.js:1616`); each module's `icon` in `module.json`; each nav tool's own icon (`public/nav-bar.js:104`).

**Which modules are on.** A bundled module is installed, then enabled for the environment (`server/modules.js:764`), then turned on per space (`entry.allRooms` or `entry.rooms`, `index.js:2566`); plan-modules decided that a space's modules stay off until an admin turns them on there. `install.auto` installs and enables a bundled module once per environment, recorded so it never runs again (`modules.js:439-447`, `autoInstallBundled`, `index.js:319-340`). Conference and Chat are the two built-in panes listed beside the modules (`BUILTIN_MODULES`, `index.js:2474-2477`); Conference has an environment-wide switch (`conferenceEnabled`, stage 1 of [plan-optional-conference](plan-optional-conference.md), built), Chat has none. A billing plan's `modules` list is the hard limit on what an environment may enable (plan-tenants phase 3).

**Where an environment starts.** `hostRegistry.addTenant({ slug, name, plan })` (`server/host-registry.js:295`), from the console's `POST /api/host/tenants` and the product page's `POST /api/product/signup` (`index.js:1454`). The first time an environment is built, `environmentFor()` (`index.js:~290-316`) runs its one-time setup. "Apply once and record it" is already how four things work: the server name, the built-in themes (`store.js:466-494`), the starter icons (`store.js:504-509`) and `install.auto`.

## Decisions

1. **The name is "template".** "Profile" already means a space's profile (`room.profile`) and a person's own page; "plan" already means a billing plan.
2. **Words and icons follow the template live; settings and modules are applied once**, when the environment is created. A change to a template file's words or icons reaches every environment made from it on the next release; a change to its modules or settings reaches only environments made after.
3. **Defaults, never locks.** An owner can change anything a template set. Only the billing plan limits what an environment may use.
4. **Chosen at creation only**, on the host console or the sign-up form, and never switched afterwards.
5. **Words are a fixed set of core words, plus module display names.** The pages fill them in; modules read them from `host.locale`. No template id ever reaches a module or a page's logic.
6. **A template's modules are on in every space**, and new spaces start with them. This changes the plan-modules default ("off in a space until an admin turns it on") for environments made from a template only.
7. **A single-environment install takes `TEMPLATE=<id>`.** Unset, it behaves exactly as today. Its settings and modules apply only to a fresh data directory; its words and icons are live.
8. **Templates are bundled only**: `templates/<id>.json` in the repository, released with the image. Templates the host admin makes are a later step.
9. **Separate from billing plans.** A template module the environment's plan does not include is skipped, and the skip is recorded and shown.
10. **The first template is "travel"**: the modules are, in the author's words, "planner, places, maps, research, calendar, chat (we need to make chat and conference optional modules too)", and the space word is **Trip**.
11. **Rooms and tables go as ideas.** No person reads "room" or "the table" anywhere. "Space" stays the internal word, and the same for the rest of the names below; a template maps each to its own word.

## The contract

### The names: the keys

The names, from the host down, are the keys of the vocabulary. The code refers to a key, never to the word a template gives it. Each key's default words are today's words, so an environment with no template reads exactly as it does now, apart from the removal of "room" and "table" (phase 1).

| Key | What it names | Default words (one / many) |
|---|---|---|
| `environment` | the tenant, as its owner sees it | environment / environments |
| `space` | a space (a `room` in the code) | space / spaces |
| `lobby` | the space everyone is in | Lobby (a proper name; one form) |
| `call` | the voice and video in a space | call / calls |
| `chat` | the space's text chat | chat (one form) |
| `aside` | a pull-aside inside a space | aside / asides |
| `private` | a private conversation of two | private conversation / private conversations |
| `owner` | who runs the environment | owner / owners on a hosted server; admin / admins otherwise (today's rule, `plan-tenants` phase 2) |
| `moderator` | who runs one space | moderator / moderators |
| `member` | a person with an account | member / members |
| `guest` | a person in by a guest link | guest / guests |

Not keys: the host and the product (the host's, never an environment's), "module" (a platform word, the same everywhere), and a module's own words (see "Module names" below). Adding a key is a change to this plan.

**A word's shape** is `{ one, many, a? }`: the singular, the plural, and the article when it is not the usual one ("an aside"). Capitals come from a helper, never from a second copy of the word. English only, the one language there is; a later language adds a set per language under the same keys.

**Where the words come from, in order:** the owner's own word for that key (`settings.words.<key>`, when set), else the template's, else the default. Words are resolved on the server, per request, so a template file's change is live on the next start.

### Module names

A template may give a module a display name and an icon for this environment (`moduleNames`, `moduleIcons`, by module id). The owner may change either. The server puts the display name wherever it sends a module's name: the Modules tab, the pane switches, the nav, the dashboard's widget titles, and `host.info.module.name` on the module's own page. A module that prints its own name reads it from there, never from its manifest's text.

A template naming module ids is data, like a billing plan's module list: nothing in the code knows which template names which module.

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
  "modules": ["travel", "places", "maps", "research", "calendar", "chat"],
  "settings": {},
  "lobby": { "name": "...", "description": "..." },
  "spaceDefaults": { "profile": "participants" }
}
```

- `words`: any keys from the table above; the rest keep their defaults. Live.
- `icons.home`: the home icon (and the Spaces link, which uses it). Font Awesome names in the Free set. Live. `moduleIcons` likewise.
- `modules`: bundled module ids and the built-in pane ids (`conference`, `chat`). Applied once. A bundled module listed is installed, enabled and on in every space (`allRooms: true`); a built-in pane listed is on, and a switchable built-in pane not listed is switched off. Order does not matter; a module's `requires` are added as well (Maps needs Places).
- `settings`: values for a fixed list of environment settings a template may set (language, clock, currency, `loginText`, `allowRegistration`, `mfaRequired`, the call features, the active built-in theme and its mode), each passed through `store.updateSettings`, so a template can set nothing the owner cannot. Applied once.
- `lobby`: the Lobby's name and description, stored on the space. Applied once, since the Lobby's name is the owner's to change like any space's.
- `spaceDefaults`: what a new space starts with; `profile` only for now (`roleplaying`, `participants` or `characters`). Kept on the environment and read by `addRoom` for every space made later.

The "Itinerary" name above is a proposal, not decided (see the open questions).

### Server

- **Loading.** `server/templates.js` reads `templates/*.json` at start, validates each (the rules `check-templates.mjs` holds), and refuses to start on an invalid one. `templates.get(id)`, `templates.list()` -> `[{ id, name, description }]`.
- **Recording.** The environment's own data keeps `template: { id, appliedAt, skipped: [{ id, why }] }` in `app.json` (so an export and a restore carry it). A hosted environment's registry entry keeps `template: id` too, for the console. An environment made before this plan has no `template` and behaves exactly as today.
- **Applying once.** In `environmentFor()`, after `buildEnvironment`, an environment with a template id and no `appliedAt` has it applied: settings, the Lobby, the space defaults, then the modules (install the bundled ones as `autoInstallBundled` does, enable, `allRooms: true`; switch built-in panes), then `appliedAt` is recorded. It runs before `autoInstallBundled`, and never twice. A module that fails to install is recorded in `skipped` with its reason, as a plan refusal is.
- **Entitlement.** A module the plan's `modules` list does not include is not installed and is recorded as `skipped: [{ id, why: 'not in the plan' }]`. The template never widens a plan.
- **Live words and icons.** `branding()` gains `words` (every key, resolved: owner, template, default) and the resolved `homeIcon`. For an environment made from a template, `settings.homeIcon` starts unset, meaning "the template's"; an owner's choice sets it. An environment with no template keeps its stored `homeIcon` as it is.
- **The owner's changes.** `PUT /api/settings` takes `words: { <key>: { one, many, a? } | null }` (null returns that key to the template's or the default) and `homeIcon: null`. Module display names and icons are set per module (`PATCH /api/modules/:id` gains `displayName` and `displayIcon`, null to clear).
- **Creating.** `POST /api/host/tenants` and `POST /api/product/signup` take an optional `template` (an id; an unknown one answers 400 "There is no template called <id>."). `GET /api/host/templates` and `GET /api/product`'s new `templates` list them. `GET /api/host/tenants` shows each environment's template and its `skipped` list. `GET /api/environment` gains `template: { name, skipped }` for the owner's Environment panel.
- **`TEMPLATE=`.** Without `BASE_DOMAIN`: the id is checked at start (an unknown id refuses to start, with the list of known ones). On a data directory with no `app.json` yet, the template is recorded and applied as above. On an existing data directory with no template recorded, its words and icons apply live, but nothing is applied once. On one with a different template recorded, the recorded one wins and the log says so once. With `BASE_DOMAIN` set, `TEMPLATE` is ignored and the log says so; templates come from the console and sign-up.
- **Server messages** that name a key word ("no such space", "you need to be in the space yourself to pull someone aside") are built from the resolved words, through one helper.
- **The call's base name** (`settings.room`) stops being sent by `branding()` and is kept as it is (see the open questions).

### Pages

- **One helper.** `public/brand.js` gains `word(key, { many, cap, a })`, filled from `/api/branding`'s `words`, and a `data-word="space"` attribute (with `data-word-form="many"`, `"cap"`, `"a"`) that `loadBranding()` fills the way it fills `data-brand`. Every hard-coded key word in the pages becomes one or the other; the Spaces link's label becomes `word('space', { many: true, cap: true })`.
- **Nothing reads a template id.** No page branches on which template an environment has; pages only read words.
- **Manage.** The Server tab gains a **Words** group: each key with its one and many, blank for the template's or the default word, and a note naming the template the environment was made from ("Made from the Travel template"). The Modules tab gains a display name and icon on each module's card. The Environment panel lists what was skipped ("Not in your plan: Maps").
- **The host console.** The create form gains a **Template** choice (None, then each template's name and description). The environment list shows each one's template and what was skipped.
- **The product page's sign-up form** gains the same choice when the host has any templates.

### SDK

- `host.locale` gains `words`: the same resolved object the pages get, `{ space: { one, many, a }, ... }`, and `host.util.word(key, { many, cap, a })` applies it, so a module never copies the capitals and plural rules.
- `host.info.module.name` is the module's display name in this environment.
- No template id, template name or environment identity reaches a module. A module written against `host.locale.words` works under any template and none.

## Chat and Conference as switchable modules: a dependency

The travel template lists `chat` and leaves out `conference`. Stage 1 of plan-optional-conference already switches the Conference off for the environment (`conferenceEnabled`), so a template that leaves it out works as soon as phase 3 below is built. Chat has no switch. Until it has one, listing `chat` changes nothing (it is always on), and a template that left it out could not turn it off.

Recommended: making Chat switchable, and turning either pane on and off per space rather than only for the environment, belongs to plan-optional-conference as a stage of its own, not to this plan. That plan already owns the built-in panes, their Modules-tab cards and the risks of taking chat off its transport. This plan needs only what exists: the `modules` list naming built-in panes, and a pane without a switch staying on.

## Left to build, in order

1. **Rooms and tables out of what people read** (server-development and experience-design). Every sentence listed under "What it is today" says space, the call, or the Lobby instead; `tableName` goes from the settings, `branding()` and `brand.js`, and `room.js`'s `tableName` variable becomes the space's name; the Lobby's seeded description stops mentioning the table (existing stored descriptions are left as their owners have them); `branding()` stops sending `room`. Code identifiers, routes, API fields and stored keys keep `room` (see the open questions). This is independent of templates and can go first. Done when `tools/check-words.mjs` (below) finds no "room" or "table" in anything a person reads, and every page reads right on a local server.
2. **The words** (both). The keys and their defaults in one server module; `branding()`'s `words`; `word()` and `data-word` in the pages; the ~110 "space" strings and the other key words converted; server messages through the helper; `host.locale.words` and `host.util.word` in the SDK; `settings.words` and the Words group on Manage. Done when an environment with no template reads exactly as after step 1 (checked word by word by the tool), and an owner's word for `space` shows on every page and in a module that uses `host.util.word`.
3. **Templates** (server-development first, then experience-design). `server/templates.js`, `tools/check-templates.mjs`, the record in `app.json` and the registry, the apply-once step in `environmentFor()`, entitlement skips, live icons and module display names, `TEMPLATE=`, the create and sign-up fields, the console, Manage's note and skipped list, `templates/travel.json`. Done when a travel environment made on the console reads "trip" everywhere, has the six modules on in every space and in a new one, shows what its plan skipped, and an owner can change each word, icon and module name back.
4. **Chat as a switch** (plan-optional-conference's stage, not this plan's). The travel template needs nothing more from it until a template leaves Chat out.

The documentation (a user guide section on templates for owners, the host operator's `TEMPLATE` and console notes, the SDK's `host.locale.words`) is content-manager's, after each step lands.

## Verify

- **Step 1.** `tools/check-words.mjs`: every string a person reads in `public/*.html`, `public/*.js`, `public/sdk/*.js` and the server's messages, scanned for "room", "rooms", "table" as words, with an allow-list for code identifiers, ids, routes, and the call service's internal names (the `return-to-table` data topic stays internal). Then each page loaded on a local server (checked live for the pages; the call page's status lines, recall, asides and the "pulled back" messages need a real call and are read as code only, since there is no LiveKit locally).
- **Step 2.** The same tool also fails on a key word typed into a page's text instead of `word()` or `data-word`, and checks every key used by the pages exists with its forms. A local server with no template: the pages compared with step 1. With an owner's word for `space`: every page and one bundled module showing it (checked live). A call-only message is read as code only.
- **Step 3.** `tools/check-templates.mjs`: each file's fields and types, known keys only, module ids that are bundled or built in, Free Font Awesome icon names, allowed settings only, and the apply step run twice against a throwaway store giving the same result, with a plan that excludes one module recording it as skipped. Live, on `BASE_DOMAIN=localhost` with a throwaway `DATA_DIR` under `/tmp`: create a travel environment on the console with a plan that leaves Maps out, sign in, check the words, the modules in the Lobby and in a new space, the Environment panel's skipped list, and an owner's changes; sign up from the product page with the template. Without `BASE_DOMAIN`: `TEMPLATE=travel` on a fresh `DATA_DIR`, then unset on the same directory (words fall back to the default, nothing else changes), and an unknown id refusing to start. With the Conference left out, joining a space shows no call; a real call with it on can't be checked without LiveKit.
- `npm run check` runs both new tools.

## Open questions

1. **Keeping `room` in the code.** Thomas said "spaces" is the internal word. Recommended: the vocabulary's key is `space`, and new code and new fields say space; existing identifiers, routes (`/rooms/:id`), API fields (`roomId`, `scope: 'room'`) and stored keys keep `room`, as CLAUDE.md requires, since renaming them breaks stored data, links and every module. A rename is a separate plan with a migration, if ever. Does that match what you meant?
2. **The call's base name, `settings.room` ("table").** It is not a word people read; it names every call on the call service, and the Studio and old OBS links reach the Lobby's call by it. Recommended: keep the value, stop sending it to pages, and leave the stored key's name for the rename plan in question 1. Renaming the value to something else moves every call and breaks those links.
3. **Planner's display name under the travel template.** It can't be "Trip". Proposed: **Itinerary**. Or "Plan"?
4. **The travel template's other defaults.** Recommended: the Lobby named "Home base" (its description "Everyone on every trip"); new trips start with the Participants profile (no character pictures); the home icon `suitcase-rolling`; the Conference off, since it is not in the list. Confirm the Conference is meant to be off.
5. **Chat and Conference switching.** Recommended: a stage in plan-optional-conference, not a phase here (see the dependency above).
6. **`TEMPLATE` on a hosted server.** Recommended: ignored, with a log line. It could instead preselect the console's choice.
7. **Words owners change.** Recommended: every key is the owner's to change (decision 3). Should any stay fixed, such as `owner`?
