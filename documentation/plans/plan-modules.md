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
2. **Travel planner.** The second module: several people editing one plan live. It exercises the shared store with many writers; expect to find where last-write-wins per key is not enough, and to want finer change events.
3. **A hello module** as the smallest working example next to the Calendar.
4. **Reminders while away.** Notifications wait for people who are away (up to 50 each) but nothing tells them; email or push would.
5. **Calendar improvements.** Events across several days, changing or skipping a single occurrence of a repeating event, and a per-person view of reminders.

## Module interoperability

**Status:** the first piece is built: refs (declared, approved pointers that the core resolves into cards; see [api-module-sdk](../api/api-module-sdk.md) and [architecture-modules](../architecture/architecture-modules.md)). The Calendar, Polls and To-do use them: a task can link to an event or a poll. Also built, on the same generic conduits: opening an item in the module that owns it, links that the item pointed at can ask about (backlinks), and consuming `"*"` so a module can link to modules written later. Still open: modules reacting to each other (a task ticking itself when a poll closes) and modules asking each other to create things (a poll's winner becoming an event). The rule for both is the same as for refs: Tavern must not be coded for particular modules. Sketch: a module declares in `module.json` the events it publishes (`events.publishes`: a name and a small typed payload, for example `closed` on a `poll`) and the events it wants to hear (`events.subscribes`, approved by an admin like `refs.consumes`); a module publishes with `tavern.events.publish`, Tavern delivers it to subscribers who could see the item (the same viewer checks as a card), and a subscriber decides what it means. Asking another module to create something is the same shape in reverse: a module declares an action it accepts (`actions`: a name and a payload shape), another asks for it, and the request is delivered to the owner (queued in its data when nobody has it open), which performs it under its own rules. Neither names a module in Tavern. Wanted: the core API manages how modules work together and exchange data, so a poll's winner can become a Calendar event or a to-do, and a to-do's due date can show on the Calendar. This is not built and needs design. Today a module sees only its own storage (plus, on its server page, its own data across the viewer's rooms), and the sandbox gives modules no way to reach each other; that is deliberate and stays. The exchange goes through the core.

A sketch to react to:

- **Shared types owned by the core.** The core defines a few stable shapes that modules exchange (an event with a title, start, end and repeat; a task with a title and due date; a room; a person), so modules do not each invent their own.
- **Declared, approved capabilities.** A manifest lists what it `provides` (for example `calendar.createEvent`) and what it `uses`. Using another module's capability is approved by the admin when the module is enabled, like permissions and hooks are.
- **Calls the core routes.** A module asks the SDK for a capability; the core checks that the caller may use it and that the person may do the thing in the provider (its own permissions apply), and hands the request to the provider. Modules are front-end only, so the open question is how a provider handles a request while nobody has its page open. Likely answer: the core keeps the request in the provider's data as a queue the provider's page drains, or, for the shared types, the core owns the collection itself (events, tasks) and modules read and write it under their permissions.
- **Events.** A module can publish a named event (`poll.closed` with the winner) and others can subscribe to it, declared in the manifest, delivered through the core with the same permission checks.
- **Audit and limits.** Cross-module calls are attributed to the person and the calling module, rate limited, and visible on the Modules tab.

First uses to design against: Polls to Calendar (book the winning date) and to To-do (a task to book it), and To-do to Calendar (show due dates).

## Google Calendar sync

Wanted: the Calendar keeps in step with Google Calendar. This is not something a front-end-only module can do: it needs OAuth credentials the admin creates in Google Cloud, tokens kept on the server, and calls to Google's Calendar API that run when nobody has a page open. It needs a decision on shape before it is built:

- **Whose Google account.** One shared account the admin connects (simple; the server calendar mirrors it), or each person connecting their own (their events into their view, needing per-person tokens).
- **Direction.** Google into Tavern only (read-only import), Tavern out to Google, or both ways (needs conflict rules and a stable id on each side).
- **Where the code lives.** A new declarative hook, such as `integration: "google-calendar"`, that Tavern implements (the module stays front-end only and the admin approves it), or a core Tavern feature with the Calendar as its client.
- **Setup burden.** A self-hosted install would have to register its own Google OAuth client and add Tavern's redirect address, which is real work for an admin; document it step by step.

The API is at https://developers.google.com/workspace/calendar/api/guides/overview.
