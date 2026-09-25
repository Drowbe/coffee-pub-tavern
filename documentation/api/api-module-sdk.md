# Module SDK

**Audience:** someone writing a Coffee Pub Magpie module: what a module is made of, what it can ask Magpie to do, and what it is not allowed to.

To install and manage modules as an owner, read [userguide-modules](../userguides/userguide-modules.md). The server routes behind all of this are in [api-modules](api-modules.md), and how it is built is in [architecture-modules](../architecture/architecture-modules.md).

## What a module is

A module is a zip of static files that runs in the browser, inside a sandboxed frame. It never runs code on the server. It reaches Magpie only through the calls in this document, and the server checks every one.

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
    { "key": "view", "label": "See the calendar", "default": { "member": true, "guest": true, "moderator": true } },
    { "key": "edit", "label": "Add and change events", "default": { "member": true, "guest": false, "moderator": true } }
  ],
  "access": { "read": "view", "write": "edit" },
  "hooks": { "schedule": true, "notify": true }
}
```

- `scope` says where the module can run. A `server` module needs a `page` surface and a `room` module needs a `panel`.
- `icon` is the name of a Font Awesome icon, used in the header and the Modules menu.
- `panel.mode` lists how a panel may be shown: `dock` (a column of the room beside the video and chat), `float` (a panel over the call), or both. Leave it out and both are allowed. A room opens a module docked when it can, and people can switch between them. A pane keeps the width you drag it to. `width` and `height` are the starting size.
- `permissions` are the module's own permissions. Each appears on the Roles tab as `Module: <name>`, with the `default` you give per role: `member`, `moderator` and `guest` (a missing `moderator` takes `member`'s value; the old key `user` is still read as `member` until the manifest's own rename). A key matches `^[a-z][a-z0-9_]{0,23}$`: a lower-case letter, then up to 23 lower-case letters, digits or underscores. Owners, and the host admin on a hosted server, always have every permission, so a module never needs a role check of its own: ask `host.can()`.
- `access` names which of those permissions guards reading and writing the module's data. Leave it out and any signed-in person who can see the module can read and write.
- `hooks` names what the module may ask Magpie to do: `schedule` and `notify`. An owner approves them when enabling the module.
- `refs` lets modules point at each other's items without reaching into each other's data; see [Refs](#refs-pointing-at-another-modules-items). `refs.produces` lists the kinds of item this module lets others point at, and `refs.consumes` the other modules' kinds it wants to point at, which the owner approves when enabling the module.

## Pages and the SDK

Magpie adds the SDK and a base stylesheet to each of your HTML pages when it serves them, so a page needs no `<script>` or `<link>` for them. To keep the base styles out, add `<meta name="sdk-base" content="none">`. The SDK defines `window.host`.

```js
const t = await host.ready();
// t.user      { key, name, role }   role: 'owner', 'member', 'guest', or 'admin' for the host admin's own account
// t.context   { scope: 'server' | 'room', roomId }
// t.permissions  { view: true, edit: false }   the module's own permissions, by short key
// t.theme     the current theme tokens
host.can('edit');   // true or false, from the permissions above; always true for an owner
```

Every call returns a promise. Do not call anything before `ready()` resolves.

### Storage

A small key-value store per module, with a scope: the whole **server**, one **room**, or one **person**. The person scope (declare `"person"` in the manifest's `scope`; a page asks with `{ scope: 'person' }`) is the signed-in person's own data, kept for them alone whichever room or page they are in: nobody else can read it, not even an owner, and a guest has none. Its changes are pushed only to that person's own pages, with `scope: 'person'` on the `change` event (check `e.scope` if your page also shows a room's data). Pointers to a personal item have `scope: 'person'` (`host.refs.make(kind, id, { scope: 'person' })`) and find nothing for anyone but the owner; personal items are not linked (`setLinks` refuses them). `host.refs.search(text, { scope: 'person' })` lists the viewer's own. A page uses its own scope (`'context'`, the default). A room panel may also ask for `{ scope: 'server' }` to read server data. A module with both a server page and a room panel may, on its server page, read `{ scope: 'rooms' }`: read-only, across every room the viewer is a member of that has the module on and lets their role read it. Each item comes back with its `roomId`, and `host.rooms()` returns those rooms as `[{ id, name, icon, svg }]`, where `svg` is the room's icon as inline SVG (a module cannot load the icon font). Live `change` events from those rooms carry a `roomId` and `scope: 'rooms'`.

```js
await host.storage.set('event:123', { title: 'Session' });        // returns { key, value, version, updatedAt, by }
const item = await host.storage.get('event:123');                 // an item, or null
const items = await host.storage.list('event:');                  // items whose key starts with the prefix
await host.storage.delete('event:123');
```

- Keys are 1 to 128 of letters, digits and `. _ : / -`. A value can be any JSON up to about 60 KB. A module may store 5 MB in all.
- Every write bumps the key's `version`. Pass the version you read to detect a change made since: `set(key, value, { version })` rejects with `error.status === 409` and `error.current` (what is stored now) if someone wrote first. Without a version, the last write wins.
- Store each thing under its own key, not everything as one blob, so two people editing different things never collide.

### Live changes

```js
host.on('change', (e) => {
  // e = { key, value, version, deleted, by, scope }
});
```

Any change to stored data in the scopes the frame can see is pushed to it, including changes the frame made itself. Read the current state with `list` once at start, then apply `change` events.

### Reminders and notifications (hooks)

These need the `schedule` and `notify` hooks in the manifest.

```js
await host.schedule({
  key: 'remind:123',                 // names it; scheduling the same key again replaces it
  at: Date.parse('2026-09-20T19:00:00-07:00'),   // milliseconds or an ISO date
  payload: { id: '123' },            // handed back when it fires (up to 4 KB)
  notify: { title: 'Session tonight', body: 'Starts in an hour' },   // optional
  repeat: { every: 'week', until: Date.parse('2026-12-31'), tz: 'America/Los_Angeles' }, // optional
});
await host.cancelSchedule('remind:123');
await host.notify({ to: 'room', title: 'Hello', body: 'Sent now' });  // 'room', 'server', or a user key
host.on('schedule', ({ key, payload }) => {});   // when one fires, if the module is open
```

- A schedule can be at most a year away, and a time already more than five minutes past is refused. If the server is off when a schedule is due, it fires on the next start unless it is more than six hours late.
- A notification reaches the people it is addressed to who could see the module in that place (the module's `read` permission). It shows as a toast, and as an unread count on the module's dashboard card or header item and the call's Modules button, until they open the module. Notifications are kept for people who are away, up to 50 each.
- `repeat` makes Magpie schedule the next one itself when each fires, so it keeps going while the module is closed. `every` is `day`, `week`, `2weeks`, `month` or `year`; `until` (optional) ends it; `tz` is an IANA time zone name, and the wall-clock time is kept in it across daylight saving changes. A monthly repeat on the 31st goes back to the 31st after a shorter month. Cancelling the key cancels the whole series.
- `notify` in `schedule` defaults to the module's own scope: the room, or the whole server.

### Refs: pointing at another module's items

Modules cannot read each other's storage, and that does not change. Refs are the one narrow door between them: a module stores a **pointer** to another module's item, never a copy, and asks Magpie for a small **card** whenever it draws it.

Magpie names no module in any of this. A module says what it can do in `module.json`, and Magpie is only the conduit; a module written tomorrow takes part by declaring, with no change to Magpie or to the modules around it.

A module that lets others point at its items lists them in `module.json`. Each entry names a `kind`, its `name` (what a person sees it called), the stored key its items live under (a fixed prefix then `{id}`) and which of its stored fields fill the card. Only the fields named here ever leave the module, so a record's other fields stay private. Two optional flags say what else the module can do with its items: `"open": true` (it can show one when asked, see `onOpen`) and `"backlinks": true` (it shows what links to its items, see `linksTo`).

```json
"refs": {
  "produces": [
    { "kind": "event", "key": "event:{id}", "card": { "title": "title", "subtitle": "desc", "when": "start", "end": "end", "allDay": "allDay" } }
  ],
  "consumes": ["*"]
}
```

`consumes` lists the kinds this module wants to point at: named, as `"module:kind"`, or `"*"` for whatever other modules share. `"*"` is what lets a module link to items of modules that did not exist when it was written. An owner approves the list when enabling.

The card fields are `title` (required), `subtitle`, `when`, `end`, `allDay`, `done`, `category` (a short label) and `place` (`{ lat, lng, name? }`, a spot on a map). An upgrade that adds to `consumes` waits for the owner's approval, like a new permission or hook.

A pointer is `{ module, kind, id, scope: 'room' | 'server', room? }`.

```js
// Make a pointer to one of your own items, and keep it (with the rest of your data):
const ref = host.refs.make('event', 'e1');           // { module: 'calendar', kind: 'event', id: 'e1', scope: 'room', room: '...' }
//   host.refs.make('event', 'e1', { scope: 'server' })   an item in the server's scope, from a room
//   host.refs.make('event', 'e1', { room: roomId })      another room's item, from a module's server page

