# Modules Plan

**Audience:** whoever is building on the modules system, and the author deciding what comes next.

**Status:** In progress. Install and approval, the SDK and sandbox, per-scope storage with live changes, the header nav and server page, floating room panels with per-room enablement, module permissions in Roles, schedules and notifications, the Calendar, the To-do module and Polls are built and documented in [architecture-modules](../architecture/architecture-modules.md), [api-module-sdk](../api/api-module-sdk.md), [api-modules](../api/api-modules.md) and [userguide-calendar](../userguides/userguide-calendar.md) and [userguide-todo](../userguides/userguide-todo.md) and [userguide-polls](../userguides/userguide-polls.md). What is left is below. Delete this plan when the last item is done or moved to the TODO.

## Decisions that still apply

- Front-end only, in a sandbox, plus declarative hooks Tavern runs. No module code on the server.
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

**Status:** built, and documented in [api-module-sdk](../api/api-module-sdk.md) and [architecture-modules](../architecture/architecture-modules.md): refs (pointers resolved into cards), opening an item in the module that owns it, links and backlinks, events, and actions, all declared in `module.json`, approved by an admin where a module reaches for another's, and carried by Tavern without any module named in Tavern's code. The Calendar, Polls and To-do use them (a poll closing ticks a task that follows it; a finished poll offers "Add a task" from whatever module provides it). What is left:

- **Audit and limits.** Built: the activity list is kept across restarts and the API is rate limited per module and person. Left: show a module's own recent activity on its card on the Modules tab.
- **More of the same, to prove it.** The Calendar could provide a `createEvent` action and take part in the To-do's due dates; each new provider should appear in other modules' buttons with no change to them, which is the test.
- **Shared shapes.** Modules choose their own field names, so an action that fills "a title" relies on a field named `title`. If that proves too loose, the core could publish a few standard field names (title, when, notes, ref) for modules to agree on.
- **Verify in a real browser** with two people: an event reaching a module that is open in another person's browser, and two people with the same module open both seeing an action (only one should carry it out).

## Google Calendar sync

Decided and planned in [plan-google-sync](plan-google-sync.md): one way, Google into Tavern, each person connecting their own account, kept and fetched on the server. It needs a Google Cloud OAuth client from the admin before it can be built and run.

## The host is not the brand (decided September 23, 2026)

The object a module talks to -- the thing that mounts it, keeps its data, brokers its pointers and actions, draws its titlebar, toolbar and menus, and delivers drags to it -- has been called `tavern` in code since the first module, because `window.host` was the obvious global on day one. That bound an API contract to a brand: renaming the product would have broken every module. The architecture documents always called this thing **the host**, and the code now does too.

**Decided.**
- The platform vocabulary is *host*: `host.refs`, `host.storage`, `host.toolbar.set`, `host.ready()`, `/sdk/host.js` and `/sdk/host.css`, `createHost(env)`, `window.hostModules` for tests, `data-host-sdk` on the page's script tag, `[host]` in the trace. A module reads its SDK as `document.currentScript.host || window.host`.
- What the SDK draws inside a module carries `sdk-` (`sdk-menu`, `sdk-menu-item`...), telling it from `host-menu`, the host's own overflow drawn outside the module's frame -- the one place the distinction matters.
- Keys and events the pages keep are namespaced neutrally: `app.panels.<space>`, `app.debug`, `app:pick:<kind>:<place>`, the `app:unread` event. A page reads an old `host.*` key once and moves it, so nobody's layout is lost.
- **A clean break, no alias.** There are no third-party modules yet and the product is at 0.3: an alias would be compatibility for nobody, carried for years, and every addition made in the meantime would have made the break dearer. The one cost is that a module written against `host.*` before this date must be edited; the bundled ones were, in the same change.
- The product's name stays where a name belongs: the server-name default, the page titles, the About tab, the repository, the data file, the session cookie's name (a rename there would sign everyone out for nothing). Those are the brand, and a rebrand touches only them.

**Not decided:** the product's next name. That is now a separate question the platform never hears about.
