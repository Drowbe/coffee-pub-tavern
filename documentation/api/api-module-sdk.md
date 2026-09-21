# Module SDK

**Audience:** someone writing a Coffee Pub Tavern module: what a module is made of, what it can ask Tavern to do, and what it is not allowed to.

To install and manage modules as an admin, read [userguide-modules](../userguides/userguide-modules.md). The server routes behind all of this are in [api-modules](api-modules.md), and how it is built is in [architecture-modules](../architecture/architecture-modules.md).

## What a module is

A module is a zip of static files that runs in the browser, inside a sandboxed frame. It never runs code on the server. It reaches Tavern only through the calls in this document, and the server checks every one.

A module has one or two **surfaces**:

- **page**: a full-width page of its own (server scope), with an item in the header unless the module has a widget, in which case the widget card's heading opens it.
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
- A notification reaches the people it is addressed to who could see the module in that place (the module's `read` permission). It shows as a toast, and as an unread count on the module's dashboard card or header item and the call's Modules button, until they open the module. Notifications are kept for people who are away, up to 50 each.
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

### Settings

A module declares settings in `module.json` (`settings`, see [api-modules](api-modules.md)) and reads what people chose:

```js
const prefs = await tavern.settings.get();          // { defaultView: 'week', ... }: server, room and person values together
tavern.settings.onChange((prefs) => { ... });       // called when any of them changes
```

Every setting has a default, so `get()` always answers with all of them. A module cannot change settings; the forms are Tavern's, so a module never needs a settings screen of its own. Keep them to plain choices (a view, a number, a yes/no); nothing secret belongs in one.

### Shared tools

Anything more than one module needs belongs in the SDK, not copied into each module. Use these rather than writing your own; they follow the theme and work the same in a frame and in the page.

- `tavern.ui.datePicker(input, { range, clearable })` adds a calendar button to a date field (`<input type="date">` or `type="datetime-local"`). It opens a small month with the weekdays across the top, shows the weekday of what the field holds under it, closes on Escape or a click elsewhere, and leaves typing working. `range` is a function returning `[from, to]` to shade a span of days, and `clearable` adds a **Clear** button. A `datetime-local` field keeps its time (12:00 if it had none). It returns `{ close, refresh, destroy }`: call `refresh()` after you set the field's value from code, so the weekday shown is current.
- `tavern.people()` returns the people of the room a panel is in, `[{ key, name }]` (empty outside a room panel), for choosing a person ("whose is it"): store their `key`, not the name.
- `tavern.ui.icon(name, style)` returns a Font Awesome icon ("circle-right", style "solid", "regular" or "brands") as inline SVG text, coloured by the text colour, for a module that cannot load the icon font (a sandboxed frame). It rejects if there is no such icon.
- `tavern.actions.pick(items, point)` is the small menu described under Actions.
- `tavern.util` holds `esc` (text made safe for HTML), `id()` (a new id for something you store), `refKey(ref)` (a pointer as one string, for comparing), and `ymd(date)` / `parseYmd(text)` (a local day as `"2026-09-24"`, and back).

When you find yourself writing something a second module might also need, ask for it here instead. The Calendar, To-do and Polls use these.

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

**Typed pointers.** A `ref` field may name the kind of item it takes: `"task": "ref:todo:task"` takes only a pointer to a To-do task, plain `"ref"` takes any. Tavern refuses a pointer of another kind. `tavern.actions.list({ accepts: "module:kind", self: true })` narrows the list to the actions that take a pointer to that kind (an action with plain `ref` counts), and `self` adds this module's own, marked `own: true`.

**What a drop can do.** When another module's item is dropped on yours, ask what can be done with it rather than assuming: build your own choices (make an event of it, for example), add each action from `actions.list({ accepts })` whose required fields you can fill from where it landed (the day, the pointer to the event it landed on, its date), and let the person choose. `tavern.actions.pick(items, point)` shows a small menu at the point of the drop, `items` being `[{ label, hint? }]`, and resolves to the chosen item or `null` if it is dismissed (Escape, or a click elsewhere). One item resolves at once with nothing asked. Pass `{ remember: "key" }` as a third argument to keep the choice (in that browser, for your module) and list it first, marked "last used", the next time the same key is asked: the Calendar keys it by the kind of item dropped and whether it landed on a day or an event. Give each item an `id` so the choice survives a change of wording; the person still confirms, nothing runs on its own. Two choices that do different things (add it as an event, or set its date) are two items, so the person decides. Fill only what you know: a field you cannot fill that is required means the action is not offered.

**Outcomes.** An event may carry `data` (at most 2 KB). By convention `data.summary` is one line, at most 200 characters, saying how it turned out ("Where to stay: Hotel Nova"). A module that follows an item can keep it: the To-do adds it to a linked task's notes when the task asks for that, and ticks the task when it is set to follow what it links to. Nothing in Tavern knows what a summary means.

**Rules on links.** An event declares the data it carries (`events.publishes[].data`, for example `{ "summary": "string", "pick": "ref?" }`), and `tavern.refs.kinds()` returns, for each kind, the events it can report with their data. A module that links to items can then let the person choose, per link, what to do when the item reports something, offering only what the event's data supports. The To-do does this: for a linked poll's close it offers to tick the task, add the `summary` to its notes, use it as the title, or link the item in `pick`. By convention `summary` is one line about the outcome and `pick` is a pointer to the item the outcome chose; neither means anything to Tavern. Treat `pick` as untrusted: check the kind is one you may link to.

**Rules that ask other modules.** A rule can also ask another module to do something with what an item reports. The To-do offers, for each action another module provides (from `tavern.actions.list()`), "Module: what it does" whenever every required field can be filled from the event: a `date` field from the event's `date`, a `string` or `text` field from its `summary`, a plain `ref` field from the item that reported. So a poll that declares a `date` (its winning option's date) and a Calendar that provides `createEvent` are enough for a closed poll to put the winning date on the calendar, with neither module naming the other. The module that follows asks under the person's own rights. The first page to save the rule as fired asks, so however many people have the To-do open the request is made once; that needs `actions.uses` approved by an admin.

