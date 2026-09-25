# Modules Plan

**Audience:** whoever is building on the modules system, and the author deciding what comes next.

**Status:** In progress. Install and approval, the SDK and sandbox, per-scope storage with live changes, the header nav and server page, floating room panels with per-room enablement, module permissions in Roles, schedules and notifications, the Calendar, the To-do module and Polls are built and documented in [architecture-modules](../architecture/architecture-modules.md), [api-module-sdk](../api/api-module-sdk.md), [api-modules](../api/api-modules.md) and [userguide-calendar](../userguides/userguide-calendar.md) and [userguide-todo](../userguides/userguide-todo.md) and [userguide-polls](../userguides/userguide-polls.md). What is left is below. Delete this plan when the last item is done or moved to the TODO.

## Decisions that still apply

- Front-end only, in a sandbox, plus declarative hooks Magpie runs. No module code on the server.
- Room modules are off in a room until an admin turns them on there.
- A module's permissions appear in the Roles grid; the server enforces them on every call.
- The admin trusts what they upload; the install step shows what a module asks for.
- Reminders are in-app only for now (toast plus unread counts); email needs SMTP and is a later step.
- Modules may dock as a column, float over the call, or pop out into a window of their own; the manifest says which of dock and float it supports.

## Left to build

1. **Google Calendar sync.** See the section below.
2. **Travel planner.** Planned in [plan-travel](plan-travel.md). The second module: several people editing one plan live. It exercises the shared store with many writers; expect to find where last-write-wins per key is not enough, and to want finer change events.
3. **A hello module** as the smallest working example next to the Calendar.
4. **Reminders while away.** Notifications wait for people who are away (up to 50 each) but nothing tells them; email or push would.
5. **Calendar improvements.** Events across several days, changing or skipping a single occurrence of a repeating event, and a per-person view of reminders.

## Module interoperability

**Status:** built, and documented in [api-module-sdk](../api/api-module-sdk.md) and [architecture-modules](../architecture/architecture-modules.md): refs (pointers resolved into cards), opening an item in the module that owns it, links and backlinks, events, and actions, all declared in `module.json`, approved by an admin where a module reaches for another's, and carried by Magpie without any module named in Magpie's code. The Calendar, Polls and To-do use them (a poll closing ticks a task that follows it; a finished poll offers "Add a task" from whatever module provides it). What is left:

- **Audit and limits.** Built: the activity list is kept across restarts and the API is rate limited per module and person. Left: show a module's own recent activity on its card on the Modules tab.
- **More of the same, to prove it.** The Calendar could provide a `createEvent` action and take part in the To-do's due dates; each new provider should appear in other modules' buttons with no change to them, which is the test.
- **Shared shapes.** Modules choose their own field names, so an action that fills "a title" relies on a field named `title`. If that proves too loose, the core could publish a few standard field names (title, when, notes, ref) for modules to agree on.
- **Verify in a real browser** with two people: an event reaching a module that is open in another person's browser, and two people with the same module open both seeing an action (only one should carry it out).

## Google Calendar sync

Decided and planned in [plan-google-sync](plan-google-sync.md): one way, Google into Magpie, each person connecting their own account, kept and fetched on the server. It needs a Google Cloud OAuth client from the admin before it can be built and run.

## The host is not the brand (decided September 23, 2026)

The object a module talks to -- the thing that mounts it, keeps its data, brokers its pointers and actions, draws its titlebar, toolbar and menus, and delivers drags to it -- has been called `magpie` in code since the first module, because `window.host` was the obvious global on day one. That bound an API contract to a brand: renaming the product would have broken every module. The architecture documents always called this thing **the host**, and the code now does too.

**Decided.**
- The platform vocabulary is *host*: `host.refs`, `host.storage`, `host.toolbar.set`, `host.ready()`, `/sdk/host.js` and `/sdk/host.css`, `createHost(env)`, `window.hostModules` for tests, `data-host-sdk` on the page's script tag, `[host]` in the trace. A module reads its SDK as `document.currentScript.host || window.host`.
- What the SDK draws inside a module carries `sdk-` (`sdk-menu`, `sdk-menu-item`...), telling it from `host-menu`, the host's own overflow drawn outside the module's frame -- the one place the distinction matters.
- Keys and events the pages keep are namespaced neutrally: `app.panels.<space>`, `app.debug`, `app:pick:<kind>:<place>`, the `app:unread` event. A page reads an old `host.*` key once and moves it, so nobody's layout is lost.
- **A clean break, no alias.** There are no third-party modules yet and the product is at 0.3: an alias would be compatibility for nobody, carried for years, and every addition made in the meantime would have made the break dearer. The one cost is that a module written against `host.*` before this date must be edited; the bundled ones were, in the same change.
- The product's name stays where a name belongs: the server-name default, the page titles, the About tab, the repository, the data file, the session cookie's name (a rename there would sign everyone out for nothing). Those are the brand, and a rebrand touches only them.

**Not decided:** the product's next name. That is now a separate question the platform never hears about.

## Addendum: the Lobby is for being together (decided September 25, 2026)

**Status:** decided 2026-09-25; not built. GitHub issue #63.

### The decision

Thomas: "in the default space, we only ever offer chat, conference, and calendar. This is not a 'do stuff' room. It is pure social."

