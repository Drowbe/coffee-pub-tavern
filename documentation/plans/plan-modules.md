# Modules Plan

**Audience:** whoever is building on the modules system, and the author deciding what comes next.

**Status:** In progress. Install and approval, the SDK and sandbox, per-scope storage with live changes, the header nav and server page, floating room panels with per-room enablement, module permissions in Roles, schedules and notifications, and the Calendar are built and documented in [architecture-modules](../architecture/architecture-modules.md), [api-module-sdk](../api/api-module-sdk.md), [api-modules](../api/api-modules.md) and [userguide-calendar](../userguides/userguide-calendar.md). What is left is below. Delete this plan when the last item is done or moved to the TODO.

## Decisions that still apply

- Front-end only, in a sandbox, plus declarative hooks Tavern runs. No module code on the server.
- Room modules are off in a room until an admin turns them on there.
- A module's permissions appear in the Roles grid; the server enforces them on every call.
- The admin trusts what they upload; the install step shows what a module asks for.
- Reminders are in-app only for now (toast plus unread counts); email needs SMTP and is a later step.
- Modules may float over the call or dock as a column (both declared in the manifest). Only floating exists.

## Left to build

1. **Docking.** Let a module's panel take a column of the room grid, with its own content area and action bar, following [plan-room-layout](plan-room-layout.md) step 6. The manifest already accepts `"mode": ["float", "dock"]`; nothing reads `dock` yet. Needs the host to draw the module's header at the shared height and to clamp the module's bar height.
2. **Travel planner.** The second module: several people editing one plan live. It exercises the shared store with many writers; expect to find where last-write-wins per key is not enough, and to want finer change events.
3. **A hello module** as the smallest working example next to the Calendar.
4. **Reminders while away.** Notifications wait for people who are away (up to 50 each) but nothing tells them; email or push would.
5. **Calendar improvements.** Repeating events, events across several days, and a per-person view of reminders.