**Links on parts of an item.** An item can hold links of its own for its parts. A poll option takes a link (drop an item on it) and the poll passes the winning option's link out as `pick` when it closes. Tell Tavern what the whole item points at with `tavern.refs.setLinks`, so those items list it under what links to them.

### A dashboard widget

A module with the `server` scope can offer a widget for the dashboard on the rooms page: a small card, across all of the viewer's rooms. Declare `"widget": { "entry": "widget.html", "title": "Coming up", "size": "medium", "order": 10 }` under `surfaces`. The widget is its own single HTML file (in this repository, `src/<id>-widget.html`, `.css` and `.js`, built like the module page), and runs like a server page: `info.context.scope` is `"server"`, `tavern.storage.list(prefix)` reads the server's data, `tavern.storage.list(prefix, { scope: 'rooms' })` the module's data in each of the viewer's rooms (each item with its `roomId`), and `tavern.rooms()` names those rooms and their icons. The widget shows; it does not edit. `tavern.page.open(hash)` (letters, digits and `= & _ . : , -` only, at most 80 characters) opens the module's own page at a place in it, for a click that means "show me this in full"; the page passes the hash to your module, which reads it with `tavern.page.onHash(fn)` (the Calendar's month opens a day with `day=2026-09-24`). Clicking an item should call `tavern.refs.open(ref)`, which takes the person to that item in its room; the card's heading opens the module's full page. A widget in a frame tells the dashboard how tall it is with `tavern.resize({ height })` (measure your own content, not the frame). Keep it small and quick: it loads with the rooms page. Code the page and the widget share can go in `src/<id>-lib.js`, which the build puts where a script has `/*__LIB__*/`.

### The action bar

A module's buttons go in its action bar, which the host draws. Docked, the bar is a cell in the room's shared bottom row, so it lines up with the video toolbar and the chat box; floating, popped out and on a module's own page it is a strip along the bottom.

```js
tavern.bar.set([{ id: 'add', label: 'Add event', icon: 'plus', primary: true }]);
tavern.on('bar', ({ id }) => { if (id === 'add') openEditor(); });
```

Each item has an `id`, a `label` (up to 30 characters), an optional Font Awesome `icon` name, and `primary` and `disabled` flags; up to six. Setting an empty list hides the bar, and a docked module then fills the whole column. Set the bar again whenever what the buttons can do changes.

**Quick add.** An item `{ id: 'add', type: 'quickadd', label: 'Add event', placeholder: 'Add an event: lunch fri at noon' }` is drawn as a text field with a small + button, bottom-aligned so it lines up with the chat box. Submitting (Enter, or the button, even with nothing typed) sends the `bar` event with `{ id, value }`, the text typed. Open your add form with it filled in, so the person confirms rather than starts over. `tavern.util.parseWhen(text)` helps: it pulls a date and a time out of what was typed and leaves the rest as the title, so `"meet with bob sep 29 at 7pm"` gives `{ title: "meet with bob", date: "2026-09-29", time: "19:00" }`. It understands today, tomorrow, weekdays ("fri", "next fri"), "sep 29" and "29 sep", "9/29" and "2026-09-29", and times as "7pm", "7:30 pm", "19:00", "at 7", "noon" or "midnight"; a day already passed this year means next year, and anything it does not recognise stays in the title. Use only what your form has a place for.

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