// Later, ask Magpie what to show. One pointer gives a card, a list gives cards in the same order:
const card = await host.refs.resolve(ref);
// { ref, kind, module: { id, name, icon }, title, subtitle?, when?, end?, allDay?, done?, place? }
// or { ref, error, status, state } when the item is gone or the viewer may not see it (404, 403): `state` is 'gone' or 'hidden'.
// Draw what it says now, never a title you stored: a gone item is a muted "No longer available" with a way to remove your link,
// a hidden one "Not available to you" (show nothing else about it), and neither opens an editor. Ask again now and then, since an
// item can change or go where it lives without telling you.
const cards = await host.refs.resolve([refA, refB]);

// Find items to link to, in this place (or from a room, { scope: 'server' }): every kind this module consumes.
const found = await host.refs.search('retreat');     // cards, each with its pointer in card.ref

// What can I link to? Whatever other modules share and Magpie says this module may, so never name modules in your code.
const kinds = await host.refs.kinds();               // [{ module, moduleName, icon, kind, name, open }]

// Show an item in the module that owns it. Its pane opens (or its page) and it is handed the pointer.
await host.refs.open(card.ref);                      // only useful when card.open is true
host.refs.onOpen((ref) => { /* you own ref: show it (select it, scroll to it, open it) */ });

