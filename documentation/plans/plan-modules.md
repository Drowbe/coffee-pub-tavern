# Modules Plan

**Audience:** whoever is building on the modules system, and the author deciding what comes next.

**Status:** In progress. Install and approval, the SDK and sandbox, per-scope storage with live changes, the header nav and server page, floating room panels with per-room enablement, module permissions in Roles, schedules and notifications, and the Calendar are built and documented in [architecture-modules](../architecture/architecture-modules.md), [api-module-sdk](../api/api-module-sdk.md), [api-modules](../api/api-modules.md) and [userguide-calendar](../userguides/userguide-calendar.md). What is left is below. Delete this plan when the last item is done or moved to the TODO.

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

## Google Calendar sync

Wanted: the Calendar keeps in step with Google Calendar. This is not something a front-end-only module can do: it needs OAuth credentials the admin creates in Google Cloud, tokens kept on the server, and calls to Google's Calendar API that run when nobody has a page open. It needs a decision on shape before it is built:

- **Whose Google account.** One shared account the admin connects (simple; the server calendar mirrors it), or each person connecting their own (their events into their view, needing per-person tokens).
- **Direction.** Google into Tavern only (read-only import), Tavern out to Google, or both ways (needs conflict rules and a stable id on each side).
- **Where the code lives.** A new declarative hook, such as `integration: "google-calendar"`, that Tavern implements (the module stays front-end only and the admin approves it), or a core Tavern feature with the Calendar as its client.
- **Setup burden.** A self-hosted install would have to register its own Google OAuth client and add Tavern's redirect address, which is real work for an admin; document it step by step.

The API is at https://developers.google.com/workspace/calendar/api/guides/overview.
