# Module SDK

**Audience:** someone writing a Coffee Pub Tavern module: what a module is made of, what it can ask Tavern to do, and what it is not allowed to.

To install and manage modules as an admin, read [userguide-modules](../userguides/userguide-modules.md). The server routes behind all of this are in [api-modules](api-modules.md), and how it is built is in [architecture-modules](../architecture/architecture-modules.md).

## What a module is

A module is a zip of static files that runs in the browser, inside a sandboxed frame. It never runs code on the server. It reaches Tavern only through the calls in this document, and the server checks every one.

A module has one or two **surfaces**:

- **page**: a full-width page of its own, with an item in the header (server scope).
- **panel**: a pane a room can open from the call's Modules button (room scope). A panel can be **docked** as a column beside the video and the chat, **floating** over the call, or **popped out** into a window of its own; the manifest says which of docked and floating it supports, and every panel can be popped out.

The same HTML file can serve all of them. The SDK tells the module which scope it is in, and the page should adapt to its width: a docked pane is narrow.

## The zip

A zip holds a `module.json` and the HTML pages it names. Everything a page needs should be inline: a module page is best written as one HTML file with its CSS and JavaScript inside it. Allowed file types are html, js, css, json, txt, md, images, svg and fonts; the limits are in [api-modules](api-modules.md).

`tools/build-module.mjs` builds a zip from a source folder: `node tools/build-module.mjs modules/calendar` inlines `src/<id>.css` and `src/<id>.js` into `src/<id>.html`, writes the result as every entry the manifest names, and writes `modules/dist/<id>-<version>.zip`. The Calendar in `modules/calendar/` is the reference module.

## module.json

```json
{
  "id": "calendar",
  "name": "Calendar",
  "version": "1.2.0",
  "icon": "calendar-days",
  "description": "Sessions and events, with reminders.",
  "scope": ["server", "room"],
  "surfaces": {
    "page": { "entry": "page.html" },
    "panel": { "entry": "panel.html", "width": 400, "height": 580, "mode": ["dock", "float"] }
  },
  "permissions": [
    { "key": "view", "label": "See the calendar", "default": { "user": true, "guest": true, "moderator": true } },
    { "key": "edit", "label": "Add and change events", "default": { "user": true, "guest": false, "moderator": true } }
  ],
  "access": { "read": "view", "write": "edit" },
  "hooks": { "schedule": true, "notify": true }
}
```