// Tell Magpie what one of your items points at (the whole list, replacing the last), so what is pointed at can ask.
await host.refs.setLinks(host.refs.make('task', id), [refA, refB]);
// What points at one of your items (kind has "backlinks": true), and what one points at: cards.
const from = await host.refs.linksTo(ref);
const to = await host.refs.linksFrom(ref);
host.on('links', (e) => { /* e.ref: one of your items whose links changed: ask again */ });
```

Magpie answers only what the viewer could already see in the producing module: it must be enabled, the viewer must hold its `read` permission in that scope and be in the room, and the asking module must have been approved for that kind. A pointer is therefore only as revealing as the viewer's own access, and a card is read again each time, so it is always current. Show `Not available` for an error.

**Dragging.** A module can offer its items to be dragged onto another module. The browser's own drag and drop is unreliable between sandboxed frames, so this is driven by the pointer and brokered by Magpie: press an item, move a few pixels, and Magpie shows the item's label at the pointer and tells the module frame under it where the pointer is and, on release, what was dropped. A module offers items with `host.refs.draggable(root, resolve)`, where `resolve(target)` says what the pressed element is (`{ kind, id, label, ...options for make() }`, or `null`):

```js
host.refs.draggable(document.body, (target) => {
  const row = target.closest('[data-id]');
  return row ? { kind: 'event', id: row.dataset.id, label: row.textContent.trim() } : null;
});
```

The press is followed even when the pointer leaves your frame at once, and the click that would follow the release is swallowed. To see where a drag stops, open Magpie once with `?debug=1` (`?debug=0` turns it off): every step, in the module that starts the drag, in the page and in the module under it, adds a line to a box at the bottom left. `host.refs.trace(text)` adds your own. It works with a mouse or pen; on a touch screen, search is the way to link.

A module with nothing stored (the assistant's answers) drags the card itself instead of a pointer: `resolve` returns `{ card: { title, kind?, content?, place?, date? }, label? }`. The module it lands on can make of it whatever takes a title, a date, a place or text; it cannot be linked to, since there is nothing to point at.

**What a drop does.** A module that accepts drops calls `host.refs.dropTarget` to know what is under the pointer, and hands the decision -- what can be done with it -- to `host.refs.dropMenu`, which is the same for every module. You say what is under the pointer (the drop context) and what you would offer of your own; the SDK adds what the dropped item's own module can do with it *here* (set this task's due date to this day, link this task to this event, put this place at this spot), shows one menu, and runs the choice -- one offer runs at once, with nothing asked. A drop is about the item and what is here: a third module making something new of the item is not offered, however well its inputs would fill; that belongs where the item lives. Nothing names a module: a module installed later takes part with no change to you. Your own items reach the same `dropTarget` when they are dropped on you: a drag that starts in your module (`host.refs.draggable`) is delivered to your own `over`, `leave` and `drop` while it is over your frame, with your own pointer as `ref`, so moving an item within a module (a plan's item from one day to another) is the same code path as taking one from outside; the host hands it to the other modules the rest of the time. Note that `leave` is sent just before `drop`: anything you undo on `leave` that moves your layout (a drop zone that opens while a drag is over you) should wait a tick, or the drop is hit-tested against the wrong layout.

```js
host.refs.dropTarget({
  over: (point, ref, dragged) => { /* highlight what is at point; ref is the pointer being dragged (null for a card) */ },
  leave: () => { /* clear the highlight */ },
  drop: async (ref, point, dragged) => {
    const spot = dayAt(point);                       // your own: what is under the pointer
    if (!spot) return;
    try {
      const chosen = await host.refs.dropMenu(dragged, point, {
        context: { date: spot.day, target: spot.event ? host.refs.make('event', spot.event.id) : undefined },
        own: [{ id: 'create', label: 'Add to the calendar as an event', hint: 'Tue 3 Oct', run: (ctx) => createEventOn(ctx.card.title, spot.day, ref) }],
        remember: 'day',                             // the last choice is offered first next time, per dropped kind
      });
      if (chosen) note(`${chosen.label}: done`);      // null: dismissed
    } catch (err) { note(err.message); }             // "Nothing can be done with that here.", or what failed
  },
});
// point is { x, y } in your own page: host.refs.elementAt(point)
```

The **drop context** is `{ card, target?, date?, time?, place? }`: `card` is the dropped item's card (resolved for you, or the card the drag carried), `target` a pointer to your own item under the pointer, `date`/`time` the day and time there, `place` the `{ lat, lng }` there (a map). An action is offered when every required input can be filled from it: a `ref:module:kind` input takes the dropped pointer when it is that kind; a plain `ref` takes the dropped pointer (a second one, or one named `target`, takes `target`); `date`/`datetime` the day (else the card's own date); `string` named `title` the card's title, `kind` its kind; `text` named `notes`, `body`, `content` or `text` the card's text (only when the drag carried it); `number` named `lat`/`lng` the place. Of the actions that fill, a drop offers only the dropped item's own module's, taking the item by its exact kind (`ref:todo:task`, never plain `ref` alone) and using something from under the pointer (the target item, the day, the spot); and not one whose declared `needs` (a place, a date, text) the item's card lacks. `offersFor` is what applies that; the fill rules themselves also serve the finished-poll buttons and "Send all to plan", where a plain `ref` input taking the item is right. An own offer is `{ id, label, hint?, icon?, run(ctx), when?(ctx) }`; `when` leaves it out for a card it does not suit (a place needs a position); it wears your module's own icon unless `icon` names another, and each action offered wears its module's, in the same look as `host.menu.show`. `host.refs.offersFor(dragged, context)` is the same list without the menu. `tools/check-drop.mjs` runs the fill rules.

Treat `ref` as untrusted: `dropMenu` resolves it, which is where Magpie checks what the viewer may see, and shows its error if not. Magpie brokers a drag between module frames in the same window (the page, or the popped-out app). `host.refs.drag(event, ...)`, called from a native `dragstart`, and `host.refs.accepts` / `host.refs.parse` for a native drop remain for a drag that does not come from a module, but a module offering items should use `draggable`. Search is the way to link without dragging at all.

### Settings

A module declares settings in `module.json` (`settings`, see [api-modules](api-modules.md)) and reads what people chose:

```js
const prefs = await host.settings.get();          // { defaultView: 'week', ... }: server, room and person values together
host.settings.onChange((prefs) => { ... });       // called when any of them changes
```

A `file` setting (with `"folder": "map-tiles"`, lowercase letters, digits and dashes) names a file the operator copied into that folder inside the module's own folder in the data folder (`modules/<module id>/<folder>/`; uninstalling and updating never delete it) (too large to upload through a page, such as a map archive); the owner picks it in the form, and a module running in the page reads it, range requests included, from `await host.files.url(name)`. A `url` setting holds an http or https address the owner chose.

Every setting has a default, so `get()` always answers with all of them. A module cannot change settings; the forms are Magpie's, so a module never needs a settings screen of its own. Keep them to plain choices (a view, a number, a yes/no); nothing secret belongs in one.

### Place search

A module whose manifest declares `geocoder` (see [api-modules](api-modules.md)) asks the server to search for places by name, so the page never contacts an outside service:

```js
const { results, configured, credit } = await host.geocode.search('colosseo', { lat: 41.9, lon: 12.5 }); // near is optional
// results: [{ key, title, sub, lat, lng, from }]  `from` says where it came from (saved on the server, or the service)
await host.geocode.used(results[0].key);     // the person picked it: the server keeps it when it is cleaned out
```

The server looks in the places it has saved first, and asks the service the owner chose only when fewer than five match; the answers are saved if the owner allows it. Searches count against the module's rate limit.

### AI

A module that declares the `ai` hook can ask the AI the owner set up:

```js
const { available, why } = await host.ai.available();
const r = await host.ai.ask({ task: 'ask', question: 'Where is the hotel?', items: [note.ref, place.ref] });
// r.text: the words, with a line {{card:0}} where the first card goes; r.cards: [{ icon, kind?, title, content, tags?, place?, date?, links?, sources? }]
```

Tasks are `summarise`, `ask` and `tags` (`ask` needs no items: with none it answers from the model's own knowledge, and with some it uses them as context and says which parts came from them; `summarise` and `tags` need items and use only them; each card carries `basis`: `general`, `items` or `both`) (`tags` returns `r.tags`, up to 6 words). The server reads the items as the person asking (only what they may see; up to 12, each up to 8 KB of `text`), sends them inside a fixed frame that tells the model they are data and never instructions, gives the model no tools, and returns its text. Asked for several distinct things, the model is told to write one card per thing (up to 20 in one answer) rather than fold them into prose. Where the model writes a card in a fenced block, the server checks each field (an icon from a fixed list, a title of 80 characters, content of 2000 characters — plain prose or simple Markdown, rendered with `host.util.markdown` — up to 5 one-word tags, an optional `kind` naming an everyday sort of thing the card plainly is — `flight`, `train`, `bus`, `ferry`, `car`, `hotel`, `restaurant`, `cafe`, `bar`, `sight`, `museum`, `tour`, `show`, or left out for a plain card — a place with an in-range position, a real date, https links, sources only among the items given) and returns it as a card; a block that is not a valid card stays as ordinary text. `kind` is ordinary domain language, not a module's own names: a module that recognises one (Planner's `acceptSuggestion`, for one) may act on it, and one that does not simply ignores it. Draw a marker `{{card:N}}` only where N is a real index into `cards`. Nothing is stored by the server: not the question, not the answer. It logs who, which module and task, and the token count, never the text. Errors are plain messages: not set up, your role may not use AI, AI is off in this room, the monthly allowance is used, the service did not answer. A person is limited to a few requests a minute.

### Uploaded pictures

A module whose manifest declares `uploads` (see [api-modules](api-modules.md)) keeps the pictures its people add:

```js
const f = await host.uploads.put(blob, { name: 'harbour.jpg', keepPosition: false, scope: 'room' });
// f: { id, name, type, size, by, at, taken, camera, hasPosition, position, hasThumb }
await host.uploads.thumb(f.id, thumbBlob, { scope: 'room' });
img.src = await host.uploads.url(f.id, { thumb: true, scope: 'room' });
await host.uploads.remove(f.id, { scope: 'room' }); // when the item that shows it is removed
```

Make the picture the size you want (about 2000 px on the long edge) and a thumbnail (about 400 px) in the page before sending: the server does not decode pictures, it checks and cleans them. A resize in the page loses the picture's own facts, so read them first with `await host.uploads.inspect(file.slice(0, 256 * 1024, file.type))`, which answers `{ type, taken, camera, hasPosition, position }` from the start of the file; the position goes only to the person who sent it, and keeping it is then the page's decision (store it with the item). A photo's position is dropped unless `keepPosition` is true; `hasPosition` says it had one, so the page can offer to keep it (put the file again with `keepPosition`, then remove the first copy). Only the person who added a file, or an owner, can remove it. Uploads count against a per-person rate limit.

### Shared tools

Anything more than one module needs belongs in the SDK, not copied into each module. Use these rather than writing your own; they follow the theme and work the same in a frame and in the page.

- `host.ui.datePicker(input, { range, clearable })` adds a calendar button to a date field (`<input type="date">` or `type="datetime-local"`). It opens a small month with the weekdays across the top, shows the weekday of what the field holds under it, closes on Escape or a click elsewhere, and leaves typing working. `range` is a function returning `[from, to]` to shade a span of days, and `clearable` adds a **Clear** button. A `datetime-local` field keeps its time (12:00 if it had none). It returns `{ close, refresh, destroy }`: call `refresh()` after you set the field's value from code, so the weekday shown is current.
- `host.locale()` is `{ language, clock, currency }`: how the server shows these (Manage > Settings > Language, time and money; the defaults `en`, `12`, `USD` until the handshake answers). Apply them with `host.util.time("22:30")` ("10:30 PM" on the 12-hour clock, "22:30" on the 24-hour one; a stored time is always HH:MM), `host.util.hour12()` (for `toLocaleString`'s `hour12` where you show a Date) and `host.util.money(amount, currency?)` (the server's currency unless one is given). Never format a time or an amount your own way: the person chose these once, for everything.
- `host.ui.viewSwitch({ id, options, value, onChange })` draws a labelled view or filter switch in the toolbar (see "The toolbar" below) and owns the boilerplate every module drawing one otherwise repeats: it only calls `host.toolbar.set` when the value or an option's label actually changed, and wires the `toolbar` event for you. Call `.set(value, options?)` on every render (it no-ops when nothing changed) rather than diffing and calling `toolbar.set` yourself. A module may make more than one (Research: whose items, then Cards/List): every live switch shares the toolbar row, drawn in the order they were made with a separator between, and any one changing redraws the row; `destroy()` takes one out again. Do not call `toolbar.set` yourself while a switch is live, since the next switch change would draw over it.
- `host.ui.toolbarButton({ id, label, icon, iconOnly, on, onClick })` puts one button in the same toolbar row as the view switches (after the switches made before it), for a chooser that opens a menu, such as Research's Tags: `onClick` runs on a click, and the returned `{ set({ label, icon, on }), destroy() }` changes what it shows (`set` redraws only when something changed). Open the menu it belongs to with `host.menu.show({ at: { x: 100000, y: 4 }, ... })`, which lands at the top right of the module, under the toolbar.
- `host.people()` returns the people of the room a panel is in, `[{ key, name }]` (empty outside a room panel), for choosing a person ("whose is it"): store their `key`, not the name.
- `host.ui.icon(name, style)` returns a Font Awesome icon ("circle-right", style "solid", "regular" or "brands") as inline SVG text, coloured by the text colour, for a module that cannot load the icon font (a sandboxed frame). It rejects if there is no such icon.
- `host.actions.pick(items, point)` is the small menu described under Actions.
- `host.util` holds `esc` (text made safe for HTML), `id()` (a new id for something you store), `refKey(ref)` (a pointer as one string, for comparing), and `ymd(date)` / `parseYmd(text)` (a local day as `"2026-09-24"`, and back).

When you find yourself writing something a second module might also need, ask for it here instead. The Calendar, To-do and Polls use these.

### The titlebar

A module shown as a pane (docked or floating), or in a window of its own, has a titlebar the host draws with the module's name and the pane's buttons. `host.header.set([...])` adds icon buttons of the module's own to it, ahead of the pane's buttons and set off by a pipe: for a window-level action (pin the pane open, say), not a filter or a view switch -- those belong in the toolbar (below), as `tabs`, not more icons here.

```js
const drawn = await host.header.set([
  { id: 'pin', icon: 'thumbtack', title: 'Keep this pane open', on: pinned },
]);
host.on('header', (e) => { /* e.id is the button clicked */ });
```

`icon` is a Font Awesome name, `on` marks the current choice, `title` is the tooltip. It resolves `true` when the host drew them and `false` when there is no titlebar (a module's server page), so keep your own controls in the page in that case, and hide them when it is true. More than five collapse into a host-drawn "..." at the end (see Overflow, below); mark one `overflow: true` to always keep it there (a destructive one, say) regardless of how many you set.

### The toolbar

An optional row the host draws under the titlebar, above the content: a small kit of reusable tools about the module's current state -- not window-level actions (the titlebar) and not the module's primary inputs (the action bar), and not a second row of titlebar icons. For the common case, a view or filter switch, reach for `host.ui.viewSwitch` (see "Shared tools") rather than building the `tabs` item yourself. `host.toolbar.set([...])` takes a list of items, each one of:

```js
host.toolbar.set([
  { type: 'text', text: '12 of 40' },
  { separator: true },
  { type: 'tabs', id: 'view', value: 'mine', options: [{ id: 'mine', label: 'Mine' }, { id: 'all', label: 'All' }] },
  { type: 'progress', value: 62, label: 'Importing' },
  { type: 'slider', id: 'zoom', value: 5, min: 1, max: 10, label: 'Zoom' },
  { id: 'sync', type: 'button', label: 'Sync now', icon: 'rotate' },
]);
host.on('toolbar', ({ id, value }) => { /* a tabs or slider item's click/move also carries `value` */ });
```

- `{ type: 'text', text }` -- a plain, dim label.
- `{ type: 'tabs', id, value, options: [{ id, label?, icon?, regular?, iconOnly? }] }` -- a segmented switch; each option needs a `label`, an `icon`, or both -- `iconOnly` keeps the icon and drops the visible label (kept as the tooltip and `aria-label`), for a tight space where the icon alone already reads clearly (Places' Mine/This room/Everyone, an icon and a label together, is the more common shape). A click sends `{ id, value: optionId }`.
- `{ type: 'progress', value, label? }` -- a read-only bar, `value` 0-100.
- `{ type: 'slider', id, value, min?, max?, step?, label?, disabled? }` -- a range input (min 0, max 100, step 1 unless given); moving it sends `{ id, value }`.
- `{ type: 'button', id, label?, icon?, on?, primary?, disabled?, overflow? }` (the default type when `type` is left out) -- a click sends `{ id }`. Use this sparingly, for the one action that goes with the toolbar's own state (a Sync button beside an import's progress) -- not a place to relocate the titlebar's row of icons. Unlike a `tabs` option, a lone `button` item repeating the titlebar's icon style is exactly the thing to avoid.
- `{ separator: true }` -- a vertical divider, ignoring every other field.

Only `button` items count toward the five-item cap and collapse into the "..." (text, tabs, progress and slider items always show, since they say something, or are themselves the control, rather than being one more action). Resolves `true`/`false` the same way `header.set` does.

### Registering into the nav bars

The header is two bars of three zones each (see the navigation architecture): the primary nav is about the system and the secondary, in a space, about the space. Both are drawn from one registry, and a module registers tools into it the same way the host's own controls are registered: one registration, not markup, and the host draws the tool in its own look. This is for a space action the module adds while its pane is open (a quick "add" for the space, a switch for the space's view of the module), not for the module's own state, which is the toolbar's, and not for its primary inputs, which are the action bar's.

```js
await host.nav.set([
  { id: 'add', icon: 'plus', label: 'Add a task', order: 101 },
  { id: 'mine', icon: 'user', label: 'Only mine', toggleable: true, active: onlyMine, group: 'views' },
  { id: 'plan', icon: 'map', label: 'Open the plan', href: '/modules/planner' },
]);
host.on('nav', ({ id }) => { /* 'add', 'mine' or 'plan': the module's own id */ });
host.nav.setActive('mine', true); // a toggle's state, in place
host.nav.setBadge('add', 3); // a count on a tool; 0 takes it off
```

A tool is `{ id, zone?, icon, label, title?, order?, group?, groupOrder?, href?, visible?, toggleable?, active?, badge? }`:

- `id` is letters, digits and hyphens, the module's own; the host puts it under the module's namespace, so a module can neither touch another's tools nor the system's, and the `nav` event carries the module's own id back.
- `zone` is `left`, `middle` or `right` (the default) of the secondary bar; `icon` a Font Awesome name; `label` what a screen reader and the tooltip say (`title` a longer tooltip).
- `order` and `groupOrder` sort tools in a group and groups in a zone. The bands are 1-10 for the system's core tools, 11-50 secondary, 51-100 utility, 101-998 a module's own, 999 last: a module's numbers are clamped into 101-998, so the system's tools stay ahead of every module's with nobody coordinating numbers. A module's tools form their own group (or groups, with `group`), with a divider from the system's.
- `href` makes the tool a real link (a path on this server, or an https address); otherwise a click arrives as the `nav` event.
- `visible` is a boolean (the default is shown); `toggleable` tools carry `active`, which `setActive` changes in place, and `badge` is a count, which `setBadge` changes in place. Never call `set` again for either.

The set replaces the last one; it is drawn while the module's pane is open in that space and taken out when the pane closes or the module is unmounted. It resolves `true` when the host drew the tools and `false` when there is no space bar here (the module's own page, its own window), so keep such a control in the page in that case.

**The primary bar.** A module's tools go in the secondary bar. The primary bar takes a registration from a module only for a system-wide tool: the tool says `system: true` and `bar: 'primary'`, the module's manifest has `surfaces.page.nav: true` (the owner allowed it into the primary nav), and it goes into the right zone, with the system's own actions. Anything else for the primary bar is refused with an error that says which rule it broke. A module's own page link is already there, from the manifest; this is not for that.

### An action menu

A menu of things to do — a row's "..." button, a right-click, the + on a joint between two days — is `host.menu.show({ id, items, at, anchor })`. This is different from `host.actions.pick` (below): `pick` asks one question and resolves once ("what should this dropped item become?"); `menu.show` draws a reusable menu of independent actions, each with its own handler, that stays around across many opens.

```js
host.menu.show({
  id: `row-${item.id}`, // showing the same id again while it is open closes it instead of reopening it
  anchor: button, // or `at: { x, y }` for a point instead (a drop's own coordinates)
  items: [
    { id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(item.id) },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: (_, b) => {
      if (!armed) { armed = true; b.querySelector('.sdk-menu-label').textContent = 'Really delete?'; return false; } // false: stays open
      remove(item.id); // anything else closes the menu
    } },
  ],
});
```

Each item is `{ id?, label, icon?, iconColor?, regular?, hint?, disabled?, danger?, separator?, href?, target?, onClick? }`; `separator: true` draws a divider and ignores every other field. `iconColor` sets that one icon's color (a CSS color), for a menu whose items are a fixed set of kinds people already tell apart by color elsewhere in the module (Planner's marker types, say) — most menus don't need it; `danger` already covers the one-off "this is destructive" case. An item that just opens somewhere else gives `href` instead of `onClick` — a real `<a>` (`target` "_blank" unless given), so hovering, copying the link and opening it in a new tab all still work, rather than a click handler faking navigation with `window.open`. Position with `at` (a point) or `anchor` (an element to open under, flipped above it when there is no room below) — give one, not both. `onClick(item, button)` runs on a click and the menu closes afterward, unless it returns exactly `false` (or a promise that resolves to `false`), which leaves it open for an item that needs to arm itself first, as `delete` does above — mutate the clicked button's own `.sdk-menu-label` to change what it says. Only one of these is ever open at once per module; showing a new one closes whatever was open, and showing the same `id` again toggles it closed rather than reopening it, so a "..." button behaves the way it looks like it should.

### Events and actions: reacting to and asking things of other modules

The other two conduits between modules, and like refs they name no module. Declare them in `module.json` and an owner approves what your module hears and asks for.

```json
"events":  { "publishes": [{ "name": "closed", "kind": "poll", "label": "A poll closed" }], "subscribes": ["*"] },
"actions": { "provides": [{ "name": "createTask", "label": "Add a task", "input": { "title": "string", "notes": "text?", "ref": "ref?" } }],
             "uses": ["*"] }
