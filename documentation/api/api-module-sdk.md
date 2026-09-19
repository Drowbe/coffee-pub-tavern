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

A small key-value store per module, with a scope: the whole **server**, or one **room**. A page uses its own scope (`'context'`, the default). A room panel may also ask for `{ scope: 'server' }` to read server data.

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

## The sandbox

A module frame has an opaque origin. From inside it you cannot read Tavern's page, its cookies or storage, call `fetch` or open sockets (`connect-src 'none'`), open windows or dialogs, or send a form anywhere. A `<form>` and its `submit` event work (so `preventDefault()` and handle it yourself), but the form goes nowhere. So use in-page UI, not `alert`, `confirm` or `prompt`. You can use inline scripts and styles, and load your own images and fonts as data URLs or from your own files. Module files are public to anyone who can reach the server, so put nothing secret in them.
