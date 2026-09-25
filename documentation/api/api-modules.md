# Modules API

**Audience:** someone scripting the installation and management of Coffee Pub Magpie modules, or
building a tool that talks to a running module.

The install and management routes below are owner-only: a request without an owner session gets 401 or 403. The runtime routes at the end are for a running module. For how modules
work and what an owner sees, read [userguide-modules](../userguides/userguide-modules.md). Errors come
back as `{ "error": "message" }` with a 4xx status.

## Module manifest

A module zip holds a `module.json` at its root (or inside one wrapping folder). Writing one is covered in [api-module-sdk](api-module-sdk.md).

```json
{
  "id": "calendar",
  "name": "Calendar",
  "version": "1.0.0",
  "description": "Optional, up to 200 characters.",
  "author": "Optional, up to 60 characters.",
  "icon": "calendar-days",
  "scope": ["environment", "space"],
  "surfaces": {
    "page": { "entry": "page.html" },
    "canvas": { "entry": "canvas.html", "width": 420, "height": 520 },
    "widget": { "entry": "widget.html", "title": "Coming up", "size": "medium", "order": 10 }
  },
  "permissions": [
    { "key": "view", "label": "See the calendar", "default": { "member": true, "guest": true, "moderator": true } }
  ],
  "hooks": { "schedule": true, "notify": true },
  "refs": {
    "produces": [{ "kind": "event", "key": "event:{id}", "summary": { "title": "title", "when": "start" } }],
    "consumes": ["polls:poll"]
  }
}
```

- `id` is 2 to 32 lowercase letters, digits or dashes, starting with a letter. `name` is required, up
  to 40 characters. `version` is `x.y.z`.
- `scope` includes `environment`, `space`, `person` or several. `person` is the signed-in person's own private data, kept for them alone and reachable from any page of theirs (`?scope=person` on the data routes); not even an owner can read it, because the place it is kept is named by who is asking, and a guest has none. It needs no surface of its own. An `environment` module needs `surfaces.page`, and a `space`
  module needs `surfaces.canvas` (`{ entry, width, height, mode }`; it was `surfaces.panel`). Each `entry` must be an `.html` file that exists in the zip. `surfaces.page.nav` (default true) puts the module's own icon in the main nav's icon row, next to Profile and Sign out, so its page is reachable from anywhere; a module better reached another way (a space's own module, a widget's own heading, a link from what it is about) sets it `false` to leave the row uncluttered.
- `permissions` holds up to 20 entries with unique keys matching `^[a-z][a-z0-9_]{0,23}$`; any other key
  refuses the install ("permission key ... must be lowercase letters, digits or underscores"). `default` says
  which of `member`, `moderator` and `guest` have the permission before an owner changes it (the old key `user` is refused). A
  permission may carry `replaces`, the key it had in an earlier version: each role's choice for that key is
  carried over once, at start and after any install; it is refused if it names a key the module still uses, or
  one another permission already replaces (`module.json: permission "<second>" replaces "<old>", which
  permission "<first>" already replaces`). Owners always have every permission. `tools/check-modules.mjs` checks the bundled
  modules' manifests against this.