```

**Events.** `host.events.publish(name, { ref, data })` says something happened (`ref` an optional pointer to one of your own items, `data` a small plain object under 2 KB). `host.events.subscribe(handler)` hears the events your module was approved for (`"*"`, or `"module:name"`), about modules the person can see here, in order, including those that happened while your module was not open (from where it last got to; a module hears nothing from before its first subscribe). An event has `{ id, at, module, name, ref, data }`. By convention an event named `closed`, `done`, `completed` or `finished` means the item it points at is finished. More than one person may have your module open, so make handling an event safe to do twice.

**Actions.** `input` maps each field to a type: `string`, `text`, `date`, `datetime`, `boolean`, `number` or `ref`, with a trailing `?` for optional. `host.actions.list()` returns the actions your module may ask for here (`{ action, module, moduleName, icon, name, label, input }`), only those you could do yourself: offer whichever you can fill from what you have, and label the button with the action's own `label`, so you never name another module. `host.actions.request(action, input, { wait })` asks for one; Magpie checks the input against the declared types (only those fields go through) and queues it for the module that owns it. The owner carries out requests with `host.actions.provide({ createTask: async (input, { from, by }) => ({ ref }) })` (a handler may also return `data`, up to about 8 KB of plain data, which the requester reads from `out.result.data` when it waits; that is how a view asks a question): its page takes a request (only one page does, however many people have it open), does it under the rules of whoever has the module open, and reports how it went. A request waits for a person to open the module if nobody has it open; in a room, Magpie opens the pane of the module that carries the action when it is not open, so the request is carried out at once.

**What the item must have.** An action that takes a pointer may say what the item behind it needs to have on its card for the action to make sense of it: `"needs": ["place"]` (or `date`, `text`, `subtitle`) on the entry in `actions.provides`. A drop menu then leaves the action out for an item without it ("Show on the map" for a task with no position), rather than offering it and failing. It is advice for the menu, not a check the server makes on the request.

**Typed pointers.** A `ref` field may name the kind of item it takes: `"task": "ref:todo:task"` takes only a pointer to a To-do task, plain `"ref"` takes any. Magpie refuses a pointer of another kind. `host.actions.list({ accepts: "module:kind", self: true })` narrows the list to the actions that take a pointer to that kind (an action with plain `ref` counts), and `self` adds this module's own, marked `own: true`.

**What a drop can do.** When another module's item is dropped on yours, never decide on your own what can be done with it: hand it to `host.refs.dropMenu` (see "Dragging" under Refs), which builds your own choices plus every action the modules around you can fill from where it landed, and lets the person choose. Under it, `host.actions.pick(items, point)` is the menu: `items` are `[{ id, label, hint? }]`, it resolves to the chosen item or `null` if dismissed (Escape, or a click elsewhere), one item resolves at once with nothing asked, and `{ remember: "key" }` keeps the choice (in that browser, for your module) and lists it first, marked "last used", the next time the same key is asked. `pick` is also there for a choice that is not a drop. The person always confirms; nothing runs on its own, and two choices that do different things (add it as an event, or set its date) are two items.

**Outcomes.** An event may carry `data` (at most 2 KB). By convention `data.summary` is one line, at most 200 characters, saying how it turned out ("Where to stay: Hotel Nova"). A module that follows an item can keep it: the To-do adds it to a linked task's notes when the task asks for that, and ticks the task when it is set to follow what it links to. Nothing in Magpie knows what a summary means.

**Rules on links.** An event declares the data it carries (`events.publishes[].data`, for example `{ "summary": "string", "pick": "ref?" }`), and `host.refs.kinds()` returns, for each kind, the events it can report with their data. A module that links to items can then let the person choose, per link, what to do when the item reports something, offering only what the event's data supports. The To-do does this: for a linked poll's close it offers to tick the task, add the `summary` to its notes, use it as the title, or link the item in `pick`. By convention `summary` is one line about the outcome and `pick` is a pointer to the item the outcome chose; neither means anything to Magpie. Treat `pick` as untrusted: check the kind is one you may link to.

**Rules that ask other modules.** A rule can also ask another module to do something with what an item reports. The To-do offers, for each action another module provides (from `host.actions.list()`), "Module: what it does" whenever every required field can be filled from the event: a `date` field from the event's `date`, a `string` or `text` field from its `summary`, a plain `ref` field from the item that reported. So a poll that declares a `date` (its winning option's date) and a Calendar that provides `createEvent` are enough for a closed poll to put the winning date on the calendar, with neither module naming the other. The module that follows asks under the person's own rights. The first page to save the rule as fired asks, so however many people have the To-do open the request is made once; that needs `actions.uses` approved by an owner.

**Links on parts of an item.** An item can hold links of its own for its parts. A poll option takes a link (drop an item on it) and the poll passes the winning option's link out as `pick` when it closes. Tell Magpie what the whole item points at with `host.refs.setLinks`, so those items list it under what links to them.

### A dashboard widget

A module with the `server` scope can offer a widget for the dashboard on the rooms page: a small card, across all of the viewer's rooms. Declare `"widget": { "entry": "widget.html", "title": "Coming up", "size": "medium", "order": 10 }` under `surfaces`. The widget is its own single HTML file (in this repository, `src/<id>-widget.html`, `.css` and `.js`, built like the module page), and runs like a server page: `info.context.scope` is `"server"`, `host.storage.list(prefix)` reads the server's data, `host.storage.list(prefix, { scope: 'rooms' })` the module's data in each of the viewer's rooms (each item with its `roomId`), and `host.rooms()` names those rooms and their icons. The widget shows; it does not edit. `host.page.open(hash)` (letters, digits and `= & _ . : , -` only, at most 80 characters) opens the module's own page at a place in it, for a click that means "show me this in full"; the page passes the hash to your module, which reads it with `host.page.onHash(fn)` (the Calendar's month opens a day with `day=2026-09-24`). Clicking an item should call `host.refs.open(ref)`, which takes the person to that item in its room; the card's heading opens the module's full page. A widget in a frame tells the dashboard how tall it is with `host.resize({ height })` (measure your own content, not the frame). Keep it small and quick: it loads with the rooms page. Code the page and the widget share can go in `src/<id>-lib.js`, which the build puts where a script has `/*__LIB__*/`.

### The action bar

A module's buttons go in its action bar, which the host draws. Docked, the bar is a cell in the room's shared bottom row, so it lines up with the video toolbar and the chat box; floating, popped out and on a module's own page it is a strip along the bottom.

```js
host.bar.set([{ id: 'add', label: 'Add event', icon: 'plus', primary: true }]);
host.on('bar', ({ id }) => { if (id === 'add') openEditor(); });
```

Each item has an `id`, a `label` (up to 30 characters), an optional Font Awesome `icon` name, and `primary` and `disabled` flags. Setting an empty list hides the bar, and a docked module then fills the whole column. Set the bar again whenever what the buttons can do changes. More than five collapse into a host-drawn "..." at the end (a quick-add is exempt, and never counts toward the five); mark an item `overflow: true` to always keep it there.

**Overflow.** `header.set`, `bar.set` and `toolbar.set` each show at most five items before folding the rest into a "..." the host draws and opens (an item marked `overflow: true` goes there regardless of how many you set, for something you always want tucked away, like Delete). It is drawn by the host, not `host.menu.show` -- that one draws inside your own module, and a titlebar or bar button is the host's own chrome. You never build it yourself; it is just what setting more items than fit does. See [architecture-module-window](../architecture/architecture-module-window.md) for the shape all four zones follow.

**Text nobody here wrote.** `host.util.esc(text)` makes text safe to put in HTML. `host.util.markdown(text)` turns a small, safe subset of Markdown into HTML: `#`/`##`/`###` headings, `**bold**`, `*italic*`/`_italic_`, `` `code` ``, fenced ` ``` ` code blocks, `-`/`*` and `1.` lists, `> ` quotes, `[text](https://...)` and bare `https://` links (nothing else is ever a link), paragraphs on a blank line. Everything is escaped first, so raw HTML in the text can never reach the page. It is the one place a module may set `innerHTML` from text a person or an AI wrote, because the safety already happened inside it; everywhere else, text still goes in with `textContent`. Use it for an AI's replies, and anywhere else people's own words might use it. The room page uses the very same function for chat (`window.hostText.markdown`, exposed once for the host page itself, since Chat is not a module).

