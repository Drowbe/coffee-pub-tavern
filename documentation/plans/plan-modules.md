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
2. **A hello module** as the smallest working example next to the Calendar.
3. **Reminders while away.** Notifications wait for people who are away (up to 50 each) but nothing tells them; email or push would.
4. **Calendar improvements.** Changing or skipping a single occurrence of a repeating event, and a per-person view of reminders.

## Module interoperability

**Status:** built, and documented in [api-module-sdk](../api/api-module-sdk.md) and [architecture-modules](../architecture/architecture-modules.md): refs (pointers resolved into cards), opening an item in the module that owns it, links and backlinks, events, and actions, all declared in `module.json`, approved by an admin where a module reaches for another's, and carried by Tavern without any module named in Tavern's code. The Calendar, Polls and To-do use them (a poll closing ticks a task that follows it; a finished poll offers "Add a task" from whatever module provides it). What is left:

- **Audit and limits.** Built: the activity list is kept across restarts and the API is rate limited per module and person. Left: show a module's own recent activity on its card on the Modules tab.
- **More of the same, to prove it.** The Calendar could provide a `createEvent` action and take part in the To-do's due dates; each new provider should appear in other modules' buttons with no change to them, which is the test.
- **Shared shapes.** Modules choose their own field names, so an action that fills "a title" relies on a field named `title`. If that proves too loose, the core could publish a few standard field names (title, when, notes, ref) for modules to agree on.
- **Verify in a real browser** with two people: an event reaching a module that is open in another person's browser, and two people with the same module open both seeing an action (only one should carry it out).

## Google Calendar sync

Decided and planned in [plan-google-sync](plan-google-sync.md): one way, Google into Tavern, each person connecting their own account, kept and fetched on the server. It needs a Google Cloud OAuth client from the admin before it can be built and run.