- `hooks` names what the module may ask Magpie to do for it: `schedule` and `notify`.
- `refs.produces` lists up to 10 kinds of object other modules may point at: a `kind` (lowercase letters, digits, dashes), an optional display `name` (`{name}` in it is the module's shown name), optional `open` and `backlinks` flags (the module can show one of its objects when asked, and shows what links to them), a `key` that is a fixed prefix then `{id}` (`"event:{id}"`), and a `summary` mapping the summary fields `title` (required), `subtitle`, `when`, `end`, `allDay`, `done`, `category` and `place` to top-level stored field names. `place` is an object `{ lat, lng, name? }` (latitude -90 to 90, longitude -180 to 180, a name up to 120 characters); a summary whose stored value is anything else has no place. `category` is a short label (letters, digits and dashes, up to 20) a module may give its objects so others can group or colour them; it is lower-cased, and anything else is left out. `refs.consumes` lists up to 20 kinds of other modules' objects as `"module:kind"`, or `"*"` for whatever other modules share; an owner approves them, and a module cannot consume its own kinds.
- `events.publishes` lists up to 10 events the module says (`name`, an optional `kind` of its refs the event concerns, a `label`, and an optional `data` mapping up to six fields the event carries to types, as an action's input does); `events.subscribes` lists up to 20 events it wants to hear, as `"*"` or `"module:name"`, approved by an owner.
- `actions.provides` lists up to 10 actions the module carries out: a `name`, a `label`, an optional `local: true` (a view, such as showing something on a map: only the requesting person's own open page of the module carries it out, and it needs only read access, not the right to change things) and an `input` mapping up to 10 fields to `string`, `text`, `date`, `datetime`, `boolean`, `number` or `ref` (a trailing `?` for optional); a field's type may also be `ref:module:kind`, a pointer to one kind of object, which Magpie enforces; `actions.uses` lists up to 20 it wants to ask for, as `"*"` or `"module:name"`, approved by an owner.
- `requires` lists up to 5 module ids this module cannot work without: it cannot be turned on until they are installed and on, and turning one of them off asks first and turns this one off with it (`PATCH` with `force: true`). It is the only place a manifest names another module; at run time modules still reach each other only through the generic conduits. The module view carries `missing` (what it needs that is not on) and `dependents` (the enabled modules that need it).
- A module that declares the `ai` hook depends on the AI service the same way: it cannot be turned on while the AI service is off, and the module view's `missing` carries the reserved id `'ai'` for that ("the AI service" in a message) alongside any `requires`. Turning the AI service off (`PUT /api/ai`) while an enabled module depends on it asks first the same way (`force: true` turns those modules off with it), and `GET /api/ai` carries `dependents` (the enabled modules that need it), for the same "X needs this; turn it off too?" confirmation. `ai` cannot be used as a module's own id.
- `geocoder` (optional) has the server answer this module's place searches: `{ provider, address, save?, custom, providers }` where `provider` is the key of a `choice` setting, `address` the key of a `url` setting used when the provider is the `custom` value, `save` the key of a `boolean` setting that says whether results are kept (only an explicit true keeps them; without one nothing is kept), and `providers` maps a provider's value to `{ name, address (https), credit }`. The server searches its saved places first and asks the chosen service only when fewer than five match. Modules never hold the address's credentials; see `host.geocode` in [api-module-sdk](api-module-sdk.md).
- `hooks` may include `ai`: the module may ask the server's AI (see `host.ai` in [api-module-sdk](api-module-sdk.md)). An owner sets up one AI service for the whole server (Modules tab: none, OpenAI, Anthropic, or another OpenAI-compatible service whose address is typed; Magpie knows the first two's addresses and the model is chosen from the service's own list; a key that is kept on the server and never shown again, an explicit **enable** step (nothing is sent until the owner enables it; choosing another service switches it off again), and an optional monthly token limit; or the `AI_KEY` environment variable for the key), and the Roles tab has **Use AI in modules**, off for every role until turned on (a guest never can; a space can turn AI off for itself). A produced kind's `summary` may map `text` to a stored field: the object's own words (plain, up to 8 KB), which the server reads only for the AI hook, as the person asking.
- `regionSource` (optional) lets the server cut a region out of a larger PMTiles file straight into one of the module's own file folders: `{ folder, address }` where `folder` names a `files`-type setting's own folder and `address` the key of a `url` setting naming the file to cut from. Owners only, over `GET /api/modules/:id/region-cut/find?q=` (a place's name to its rough rectangle, asked of whichever enabled module has a place search configured — see `geocoder` above; not this module itself, so it works without one), `POST /api/modules/:id/region-cut/estimate` (`{ minLon, minLat, maxLon, maxLat, maxZoom, minZoom? }`; a dry run: the tile count and the estimated size, without downloading anything) and `POST /api/modules/:id/region-cut` (the same body plus `name`, starting a background job; `GET .../region-cut/:jobId/stream` follows it as server-sent events, `progress`/`done`/`error`). Only one cut runs at a time per module; a cut estimated over a size ceiling is refused before anything is fetched; a failed cut leaves nothing behind. Maps is the first to offer this, cutting from the Protomaps world build into its `map-tiles` folder; see documentation/plans/plan-map-region-download.md.
- `uploads` (optional) lets the module keep pictures its people add, per scope (environment, space, person) with the same read and write permissions as its data: `{ types, maxBytes, maxFiles }` where `types` is any of `image/jpeg`, `image/png` and `image/webp` (all by default), `maxBytes` at most 10 MB (the default) and `maxFiles` at most 5000 per scope (500 by default). The server checks each file from its own bytes (a file that is not a whole picture of an allowed type is refused, whatever it says it is) and takes out what rides along: text, comments, thumbnails, maker notes, editing history and, unless the person keeps it, the position. Files are served with their picture type only, never as a page. See `host.uploads` in [api-module-sdk](api-module-sdk.md).
- `settings` lists up to 40 settings the module offers people, each `{ key, label, help?, type, scope, default, ... }` (`help`, like a choice option's own below, up to 600 characters with line breaks kept): `type` is `note` (no control and no value: a `label` and a `help`, drawn among the settings for the module to say where something is set up, such as Maps saying its search is the place-search module's; its scope is `environment`, or left out), `boolean`, `choice` (with `options: [{ value, label }]`, two to twelve), `number` (`min`, `max`), `color` (a `#rrggbb` string; the form draws a colour picker) or `text` (`maxLength`, up to 200), `url` (empty, or an http or https address up to 500 characters, never with a user name or password; optional `httpsOnly: true` and `pathEnds: ".pmtiles"` narrow it) or `list` (rows of label, icon and colour that an owner adds, edits, reorders and removes: `default` is the starting rows, `fixed` the ids of rows that cannot be removed, `maxLength` the longest label, at most 30; the value is up to 20 rows `{ id, label, icon, color }` where a new row's empty `id` is made from its label and `color` is `#rrggbb`) or `files` (the same, as a table of every file there with a tick for each: the setting is the list of names ticked, up to 20; with `"shared": "host"` the folder is the host's, one for every environment (`DATA_DIR/shared/<module id>/<folder>/` on a host with environments, the module's own folder otherwise), the environment sees the host's files read-only and the value is every file there, and only a host admin adds, deletes or cuts into it) or `file` (the name of a file an owner placed for the module, see below; environment scope only; `folder`: where the files go inside modules/<id>/, lowercase letters, digits and dashes, default `files`, never `versions`); a setting may carry `showWhen: { key, value }` (the form shows it only while that other setting has that value) or `showWhen: { key, not }` (only while it has any other value); a `choice` option may carry its own `help` (up to 600 characters, line breaks kept) and the choice a `defaultIfSet: { key, value }` (it starts as that option when the other setting already holds a value and it holds none of its own, for a setting that grew into a choice); `scope` says who chooses it: `environment` (an owner, for everyone), `space` (an owner or a space's moderators, for that space) or `person` (each person for themselves). A setting holds plain data, never a secret. Magpie draws the forms and keeps the values; the module reads them (see [api-module-sdk](api-module-sdk.md)).
- `access` names which of the module's own permissions guards reading and writing its data, for example `{ "read": "view", "write": "edit" }`. `surfaces.canvas.mode` lists `float`, `dock` or both. `surfaces.canvas.lobby` (optional, `true` or `false`) says the module belongs on the Lobby's canvas; absent or false keeps it out of the Lobby (see "The Lobby" below). It asks for no approval, since it only narrows where a module can be; anything but a boolean refuses the install ("module.json: surfaces.canvas.lobby must be true or false"). `surfaces.widget` (needs the `environment` scope) is a small view for the dashboard on the spaces page: an `entry`, a `title` (up to 40 characters, the module's name if omitted), a `size` of `small`, `medium`, `wide` or `tall` (`tall` for a widget with a grid, such as a month), and an `order` number (lower comes first, default 100).
- `surfaces.keyed` is a **keyed page**: `{ "path": "view", "entry": "view.html" }`, a page of the module about one person, opened at `/<path>/<key>?s=<access key>` with the server's access key in place of a sign-in, for something unattended such as a browser source in a streaming program. `path` is 2 to 20 lowercase letters, digits and dashes and cannot be a path the server serves itself; one enabled module per path (turning on a second that claims the same path fails, naming the first). The entry is built from `src/<id>-keyed.*` (like a widget's from `src/<id>-widget.*`), and it always runs in the page, never in a frame, since the host draws media into it. A keyed page's viewer is nobody: `user.role` is `viewer`, every permission is false, and it can only read (`context`, its settings) plus what the SDK offers a page that follows people (`host.presence`, `host.images`, `host.media`; see [api-module-sdk](api-module-sdk.md)). With the module off, the path answers 404 with a sentence naming the module. `GET /api/status` lists the keyed paths currently served in `pages`.
- `install` (optional, bundled modules only): `{ "auto": true, "settingsFrom": "environment" }`. `auto` has the server install and turn the module on by itself, once per environment, on the first start that carries it and has never done so there (the module registry remembers, so an owner who uninstalls it is respected). `settingsFrom: "environment"` copies, on that one install, each declared environment-scope setting whose key the environment's own settings hold, so a setting that moved out of the core into the module keeps the value the owner chose.
- Anything else in the manifest is ignored.

## Routes

| Call | Purpose |
|---|---|
| `GET /api/modules` | `{ modules, limits }`: installed modules, their state, versions, and what awaits approval |
| `POST /api/modules` | Body is the zip, sent as `application/zip`. Returns 201 and `{ module }`, disabled until approved |
| `PATCH /api/modules/:id` | `{ enabled }`, `{ allSpaces }`, `{ spaces: [space ids] }`, or `{ displayName, displayIcon }` (either may be `null` or `""` to go back to the module's own); returns `{ module }`. A refused change changes nothing |
| `POST /api/modules/:id/rollback` | `{ version }`; returns `{ module }` |
| `DELETE /api/modules/:id?keepData=0` or `=1` | Uninstall; `keepData` defaults to keeping the data |

A module in the list has the manifest fields plus:

| Field | Meaning |
|---|---|
| `enabled` | Whether it is on |
| `name`, `icon` | The module's own, from its manifest |
| `displayName`, `displayIcon` | What this environment shows it as: the owner's choice, else the template's (a later step), else the module's own |
| `ownDisplayName`, `ownDisplayIcon` | The owner's stored choice, even when it can't be drawn now (an icon no longer in the environment's set) |
| `allSpaces`, `spaces` | Where a space module is available. `allSpaces` means every space the module may be in: the Lobby only when `lobby` is true |
| `lobby` | Whether the active version declares `surfaces.canvas.lobby`, so it may be on in the Lobby |
| `outdated`, `outdatedWhy`, `outdatedVersions` | Set when the installed manifest uses an old name, so the module can't run: `outdated` is "This module was built for an older Magpie and needs an update from its author.", `outdatedWhy` the sentence naming the old name, `outdatedVersions` the installed versions that use one |
| `needsUpdate` | The modules this one requires that are outdated, so this one can't run either. A module runs only while everything it requires is running, at any depth; `enabled` keeps the owner's choice, so it comes back by itself, and `missing` and `needsUpdate` say why it isn't running |
| `versions` | Installed versions, newest first |
| `needsApproval`, `pending` | Whether the active version asks for permissions, hooks, refs to consume, events to hear or actions to ask for that are not yet approved, and which |
| `installedAt`, `updatedAt` | Timestamps |

## Behavior to rely on

- An upload must be newer than every installed version of that `id`; otherwise it is refused with 400.
- Enabling a module records that the owner approved the permissions and hooks it lists. An upgrade or
  rollback that asks for anything not yet approved comes back with `enabled: false`.
- `allSpaces` and `spaces` are refused unless the module has a space scope.
- **The Lobby.** The Lobby (space id `lobby`) holds chat, the conference while the environment has it on, and
  modules whose active version declares `surfaces.canvas.lobby: true`; nothing else is ever on there. `PATCH` with
  `spaces` including `lobby` for any other module answers 400 "`<Module>` can't be turned on in `<Lobby>`, which is
  kept for chat, the call and a few modules made for it.", `<Module>` being the display name and `<Lobby>` the
  Lobby's own name. `GET /api/modules/for-space?space=lobby` never lists such a module, and loading it there
  (`/modules/<id>?space=lobby`, or its settings for the Lobby) answers 404 with the same sentence. Every
  environment build, and a rollback, takes `lobby` out of the `spaces` of any module whose active version doesn't
  declare the field, and logs "`<Module>` is no longer on in `<Lobby>`; it stays on in its other spaces." Its data
  for the Lobby is kept, untouched, and read nowhere.
- **Display names and icons.** An owner may show a module under another name and icon (`PATCH` above; the
  built-in Conference and Chat too). Refusals (400): "A display name is plain text, without < or >.", "A display
  name can be at most 40 characters.", "A display name can't hold control or text-direction characters.", "There
  is no icon called `<id>` in this environment's icons.", "The icon `<id>` is not a solid Font Awesome icon, so it
  can't be a module's icon.", and for a built-in, "`<name>` is built in, so only its display name and icon can be
  changed here." A module's own icon is always allowed. The display name and icon are what every page, sentence
  and notification shows; `GET /api/modules/for-space` gives the built-ins as `builtin: [{ id, name, icon }]`, and
  `GET /api/notifications` items carry `moduleName` and `icon`. Uninstalling with the data deleted clears them; a
  plain uninstall keeps them.
- **Objects.** The routes above were `/api/refs/...` and answered cards until step 7 of the Names plan; the old
  paths answer 404. A manifest's `refs.produces[].card` is refused ("module.json: refs kind "<kind>" uses the old
  card; use summary (Magpie renamed an object's card to its summary).").
- **`storage.renamed`** (optional): `[{ from, to }]`, up to 10 key prefixes (1 to 64 letters, digits and
  `. _ : / -`). The server moves keys starting with `from` to `to`. A rename is in effect for every version from the one that introduced it onward, even if later versions stop listing it. While it is in effect, keys still under the old prefix are moved on every start, install, update and rollback; switching to a version older than the one that introduced it moves the keys back (the newest rename first) and drops the record. The registry records each as `renamed: [{ from, to, version, at, kept }]`. A key whose new name is already taken is never overwritten: both are kept (`kept`). The log and the activity list note only keys actually moved and new conflicts. Entries that repeat a `from`, overlap, or would move keys back are refused.
- **Words in the manifest.** The text people read (`description`, the widget's `title`, permission labels,
  setting labels, `help` and options, event and action labels, and kind names) may use the environment's word
  placeholders, `{space}`, `{spaces}`, `{Space}`, `{a space}` and the like for each changeable word, and is
  shown in the environment's own words. `tools/check-names.mjs --words` reads bundled manifests.
- **Old names are refused.** A manifest using an old name is refused at upload with 400 and one sentence naming
  the new word: a module `scope` of `server` or `room`, a setting's scope, `install.settingsFrom: "server"`, a
  permission default keyed `user`, or `surfaces.panel`. For example: `module.json uses the old scope "room"; use
  "space" (Magpie renamed rooms to spaces).`, or `module.json uses the old surfaces.panel; use surfaces.canvas
  (Magpie renamed a module's panel to its place on the canvas).` A module already installed with such a manifest stays installed but can't run:
  turning it on, or rolling back to such a version, answers 409, and a module that requires it doesn't run either
  (409 "`<Name>` needs `<Req>`, which needs an update from its author.").
- The upload limits are 10 MB for the zip, 500 files, 10 MB for any one file and 40 MB unpacked. A zip
  over the limit gets 413.

## Runtime routes

These routes, the SDK and the manifest all use the names of the [Names plan](../plans/plan-names.md): `environment`, `space` and `spaceId` (before steps 5a and 5c, `server`, `room` and `roomId`).

These serve a running module. The page hosting a module's frame calls them for it (see [api-module-sdk](api-module-sdk.md)); they need a signed-in session, or for a space a guest link token in `guest=`. Data routes take `scope=environment` (the default, when no scope is given), `scope=space&space=<id>`, `scope=person`, or, where a route reads across the caller's spaces, `scope=spaces`. The old values `server` and `room` and the `room=` parameter are refused (400 "scope must be environment, space, spaces or person"; a route that takes one place answers "scope must be environment, space or person here", and the bus "scope must be environment or space here"). A module must be enabled, and for a space it must be on for that space and the caller in it. The module's `access` permissions decide who may read and write.

| Call | Purpose |
|---|---|
| `POST /api/modules/:id/ai` | Body `{ task, question?, objects? }` (`task` `summarise`, `ask` or `tags`; `objects` up to 12 pointers; the old `items` is refused). Returns `{ text, summaries, tags, used, tokens }`, with `{{summary:N}}` markers in `text`; see `host.ai` in [api-module-sdk](api-module-sdk.md) |
| `GET /m/:id/:version/*path` | A file of the active version of an enabled module, with a sandbox content security policy. HTML pages get the SDK and base styles injected |
| `GET /api/modules/nav` | Modules with a page this person can open, for the header |
| `GET /api/modules/widgets` | Modules with a dashboard widget this person may read, in order: `{ widgets: [{ id, name, icon, version, scope, runMode, title, size, order, entry }] }`. Guests get none |
| `GET /api/modules/for-space?space=<id>` | Modules with a canvas surface in that space this person can see, each with `canvas` (it was `panel`) |
| `GET /api/modules/:id/settings/values?scope=&space=` | The settings as they apply to the caller here: `{ values }`, with the module's default for what nobody has chosen (the environment, this space and the person's own together) |
| `GET /api/module-settings/:scope?space=` | The modules that have settings of a scope (`environment`: an owner; `space`: an owner or that space's moderators, with `space=`; `person`: anyone signed in) with each setting and its value, for the forms. Anyone else, reading or changing them, gets 403 "only an owner changes the environment's settings" or "only an owner or the space's moderators change its settings". The old scopes `server` and `room` answer 404 "no such kind of setting" |
| `GET /api/modules/:id/files/:name?scope=&space=` (a `file` setting in the settings routes also carries `available`, the usable names, `folder`, `exists` and `skipped: [{ name, reason }]` for what the folder holds that was ignored; the server logs the same at startup) | A file the operator placed in `DATA_DIR/modules/<module id>/<folder>/` (the `folder` the module's `file` setting names), read by range (`Range` requests answer `206`), for anyone who may read the module's data in that place. Only files in that folder, by a plain name (letters, digits, dot, dash, underscore), are reachable; `Cache-Control: private` |
| `DELETE /api/modules/:id/files/:name` | Owners only. Removes the file for good, and un-ticks it from any `files` setting (or clears a `file` setting) that named it, so nothing keeps pointing at a file that is gone |
| `PUT /api/modules/:id/settings/:scope` | Body `{ values, space? }`; the same people as above. Only settings the module declares for that scope are taken, each checked against its type and limits (400 otherwise). Environment and space changes are noted in the activity list |
| `GET /api/modules/:id/context` | Who is asking and their permissions in the module |
| `GET /api/modules/:id/data?prefix=` | `{ items }`, each `{ key, value, version, updatedAt, by }` |
| `GET /api/modules/:id/data/:key` | `{ item }`, or 404 |
| `PUT /api/modules/:id/data/:key` | Body `{ value, version? }`; returns `{ item }`, or 409 with `{ error, current }` if `version` is stale |
| `DELETE /api/modules/:id/data/:key?version=` | Delete a key |
| `POST /api/objects/resolve` | Body `{ from, refs: [{ module, kind, id, scope, space? }] }` (`scope` is `environment`, `space` or `person`) (`from` is the asking module, up to 50 refs). Returns `{ summaries }` in the same order: a summary, or `{ ref, error, status, state? }` for each that is missing, invalid or not allowed; `state` says what to draw: `gone` (the object no longer exists) or `hidden` (it exists, or may, but this viewer may not see it, which is all the viewer is told) |
| `POST /api/bus/publish` | Body `{ module, name, ref?, data?, scope, space? }`: the module says one of its declared events happened. Needs write access to the module; `ref` must be one of its own objects in the same place; `data` at most 2 KB |
| `GET /api/bus/events?module=&scope=&space=&after=` | The events the module may hear (declared and approved) after event `after`, about modules the person can see here, at most 100; `after=now` returns just where things stand |
| `GET /api/bus/actions?from=&scope=&space=&accepts=&self=1` | The actions the asking module may request, only those the person could do themselves. `accepts=module:kind` keeps those that take a pointer to that kind of object; `self=1` adds the asking module's own, marked `own` |
| `POST /api/bus/actions/request` | Body `{ from, action: "module:name", input, scope, space? }`; the input is checked against the action's declared types. Returns `{ id, status }` |
| `GET /api/bus/actions/pending`, `POST /api/bus/actions/claim`, `POST /api/bus/actions/complete`, `GET /api/bus/actions/status` | The providing module's page takes a waiting request (one page only), reports the result; the asking module reads the status. Need write access to the providing module |
| `GET /api/objects/kinds?from=` | The kinds of other modules' items the asking module may link to: `{ kinds: [{ module, moduleName, icon, kind, name, open, events: [{ name, label, data }] }] }`, where `events` is what that kind of item can report. A module installed later appears here with no change to anything else |
| `POST /api/objects/links` | Body `{ module, from, to: [refs] }`: the asking module says what one of its own objects points at (the whole list). Targets the viewer cannot see, or the module may not link to, are left out. Needs write access to the module |
| `GET /api/objects/links?from=&ref=&dir=to\|from` | What points at (`to`, only for a kind with `backlinks`) or is pointed at by (`from`) one of the asking module's own objects: `{ summaries }`, each only for what the viewer may see |
| `GET /api/objects/search?from=&scope=&space=&q=` | `{ summaries }` for objects `from` may link to in one scope: every kind it was approved to consume, matching `q`, newest `when` first, up to 50 |
| `GET /api/modules/:id/objects/:kind/:objectId?from=&scope=&space=` | One summary, `{ summary }`, or an error |
| `POST /api/modules/bundled/:id/install` | Owners only. Builds one of the modules that ship with this Magpie (a folder under `modules/` next to the server) into a zip and installs it as an upload would be, so it is the same validation, approval and versioning; 404 for anything that is not a bundled module. `GET /api/modules` lists them as `bundled`: `{ id, name, icon, description, version, installed, update }` |
| `GET /api/modules/:id/spaces-data?prefix=` | For a module's environment page: `{ spaces, items }` across the caller's own spaces (a member, module on for the space, role can read it), each entry with its `spaceId`, each space `{ id, name, icon, svg }`. `?info=1` returns just `{ spaces }`. Guests get 403. (Was `rooms-data`, now 404) |
| `GET /api/modules/stream?space=` | One server-sent stream for all modules on a page: `change` and `schedule` events with `module`, `scope` (`space`, `environment` and `person` with a space; `environment`, `person` and `spaces` without) and `spaceId`, filtered to what the caller may read |
| `GET /api/modules/:id/events` | Server-sent events: `change` for data changes and `schedule` when one fires. `?scope=spaces` streams changes from all the caller's spaces, each with a `spaceId` |
| `POST /api/modules/:id/schedule` | `{ key, at, payload?, notify? }`; needs the `schedule` hook |
| `DELETE /api/modules/:id/schedule/:key` | Cancel a schedule |
| `POST /api/modules/:id/notify` | `{ to, title, body }`, `to` being `space`, `environment` or a person's key (otherwise 400 "to must be space, environment or a person's key"); needs the `notify` hook |
| `GET /api/notifications` | The signed-in person's notifications, with unread counts by module |
| `POST /api/notifications/read` | `{ module }` or `{ id }` marks them read |
| `GET /api/notifications/stream` | Server-sent events: `notification` |

Limits: a value is at most about 60 KB, a module's data 5 MB, a schedule payload 4 KB, 500 schedules per module and 50 notifications per person. Rate limits, per module and per person over a minute: 240 saves or deletes, 60 events, 60 asked actions, 60 schedules and 20 notifications. Over a limit a call gets 429 with a `Retry-After` header and the module is told to slow down; the first time in a while it also puts a line in the owner's activity list (`GET /api/modules/activity`, admin only), which is kept across a restart.