**Places on the earth.** `host.util.geo` holds what a module with places needs, so none carries its own copy: `inRange(lat, lng)`, `round6(n)`, `oneLine(text, max)` (one line, no control characters), `coord(text, 90 | 180)` (a latitude or longitude typed in a field, or null), `parsePoint(text)` (`{ lat, lng }` from a pair of coordinates or a map link, or null), `coordsText(lat, lng)`, `mapsLink(lat, lng, name, apple)` and `mapsSearch(text, apple)` (for a place with only a name or address), the links that open the spot in the person's own maps app: the platform's own link on Apple devices, a `geo:` link on Android, and an ordinary web link (OpenStreetMap) everywhere else, because a desktop browser has nothing registered for `geo:` and would open a blank page.

**Quick add.** An item `{ id: 'add', type: 'quickadd', label: 'Add event', placeholder: 'Add an event: lunch fri at noon' }` is drawn as a text field with a small + button (`icon: 'magnifying-glass'` names another icon for that button), bottom-aligned so it lines up with the chat box. Other items in the same `bar.set` are drawn beside it, and one with `iconOnly: true` and an `icon` is a square icon button whose `label` is its tooltip (for a second action such as adding). Submitting (Enter, or the button, even with nothing typed) sends the `bar` event with `{ id, value }`, the text typed. Open your add form with it filled in, so the person confirms rather than starts over. `host.util.parseWhen(text)` helps: it pulls a date and a time out of what was typed and leaves the rest as the title, so `"meet with bob sep 29 at 7pm"` gives `{ title: "meet with bob", date: "2026-09-29", time: "19:00" }`. It understands today, tomorrow, weekdays ("fri", "next fri"), "sep 29" and "29 sep", "9/29" and "2026-09-29", and times as "7pm", "7:30 pm", "19:00", "at 7", "noon" or "midnight"; a day already passed this year means next year, and anything it does not recognise stays in the title. Use only what your form has a place for.