- **A hard rule.** Templates, owners and a module's "every space" never put other modules in the Lobby.
- **Generic.** A module declares in its manifest that it belongs in the Lobby; the Calendar declares it. Nothing in the code names the Calendar.
- **Chat and the conference** are built in and allowed there: chat always, the conference only while the environment has it on (decision 3 below).
- **Any other module is refused in the Lobby** with a plain sentence, and Manage no longer offers it there.
- **On upgrade**, any other module on in the Lobby is switched off there only: it stays on in every other space, and its data is kept.
- **Templates**: a template's modules go on in every space except the Lobby. The Lobby's name and description still come from the template.

### What it is today

A module is on in a space when its registry entry has `allSpaces: true` or lists the space in `spaces` (`server/modules.js:1022`, `1067`). The server repeats that check in four places: `moduleSpaceAccess()` (`server/index.js:3083`), the environment page's reads across spaces (`3250`), the space settings a module shows (`4340`) and the live change stream (`4620`). The Lobby (`LOBBY`, id `lobby`) is treated like any space. Manage's Modules tab has "Available in every space" (`public/admin.js:941`), and a space's settings page lists every enabled module with the space scope as a tick box (`public/space-settings.js:161-174`). "Join with" and the canvas list what `GET /api/modules/for-space` answers (`server/index.js:4387`).

### The contract

- **The manifest field: `surfaces.canvas.lobby: true`.** It sits with the canvas surface, since what it allows is being on the Lobby's canvas. Absent or false means the module is never on in the Lobby. It asks for no approval: it narrows where a module can be, and widens nothing. The Calendar's `module.json` declares it, with a version bump.
- **What `allSpaces` means.** Unchanged in storage. It means "every space this module may be in": for a module with `lobby: true`, every space including the Lobby; for any other, every space but the Lobby. No separate Lobby flag is stored.
- **One check.** A single helper in `server/modules.js` answers whether a module is on in a space (`allSpaces` or `spaces`, and the Lobby only with `lobby: true`). The four places above use it, so the rule holds everywhere at once: the canvas, "Join with", pop-outs, a module's settings for the space, its data read across spaces, and its live changes.
- **Refusals.**
  - `PATCH /api/modules/:id` with `spaces` including `lobby`, for a module without `lobby: true`, answers 400: "<Module> can't be turned on in <Lobby's name>, which is kept for chat, the call and a few modules made for it." `<Module>` is the display name; `<Lobby's name>` is the Lobby's stored name ("Home base" under the travel template).
  - `GET /api/modules/for-space?space=lobby` never lists such a module, and loading one there (`/modules/<id>?space=lobby`) answers 404 with the same sentence.
  - A template or a switch never adds `lobby` to `spaces`. Its `allSpaces: true` already leaves the Lobby out.
- **The upgrade: a startup sync, not a migration part.** Every environment build removes `lobby` from the `spaces` of any module without `lobby: true`, and logs what it switched off there ("Todo is no longer on in the Lobby; it stays on in its other spaces."). No `allSpaces` value changes. The same sync handles a module whose new version drops the flag. A startup sync is the recommendation because the rule can be broken again by a module update, not only once by the upgrade; a recorded part would be refused by an older build (plan-names decision 22) for a change that is not about names.
- **Data.** A module's data for the Lobby (`modules/<id>/data/space-lobby.json`, its uploads) is kept, untouched, and shown nowhere, the module's environment page included (decision 2 below).
- **What people see.**
  - **Manage > Modules.** "Available in every space" stays. For a module without `lobby: true`, its hint says "(not in <Lobby's name>)".
  - **The Lobby's settings page** lists only modules with `lobby: true`.
  - **"Join with" on the Lobby's card** lists Chat, the Conference when the environment has it on, and the Calendar when it is on there; nothing is turned on to fill it.
  - **The dashboard's widgets** are the environment's, not the Lobby's, and are unchanged.
  - **A browser's remembered layout** for the Lobby (`app.canvas.lobby`) that names a module no longer offered simply does not open it.

### Left to build, in order

1. **The server** (server-development). The manifest field and its check, the one helper used in the four places, the refusals, and the startup sync with its log line. The Calendar gets `lobby: true` and a version bump.
   - Done when: `npm run check` passes, with `check-modules` covering the field, the helper, the refusal and the sync.
   - Verify: checked by the tool. Live on a throwaway `DATA_DIR` under `/tmp` whose registry has To-do on in the Lobby and in another space, and Polls in every space:
     - after a start, To-do is off in the Lobby and still on in the other space, its Lobby data file still there;
     - Polls is in every space but the Lobby;
     - the Calendar is still allowed in the Lobby;
     - turning To-do on in the Lobby answers the sentence;
     - a travel environment made on `BASE_DOMAIN=localhost` has its modules in a new trip but not in "Home base".
2. **The pages** (experience-design). Manage's hint, the Lobby's settings page listing only the modules allowed there, and "Join with" (it already follows `for-space`).
   - Verify: live in a browser on the same servers; nothing here needs a call.

### Decided (2026-09-25)

Thomas answered the addendum's questions:

1. **The field is `surfaces.canvas.lobby`.**
2. **Other modules' Lobby data is kept and shown nowhere.** The module's environment page does not read it either.
3. **What the Lobby allows, and what it honours.** Thomas: "Chat, conf, and calendar... but we do still honor if they have any of them turned off. (remember, there was a todo to be able to turn off conf as a module, the only 'required' is chat)". So the Lobby allows:
   - **Chat**, always; it is the only required one;
   - **the conference**, only while the environment has it on (`conferenceEnabled` today, and its switch as a module later, per [plan-optional-conference](plan-optional-conference.md));
   - **the Calendar**, through `surfaces.canvas.lobby`, only while it is installed and on there.

   Nothing forces any of them on: the rule only keeps other modules out. Only the Calendar declares the field.