- `scope` says where the module can run. A `server` module needs a `page` surface and a `room` module needs a `panel`.
- `icon` is the name of a Font Awesome icon, used in the header and the Modules menu.
- `panel.mode` lists how a panel may be shown: `dock` (a column of the room beside the video and chat), `float` (a panel over the call), or both. Leave it out and both are allowed. A room opens a module docked when it can, and people can switch between them. A pane keeps the width you drag it to. `width` and `height` are the starting size.
- `permissions` are the module's own permissions. Each appears on the Roles tab as `Module: <name>`, with the `default` you give per role. Admins can always do everything.
- `access` names which of those permissions guards reading and writing the module's data. Leave it out and any signed-in person who can see the module can read and write.
- `hooks` names what the module may ask Tavern to do: `schedule` and `notify`. The admin approves them when enabling the module.
- `refs` lets modules point at each other's items without reaching into each other's data; see [Refs](#refs-pointing-at-another-modules-items). `refs.produces` lists the kinds of item this module lets others point at, and `refs.consumes` the other modules' kinds it wants to point at, which the admin approves when enabling the module.

## Pages and the SDK

Tavern adds the SDK and a base stylesheet to each of your HTML pages when it serves them, so a page needs no `<script>` or `<link>` for them. To keep the base styles out, add `<meta name="tavern-base" content="none">`. The SDK defines `window.tavern`.

```js
const t = await tavern.ready();
// t.user      { key, name, role }
// t.context   { scope: 'server' | 'room', roomId }
// t.permissions  { view: true, edit: false }   the module's own permissions, by short key
// t.theme     the current theme tokens
tavern.can('edit');   // true or false, from the permissions above
```

Every call returns a promise. Do not call anything before `ready()` resolves.

### Storage

A small key-value store per module, with a scope: the whole **server**, or one **room**. A page uses its own scope (`'context'`, the default). A room panel may also ask for `{ scope: 'server' }` to read server data. A module with both a server page and a room panel may, on its server page, read `{ scope: 'rooms' }`: read-only, across every room the viewer is a member of that has the module on and lets their role read it. Each item comes back with its `roomId`, and `tavern.rooms()` returns those rooms as `[{ id, name, icon, svg }]`, where `svg` is the room's icon as inline SVG (a module cannot load the icon font). Live `change` events from those rooms carry a `roomId` and `scope: 'rooms'`.

```js
await tavern.storage.set('event:123', { title: 'Session' });        // returns { key, value, version, updatedAt, by }
const item = await tavern.storage.get('event:123');                 // an item, or null
const items = await tavern.storage.list('event:');                  // items whose key starts with the prefix
await tavern.storage.delete('event:123');
```

- Keys are 1 to 128 of letters, digits and `. _ : / -`. A value can be any JSON up to about 60 KB. A module may store 5 MB in all.
- Every write bumps the key's `version`. Pass the version you read to detect a change made since: `set(key, value, { version })` rejects with `error.status === 409` and `error.current` (what is stored now) if someone wrote first. Without a version, the last write wins.
- Store each thing under its own key, not everything as one blob, so two people editing different things never collide.

### Live changes

```js
tavern.on('change', (e) => {
  // e = { key, value, version, deleted, by, scope }
});
```

Any change to stored data in the scopes the frame can see is pushed to it, including changes the frame made itself. Read the current state with `list` once at start, then apply `change` events.

### Reminders and notifications (hooks)

These need the `schedule` and `notify` hooks in the manifest.

```js
await tavern.schedule({
  key: 'remind:123',                 // names it; scheduling the same key again replaces it
  at: Date.parse('2026-09-20T19:00:00-07:00'),   // milliseconds or an ISO date
  payload: { id: '123' },            // handed back when it fires (up to 4 KB)
  notify: { title: 'Session tonight', body: 'Starts in an hour' },   // optional
  repeat: { every: 'week', until: Date.parse('2026-12-31'), tz: 'America/Los_Angeles' }, // optional
});
await tavern.cancelSchedule('remind:123');
await tavern.notify({ to: 'room', title: 'Hello', body: 'Sent now' });  // 'room', 'server', or a user key
tavern.on('schedule', ({ key, payload }) => {});   // when one fires, if the module is open
```

- A schedule can be at most a year away, and a time already more than five minutes past is refused. If the server is off when a schedule is due, it fires on the next start unless it is more than six hours late.
- A notification reaches the people it is addressed to who could see the module in that place (the module's `read` permission). It shows as a toast, and as an unread count on the module's header item and the call's Modules button, until they open the module. Notifications are kept for people who are away, up to 50 each.
- `repeat` makes Tavern schedule the next one itself when each fires, so it keeps going while the module is closed. `every` is `day`, `week`, `2weeks`, `month` or `year`; `until` (optional) ends it; `tz` is an IANA time zone name, and the wall-clock time is kept in it across daylight saving changes. A monthly repeat on the 31st goes back to the 31st after a shorter month. Cancelling the key cancels the whole series.
- `notify` in `schedule` defaults to the module's own scope: the room, or the whole server.

### Refs: pointing at another module's items

Modules cannot read each other's storage, and that does not change. Refs are the one narrow door between them: a module stores a **pointer** to another module's item, never a copy, and asks Tavern for a small **card** whenever it draws it.

Tavern names no module in any of this. A module says what it can do in `module.json`, and Tavern is only the conduit; a module written tomorrow takes part by declaring, with no change to Tavern or to the modules around it.

A module that lets others point at its items lists them in `module.json`. Each entry names a `kind`, its `name` (what a person sees it called), the stored key its items live under (a fixed prefix then `{id}`) and which of its stored fields fill the card. Only the fields named here ever leave the module, so a record's other fields stay private. Two optional flags say what else the module can do with its items: `"open": true` (it can show one when asked, see `onOpen`) and `"backlinks": true` (it shows what links to its items, see `linksTo`).

```json
"refs": {
  "produces": [
    { "kind": "event", "key": "event:{id}", "card": { "title": "title", "subtitle": "desc", "when": "start", "end": "end", "allDay": "allDay" } }
  ],
  "consumes": ["*"]
}
```

`consumes` lists the kinds this module wants to point at: named, as `"module:kind"`, or `"*"` for whatever other modules share. `"*"` is what lets a module link to items of modules that did not exist when it was written. The admin approves the list when enabling.

The card fields are `title` (required), `subtitle`, `when`, `end`, `allDay` and `done`. An upgrade that adds to `consumes` waits for the admin's approval, like a new permission or hook.

A pointer is `{ module, kind, id, scope: 'room' | 'server', room? }`.

```js
// Make a pointer to one of your own items, and keep it (with the rest of your data):
const ref = tavern.refs.make('event', 'e1');           // { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: '...' }
//   tavern.refs.make('event', 'e1', { scope: 'server' })   an item in the server's scope, from a room
//   tavern.refs.make('event', 'e1', { room: roomId })      another room's item, from a module's server page

// Later, ask Tavern what to show. One pointer gives a card, a list gives cards in the same order:
const card = await tavern.refs.resolve(ref);
// { ref, kind, module: { id, name, icon }, title, subtitle?, when?, end?, allDay?, done? }
// or { ref, error, status } when the item is gone or the viewer may not see it (404, 403).
const cards = await tavern.refs.resolve([refA, refB]);

// Find items to link to, in this place (or from a room, { scope: 'server' }): every kind this module consumes.
const found = await tavern.refs.search('retreat');     // cards, each with its pointer in card.ref

// What can I link to? Whatever other modules share and Tavern says this module may, so never name modules in your code.
const kinds = await tavern.refs.kinds();               // [{ module, moduleName, icon, kind, name, open }]

// Show an item in the module that owns it. Its pane opens (or its page) and it is handed the pointer.
await tavern.refs.open(card.ref);                      // only useful when card.open is true
tavern.refs.onOpen((ref) => { /* you own ref: show it (select it, scroll to it, open it) */ });

// Tell Tavern what one of your items points at (the whole list, replacing the last), so what is pointed at can ask.
await tavern.refs.setLinks(tavern.refs.make('task', id), [refA, refB]);
// What points at one of your items (kind has "backlinks": true), and what one points at: cards.
const from = await tavern.refs.linksTo(ref);
const to = await tavern.refs.linksFrom(ref);
tavern.on('links', (e) => { /* e.ref: one of your items whose links changed: ask again */ });
```

Tavern answers only what the viewer could already see in the producing module: it must be enabled, the viewer must hold its `read` permission in that scope and be in the room, and the asking module must have been approved for that kind. A pointer is therefore only as revealing as the viewer's own access, and a card is read again each time, so it is always current. Show `Not available` for an error.

**Dragging.** A module can offer its items to be dragged onto another module. The browser's own drag and drop is unreliable between sandboxed frames, so this is driven by the pointer and brokered by Tavern: press an item, move a few pixels, and Tavern shows the item's label at the pointer and tells the module frame under it where the pointer is and, on release, what was dropped. A module offers items with `tavern.refs.draggable(root, resolve)`, where `resolve(target)` says what the pressed element is (`{ kind, id, label, ...options for make() }`, or `null`):

```js
tavern.refs.draggable(document.body, (target) => {
  const row = target.closest('[data-id]');
  return row ? { kind: 'event', id: row.dataset.id, label: row.textContent.trim() } : null;
});
```

The press is followed even when the pointer leaves your frame at once, and the click that would follow the release is swallowed. To see where a drag stops, open Tavern once with `?debug=1` (`?debug=0` turns it off): every step, in the module that starts the drag, in the page and in the module under it, adds a line to a box at the bottom left. `tavern.refs.trace(text)` adds your own. It works with a mouse or pen; on a touch screen, search is the way to link. A module that accepts drops calls `tavern.refs.dropTarget`:

```js
tavern.refs.dropTarget({
  over: (point, ref) => { /* highlight what is at point; ref is the pointer being dragged, or null */ },
  leave: () => { /* clear the highlight */ },
  drop: (ref, point) => { /* link ref to whatever is at point */ },
});
// point is { x, y } in your own page: document.elementFromPoint(point.x, point.y)
```

Treat `ref` as untrusted: check the kind is one you consume, and `resolve` it, which is where Tavern checks what the viewer may see. Tavern brokers a drag between module frames in the same window (the page, or the popped-out app). `tavern.refs.drag(event, ...)`, called from a native `dragstart`, and `tavern.refs.accepts` / `tavern.refs.parse` for a native drop remain for a drag that does not come from a module, but a module offering items should use `draggable`. Search is the way to link without dragging at all.

### The titlebar

A module shown as a pane (docked or floating), or in a window of its own, has a titlebar the host draws with the module's name and the pane's buttons. `tavern.header.set([...])` adds icon buttons of the module's own to it, ahead of the pane's buttons and set off by a pipe: a good place for a filter or a view switch that would otherwise repeat the module's name above its content.

```js
const drawn = await tavern.header.set([
  { id: 'open', icon: 'circle', regular: true, title: 'Open', on: true },   // regular: true for the outline style
  { id: 'done', icon: 'circle-check', title: 'Done' },
]);
tavern.on('header', (e) => { /* e.id is the button clicked */ });
```

Up to six buttons; `icon` is a Font Awesome name, `on` marks the current choice, `title` is the tooltip. It resolves `true` when the host drew them and `false` when there is no titlebar (a module's server page), so keep your own controls in the page in that case, and hide them when it is true.

### Events and actions: reacting to and asking things of other modules

The other two conduits between modules, and like refs they name no module. Declare them in `module.json` and an admin approves what your module hears and asks for.

```json
"events":  { "publishes": [{ "name": "closed", "kind": "poll", "label": "A poll closed" }], "subscribes": ["*"] },
"actions": { "provides": [{ "name": "createTask", "label": "Add a task", "input": { "title": "string", "notes": "text?", "ref": "ref?" } }],
             "uses": ["*"] }
```

**Events.** `tavern.events.publish(name, { ref, data })` says something happened (`ref` an optional pointer to one of your own items, `data` a small plain object under 2 KB). `tavern.events.subscribe(handler)` hears the events your module was approved for (`"*"`, or `"module:name"`), about modules the person can see here, in order, including those that happened while your module was not open (from where it last got to; a module hears nothing from before its first subscribe). An event has `{ id, at, module, name, ref, data }`. By convention an event named `closed`, `done`, `completed` or `finished` means the item it points at is finished. More than one person may have your module open, so make handling an event safe to do twice.

**Actions.** `input` maps each field to a type: `string`, `text`, `date`, `datetime`, `boolean`, `number` or `ref`, with a trailing `?` for optional. `tavern.actions.list()` returns the actions your module may ask for here (`{ action, module, moduleName, icon, name, label, input }`), only those you could do yourself: offer whichever you can fill from what you have, and label the button with the action's own `label`, so you never name another module. `tavern.actions.request(action, input, { wait })` asks for one; Tavern checks the input against the declared types (only those fields go through) and queues it for the module that owns it. The owner carries out requests with `tavern.actions.provide({ createTask: async (input, { from, by }) => ({ ref }) })`: its page takes a request (only one page does, however many people have it open), does it under the rules of whoever has the module open, and reports how it went. A request waits for a person to open the module if nobody has it open.

### The action bar

A module's buttons go in its action bar, which the host draws. Docked, the bar is a cell in the room's shared bottom row, so it lines up with the video toolbar and the chat box; floating, popped out and on a module's own page it is a strip along the bottom.

```js
tavern.bar.set([{ id: 'add', label: 'Add event', icon: 'plus', primary: true }]);
tavern.on('bar', ({ id }) => { if (id === 'add') openEditor(); });
```

Each item has an `id`, a `label` (up to 30 characters), an optional Font Awesome `icon` name, and `primary` and `disabled` flags; up to six. Setting an empty list hides the bar, and a docked module then fills the whole column. Set the bar again whenever what the buttons can do changes.

### Layout

```js
tavern.setTitle('Calendar');              // the title above the module
tavern.resize({ width: 500, height: 600 }); // ask a floating panel for a size (page content height, in pixels)
```

## Theme

The SDK applies the theme to your page as CSS custom properties on `:root`, so plain CSS follows the theme. **Never hard-code colors, and never assume a dark background.** The tokens and the rules are in [design-theme](../designsystem/design-theme.md). The base stylesheet gives you `.btn`, `.btn-primary`, `.btn-danger`, `.card`, `.section` and styled inputs.

## Running in the page

A module runs in one of two ways. Modules that ship with Tavern run **in the page**: in a container of their own with a shadow root, so their styles and elements stay apart from the page's but they share its window, and can take part in drag and drop between modules. A module an admin uploads runs **sandboxed** (below) unless the admin switches it to run in the page, after a warning that a module in the page is not walled off: it can read and change everything on the page, act as the signed-in person, and is no longer held to its approved permissions, because it can bypass the SDK. Only allow that for a module you trust.

To work either way:

- Look elements up on `tavern.root` (`tavern.root.getElementById`, `tavern.root.querySelector`), never `document`. Use `tavern.rootElement` where you would use `document.documentElement`, and `tavern.refs.elementAt(x, y)` where you would use `document.elementFromPoint`.
- Read the API from `document.currentScript.tavern` when it is set, else from `window.tavern`.
- A module that runs in the page is built from one HTML file: its `<style>`, its inline `<script>` and its body. Keep the module to a single file with style and script inline.
- Selectors written for `html`, `body` and `:root` are applied to the container.

## The sandbox

A module frame has an opaque origin. From inside it you cannot read Tavern's page, its cookies or storage, call `fetch` or open sockets (`connect-src 'none'`), open windows or dialogs, or send a form anywhere. A `<form>` and its `submit` event work (so `preventDefault()` and handle it yourself), but the form goes nowhere. So use in-page UI, not `alert`, `confirm` or `prompt`. You can use inline scripts and styles, and load your own images and fonts as data URLs or from your own files. Module files are public to anyone who can reach the server, so put nothing secret in them.