### Layout

```js
host.setTitle('Calendar');              // the title above the module
host.resize({ width: 500, height: 600 }); // ask a floating panel for a size (page content height, in pixels)
```

### Keyed pages: a page about one person, with no sign-in

A module may claim a path for a **keyed page** (`surfaces.keyed: { path, entry }` in module.json, see [api-modules](api-modules.md)): `/<path>/<key>?s=<access key>&...` shows the module's page about the person with that key, opened with the server's access key in place of a sign-in. It is for something unattended that a person never sits at: the Stream module's `/view/<key>` is a browser source in a streaming program. The page runs in the page (never a frame), on a transparent background with no header, and everything it asks of the host carries the key.

```js
const t = await host.ready();
// t.context  { scope: 'keyed', path: 'view', subject: '<the person's key>', query: { kind: 'player', plate: '1' } }
// t.user     { key: 'viewer', name: 'Viewer', role: 'viewer' }   nobody: every permission is false
```

A keyed page can read its settings and what the SDK offers a page that follows people, nothing else: no storage, no refs, no uploads. `host.settings.onChange` still fires (the host asks after the settings every 10 seconds there, having no session for the event stream).

**Presence.** Who is online and in which call right now, everyone, from any page (a keyed page, a dashboard):

```js
const p = await host.presence.get();
// p.people     [{ key, name, online, room, inCall, isAdmin }]   isAdmin: an owner or the host admin (the name changes in a later release)
// p.rooms      [{ id, name, ephemeral, origin, private }]   an aside is ephemeral with an origin; a private conversation is private
// p.activeRoom the room the stream follows (an owner's or the host admin's), adminOnline whether one is online (both names change in a later release)
// p.reactions  [{ id, glyph }]
const stop = host.presence.onChange((p) => { ... }, { every: 5000 }); // polls; called once at the start and whenever anything differs
```

