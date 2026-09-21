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

- **Audit and limits.** Cross-module calls (a request, an event, a link) are attributed to the person and the module, but not yet rate limited or listed anywhere; show them on a module's card on the Modules tab, and cap how fast one module may publish or ask.
- **More of the same, to prove it.** The Calendar could provide a `createEvent` action and take part in the To-do's due dates; each new provider should appear in other modules' buttons with no change to them, which is the test.
- **Shared shapes.** Modules choose their own field names, so an action that fills "a title" relies on a field named `title`. If that proves too loose, the core could publish a few standard field names (title, when, notes, ref) for modules to agree on.
- **Verify in a real browser** with two people: an event reaching a module that is open in another person's browser, and two people with the same module open both seeing an action (only one should carry it out).

## Google Calendar sync

Wanted: the Calendar keeps in step with Google Calendar. This is not something a front-end-only module can do: it needs OAuth credentials the admin creates in Google Cloud, tokens kept on the server, and calls to Google's Calendar API that run when nobody has a page open. It needs a decision on shape before it is built:

- **Whose Google account.** One shared account the admin connects (simple; the server calendar mirrors it), or each person connecting their own (their events into their view, needing per-person tokens).
- **Direction.** Google into Tavern only (read-only import), Tavern out to Google, or both ways (needs conflict rules and a stable id on each side).
- **Where the code lives.** A new declarative hook, such as `integration: "google-calendar"`, that Tavern implements (the module stays front-end only and the admin approves it), or a core Tavern feature with the Calendar as its client.
- **Setup burden.** A self-hosted install would have to register its own Google OAuth client and add Tavern's redirect address, which is real work for an admin; document it step by step.

The API is at https://developers.google.com/workspace/calendar/api/guides/overview.