**Pictures.** One person's picture in a slot, as a blob URL to show, or null when they have none there; release it when you replace it. `{ room }` asks for that room's own picture set first, the way the call page does.

```js
const url = await host.images.get(key, 'player', { room });   // profile, background, player, playerOffline, playerTalking, playerMuted,
host.images.release(url);                                     // playerAside, playerPrivate, character, characterOffline, talking, muted, characterAside, characterPrivate
```

**Media.** Watch one person's camera and microphone, read-only, following them from room to room (a module that runs in the page only, since the elements are handed to you):

```js
const w = await host.media.watch(key, { video: true, audio: false, room: 'lobby' }, {
  state: ({ online, cameraOn, micOn, speaking, name }) => { ... },
  video: (el) => { /* a <video> to place, or null when it went away */ },
  audio: (el) => { /* an <audio> to place, or null */ },
  reaction: (id) => { ... },            // as they react in the call
  connection: ({ connected, room }) => { ... },
});
w.follow(roomId);   // the roster says they moved: leave this room for that one
w.stop();
```

With `video: false` and `audio: false` only the state is followed (the host subscribes to the microphone alone, so it still knows who is talking, and plays nothing). The host reconnects by itself when the connection drops.

**The access key.** On the module's own page (an owner's or the host admin's), `await host.access.key()` is the key a keyed page's link carries (null for anyone else) and `await host.access.regenerate()` makes a new one, after which every link made with the old one stops working.

## Theme

The SDK applies the theme to your page as CSS custom properties on `:root`, so plain CSS follows the theme. **Never hard-code colors, and never assume a dark background.** The tokens and the rules are in [design-theme](../designsystem/design-theme.md). The base stylesheet gives you `.btn`, `.btn-primary`, `.btn-danger`, `.card`, `.section` and styled inputs.

## Running in the page

A module runs in one of two ways. Modules that ship with Magpie run **in the page**: in a container of their own with a shadow root, so their styles and elements stay apart from the page's but they share its window, and can take part in drag and drop between modules. A module an owner uploads runs **sandboxed** (below) unless the owner switches it to run in the page, after a warning that a module in the page is not walled off: it can read and change everything on the page, act as the signed-in person, and is no longer held to its approved permissions, because it can bypass the SDK. Only allow that for a module you trust.

To work either way:

- Look elements up on `host.root` (`host.root.getElementById`, `host.root.querySelector`), never `document`. Use `host.rootElement` where you would use `document.documentElement`, and `host.refs.elementAt(x, y)` where you would use `document.elementFromPoint`.
- Read the API from `document.currentScript.host` when it is set, else from `window.host`.
- A module that runs in the page is built from one HTML file: its `<style>`, its inline `<script>` and its body. Keep the module to a single file with style and script inline.
- Selectors written for `html`, `body` and `:root` are applied to the container.

## The sandbox

A module frame has an opaque origin. From inside it you cannot read Magpie's page, its cookies or storage, call `fetch` or open sockets (`connect-src 'none'`), open windows or dialogs, or send a form anywhere. A `<form>` and its `submit` event work (so `preventDefault()` and handle it yourself), but the form goes nowhere. So use in-page UI, not `alert`, `confirm` or `prompt`. You can use inline scripts and styles, and load your own images and fonts as data URLs or from your own files. Module files are public to anyone who can reach the server, so put nothing secret in them.
