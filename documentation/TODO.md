# To do

Things agreed on but not built yet, roughly in order. See the Studio repo's own TODO.md
for that app's side of things (Windows OBS capture work, mainly).

## Names: renaming the code

Decided (September 24, 2026; plans/plan-names.md): the code, routes, API fields, stored keys and documents
take the architecture's names (host, environment, space, aside, canvas, module, object; admin, owner,
moderator, member, guest), with a recorded data migration and redirects for saved links. Ten steps, in
order:

1. The check and the migration's frame. **Built** (September 24, 2026).
2. Environment: the host-level migration part, `/api/host/environments`, the console's code names.
   **Built** (September 24, 2026).
3. Table out, and the call's name. **Built** (September 24, 2026).
4. Roles: `owner`, `member` and the host's stand-in `admin`. **Built** (September 24, 2026).
5. Space and the environment scope: the server and data (5a, **built** September 24, 2026), the pages (5b,
   **built** September 25, 2026), the SDK, the manifest and the bundled modules (5c, **built**
   September 25, 2026).
6. Canvas and module.
7. Object.
8. Asides.
9. The documentation: renamed files and wiki pages, and the text.
10. The aliases go, once a Coffee Pub Studio release reads the new names.

Open, found while building steps 1 to 4:

- A check that compiles every `pattern` attribute in `public/*.html` and in the pages' JS templates with the
  `v` flag, as browsers do, so a pattern that breaks there is caught (today's: `host.html:107`,
  `host.html:134`, `landing.html:122`, `mfa-enrol.js:31`).
- `host.js`'s Save plans still falls back to the plan's id (`v('name') || id`) when the name is blank. That
  can no longer happen, since a blank name is refused, so the fallback can go.
- On the host console, the shared top bar makes requests that answer 404 there. This was so before the
  Names plan.

Next: [environment templates](plans/plan-environment-templates.md), reworked on top of this plan, builds right
after step 5c.

## Entering a space, and the first time

Decided (September 24, 2026; plans/plan-entering.md): Enter is the primary action and the call is its own
control inside the space, with an owner-set "Opens with" for each space (#3); guidance in the page, a
welcome card for each role and each space, and a setup checklist for a new owner (#2). Part 1 waits for
Names steps 5b and 6; part 2 waits for Names steps 4 and 5b, and part 1.

## Object status: action required, tentative, confirmed

Decided (September 24, 2026; plans/plan-object-status.md): a status in the shared object summary, drawn by
the SDK, with the Planner first: a filter and "Needs action" in Decisions (#12). Waits for Names step 7.
Planner changes shown in the Calendar (#13) builds on it and is not planned yet.

## Two-step sign-in: what is left

Built (September 24, 2026; plans/plan-mfa.md): codes from an authenticator app, recovery codes, the
policy per environment and for host admins, the remembered browser, the encrypted secrets, resets by
an owner or a host admin, and the server's `ENABLE_MFA` and `ADMIN_MFA_LOCKOUT_BYPASS` switches. Left: passkeys as the
second phase (the plan names the shape), and the Studio app's own change to ask for the code when
`POST /api/login` answers `mfaRequired` (it has been told).

## Room layout: walk it in a real call

The grid, the floating popout bar, the narrow-window switch and the header-height check are built and were only checked in a browser with the call unavailable. In a real call, try: chat open and closed; dragging the chat edge; fullscreen; popped out with chat open and closed; a narrow window and a phone; the grid, strip and spotlight layouts; and the reactions tray, settings popovers, overflow menu, aside and recall overlays and the away prompt in each. Docked modules are covered by the modules walk below.

## Modules: walk them in a real server and call

Built and only checked in a browser with the LiveKit connection unavailable, and never with two people: install, enable and disable a module; the Roles grid rows a module adds; the header nav item and the server page; the Modules button and panes in a real call (docked beside the video and chat, drag its edge, switch to floating and back, open in its own window, several open at once, the call itself popped out); per-room enablement from a room's page; the toast, unread counts and reminders reaching a second person; live changes appearing on a second browser; a guest seeing a room module. Also confirm in a real Chrome and Safari that a sandboxed module frame renders and the SDK connects (the built-in preview browser refused subresource loads from a sandboxed frame, so modules are inlined and the SDK is injected). Verify with two browsers on a real server.

## Canvas: video as a pane

Make the conference a pane like chat and the modules, so a person can join with only chat, or chat and the Calendar. Decisions, progress and the four stages are in plans/plan-canvas.md. All four stages are built and need real calls and real windows to verify: close and rejoin the conference; the other person's tile leaving and returning; chat with no conference; a role without the conference; an aside with someone out of the conference; the conference floating and in its own window (tiles and audio after the move, hotkeys, popovers); the whole app popped out (the header and pane icons, idle sliding, full screen, header links); a module window's dock and float buttons; and Join with and the remembered layout across a reload, a dropped connection and a real leave. Then delete the plan.

## Stage: a snap-to-grid layout

Built (September 2026): a floating pane has a toggle, **free** (anywhere over the stage, any
size) or **snap** (it sits in the cells of a 2D grid over the stage, moves and grows a cell at
a time, and keeps its cells when the window changes size), plus a stage-level switch in the
room bar that snaps every floating pane, now and later, and a slider for the grid's size.
Docked and window are untouched; snap is a way of floating, not a replacement for docking.
See "Free or snapped" in architecture-room-layout.md. Only checked in a browser with the call unavailable (the chat
pane, floating over the room list): try it in a real call, with a module pane and the chat
both snapped, and with the call popped out.

Left from the idea: the same drag-to-snap mechanism laying out the rooms (dashboard) page --
a room card there is a static tile, not a live pane, so the generic snap (`snapGrid`,
`snapCell`, `cellBox` in `public/canvas.js`) would need lifting out of the pane
manager first rather than assuming identical reuse. And a 2D equivalent of the dock's "one
flexible column never leaves a gap" rule, if snapped panes should ever tile the stage
exhaustively rather than sit where they were put.

## Ideas and open questions

Collected, none started:

- A module for Foundry that carries communication and commands between Magpie and Foundry.
- An LLM module.
- A module for WhatsApp or SMS hooks.
- Updating modules that do not ship with Magpie without uploading a zip: a module could name an update address (a GitHub release, say) that the server checks and installs from, with the same approval. Bundled modules already update from Manage.
- The dashboard: built (see plans/plan-dashboard.md). Left: customising the layout, and checking it with two people and in a real call.
- Module interoperability is built (refs, opening, backlinks, events, actions). What is left is in plans/plan-modules.md: a module's own activity on its card, and verifying with two people. Also verify in a real browser: dragging an event or a poll from one pane onto a task in another, and between windows.
- Storage and transport of sensitive data such as passwords: to discuss before any module handles it.
- Call time in the conference titlebar.
- Reduce the height of the header a bit.

## Spaces: the documentation, and the internals

Replaced by the Names plan above (September 24, 2026): the internals do follow, and the documents are its step 9. Kept for the record: decided (September 23, 2026): rooms are **spaces** in everything a person reads. The pages and modules say so now; the code, routes, API fields and stored data keep `room` on purpose (nothing stored or linked changes). Left: the user guides and the architecture documents still say "room" throughout, and should follow in one pass, keeping code identifiers (`roomId`, `/rooms/:id`, `scope: 'room'`) as they are and changing only the prose; and whether the internals ever follow (a rename of routes and fields is a compatibility question, not a wording one: only with a migration and only if it earns it). "The table" and "the Lobby" stay as they are.

## The theme editor: the nav colours

`--nav-primary-bg`, `--nav-primary-edge-bg` and `--nav-secondary-bg` derive from the header colour until a theme sets them, but Manage > Theme has no fields for them yet (the seven colours plus the header, buttons and icons). Add them to the "Header, buttons and icons" group with Auto boxes like the others.

## A Journal module

Not started. A journal is where what *happened* is kept, as against the Planner, which is where
what is planned is decided: the record of experiences, made while they happen and read after.
It is not only for travel -- a campaign, a season, a project, a year can each have one -- but the
trip is the first case, and there it sits beside the Planner the way the Trips widget does: for
each day of the trip, the photos taken, the notes written and the badges earned (a place reached,
a booking done, a first of something), gathered for reading after the trip is over.

Shape agreed on so far:

- **Entries by day**, each with images, text and badges; the trip's days (and anything the Planner
  already knows about a day: the flight, the hotel, the stops) give the journal its spine, through
  the pointers modules already share, never a copy of the plan.
- **Read after.** The point is consumption afterwards: a way to read the whole journal as a book
  (an export, printable or as a document) and to put it on a site of one's own (a blog-style
  export, one post per day or per entry). The formats are a later decision; the entries hold enough
  (a date, a place, text, images, who) that any format can be built from them.
- **Live, optionally.** A journal can post as it goes: each new entry going out as it is written,
  for people following along, rather than only being read at the end. Where it posts (the room's
  chat, a feed, elsewhere) is a conduit the module declares, not a specific service it names.
- **Generic first.** Nothing in it should be travel-only: a badge is a badge, a day is a day. The
  Planner is one source of days and things to write about; anything with dates could be another.

Questions to settle before building: what a badge is and who awards it (a person, the module
itself on some event, another module through an action); whether an entry is one person's or the
room's (probably both, like Research's Mine and This room); and how far "live" goes on day one
(the room's chat is the obvious first place).

## Money: a trip's currency with the conversion beside it

Decided: amounts show in the trip's own currency (the country's) with the conversion into the server's currency next to it where possible. Built: the server's currency (Manage > Settings > Language, time and money), and the trip's own currency, each shown on its own. Not started: the conversion, which needs a source of daily exchange rates the server can fetch (a free public feed; pick one and decide how stale a rate may be before it is left off), and then `host.util.money` gains an optional second currency to show beside the first. Language has one option (English) until there are translations to choose from.

## Google Calendar sync

Decided: one way, each person connects their own account (see plans/plan-google-sync.md). Not started: it needs a Google Cloud OAuth client (client id and secret) from the admin before it can run against Google.

## Font Awesome Pro package

Built: an admin's own Pro package at `DATA_DIR/fontawesome-pro/` is served and looked up ahead
of the bundled Free set, falling back to Free for anything it lacks (see
userguide-server-settings.md). Not started: actually getting the package onto the server.
Sign in to the Font Awesome account, download the Pro "Web" package (`css/`, `webfonts/`,
`svgs/`), and copy that folder to the server's `DATA_DIR/fontawesome-pro/`, then restart.
Untested against a real download: the code was verified against a stand-in folder of the
same shape, not an actual Pro package, so the first attempt may need a small fix if the real
download's layout differs.

## Planner (the Travel module): what is left

Built: the Days and Decisions views, the trip, items, moves, suggestions from other modules and the Trips card (see plans/plan-travel.md). Left: a map, reading confirmation emails, and checking it with two people in a real call (drag out and the drop menu on items have only been run as code).

## Modules: what is left

See plans/plan-modules.md: Google Calendar sync, the Travel planner, a hello example, reminders for people who are away, and Calendar improvements.

## Modules: HTTP connection count

Each open module frame holds up to two server-sent event streams, and each page holds one for notifications. On plain HTTP/1.1 a browser allows about six connections per host across all tabs, so a few tabs with a few modules open could stall. Behind an HTTP/2 proxy it is not a problem. Check the behind-a-proxy setup, and if it matters, share one stream per page.

## Architecture: a list is not an editor

A list view's job is to show what exists and let you pick one -- not to host a form for
editing it. Click an item, land on a page that is *about that one thing*. Users worked
this way first (`/profile/<key>`, replacing a flat admin table full of per-row fields);
rooms now work the same way (`/rooms/<id>`, replacing per-card fields and a member
checklist grid in the Rooms tab). Both list tabs are now just a roster: a thumbnail, a
name, a status line, a link. Keep new admin surfaces to this shape rather than growing
another inline editor on a list -- it is why the two existing ones scaled badly enough to
need rebuilding.

## One-container install: Magpie runs LiveKit itself

Magpie is meant to be sold or given away as a self-hosted product, and today an install is
two services (Magpie plus a separate `livekit-server` in `docker-compose.yml`) with a
LiveKit config, matching API keys on both sides, and four ports to forward. The goal is
"install Magpie" as one thing, with LiveKit an implementation detail.

Shape agreed on: bundle the open-source `livekit-server` binary in the Magpie image and have
Magpie start it as a child process. It generates its own API key/secret on first run (kept in
the data volume), writes the LiveKit config from Magpie's own settings, and Magpie points at
it over localhost, so `LIVEKIT_HOST`/`KEY`/`SECRET` stop being something an installer
touches. Proxy LiveKit's signaling through Magpie's own HTTP port so the only web port to
expose is Magpie's. LiveKit can't go away -- the SFU is what makes more than a handful of
people work, and kick/mute and the OBS views call its server API -- so the media ports
(UDP/TCP, plus TURN if the install is behind strict NAT) still need forwarding; a
first-run check that says whether they're reachable would earn its keep.

Things to settle when it's built: process supervision and restart if LiveKit dies, image
builds per CPU architecture, a first-run flow (admin password, public hostname), and shipping
LiveKit's Apache-2.0 license/NOTICE with the image (attribution is already on the About tab).
Keep the existing two-service compose and pointing at LiveKit Cloud (just the three env
vars) documented as the alternatives for anyone who wants them.

## Studio needs to read a room's profile

A room's **profile** (Roleplaying / Participants / Characters, set on its config page) now
decides which of the Participant and Character image groups actually exist for it -- both
on a member's per-room profile section and, in principle, in what Coffee Pub Studio should
offer to publish. Studio doesn't read `room.profile` yet, so today it still offers Character
sources for a Participants-only room (and vice versa) with nothing behind them. Studio's own
TODO.md should pick this up: fetch the room's profile alongside its members and grey out (or
just not build) the source kind the profile doesn't offer.

## Scheduling

Not started; the Calendar module in the modules plan is the intended home. A way to schedule when a room's session happens next (date/time, maybe a
recurrence) and let members see it -- session logistics currently live outside the app
entirely.

## Environments: what is left after phases 2 to 5

Built (September 24, 2026; plans/plan-tenants.md, "Phases 2 to 5 in detail"): the owner
role, the caps enforced, the calls cap, the plan catalog, sign-up, the billing webhook and the
grace, an owner's export and deletion request. Left, and unverified:

- The calls cap and the live call count were only checked for graceful degradation, never
  against a real LiveKit call; try starting a second call on a plan capped at one.
- Billing has no relay yet: the webhook takes the app's own JSON, signed with `BILLING_SECRET`,
  and a payment provider's own webhook format is meant to be adapted to it by a small relay
  outside the app. Nothing is sold online until `BILLING_CHECKOUT_<PLAN>` points at a checkout
  page and that relay exists.
- A tenant's own domain on the top plan, and one identity across environments, stay later
  steps as the plan says.
- The past-due sweep runs hourly inside the server; a server that is never up for an hour
  never degrades anyone.

## Desktop sharing has no OBS side

Screen sharing (the monitor icon at the table) works live -- a shared screen gets its
own tile, camera stays up alongside it -- but the Stream module's view page (`/view/<key>`,
the OBS Participant box) only ever draws the camera or a picture, never a screen-share
track. Someone sharing their screen doesn't show up on stream unless OBS is separately
capturing the app window itself. Not attempted here; would need its own work in the Stream
module and in Studio if wanted.

## Studio/OBS needs to know about guests

Guests (join with just a name, no account -- see the "Guests" section in a room's own
Settings popover, and Guest images under Manage > Settings) show up fine at the table and in
chat, but only there: there's no `/view/<key>` OBS source (the Stream module's view page) for
a guest, since that's keyed by a real user's key and guests don't have one. Nobody asked for OBS boxes for guests yet, but
if that changes it's a bigger cross-repo feature (Studio would need to build a source for an
identity it never configured in advance).

## Follow the admin: who drives the stream

Right now "the admin" the stream follows is picked as "the first admin, in user-list
order, who happens to be online" -- an accident of implementation, not a real choice. With
one admin it is harmless; with two, the stream can follow the wrong one regardless of who
is actually operating OBS. The fix is separating two things that are currently the same
flag: *who is an admin* (a permissions role) from *whose location drives the stream* (a
stream-operator role) -- e.g. a `streamsFrom` flag on a user, defaulting to the sole admin
when there is only one, settable when there is more than one.

## Multiple simultaneous asides, and a director-style switch

The real shape (confirmed in conversation, not yet built): one main room continues
normally while one *or more* asides run alongside it at once (3 players splitting into 3
different side conversations; a group of 9 breaking into 3 groups of 3), with the admin
able to move between them -- and, separately, a producer-style ability to point the
recording at any live group without necessarily being in it themselves (this is the same
underlying fix as the `streamsFrom` split above: someone directing the stream, distinct
from any single participant's own physical presence).

This is bigger than the "one aside, GM plus N" work already shipped -- treat it as its own
design pass, not a quick extension. The data model already allows more than one `ephemeral`
room to exist at once; what's missing is a way to move between existing asides (today you
can only create a new one) and the operator-switch capability above.

## Run it on Windows and Mac, not just the QNAP

"Run it" in the README is currently one specific recipe: Docker on a QNAP NAS (Container
Station) behind Nginx Proxy Manager, with port-forwarding on a home router. Nothing in the
app itself is known to be Unix-only (paths go through Node's `path` module, `docker-compose`
is itself platform-agnostic under Docker Desktop), but nobody has actually run the Magpie +
LiveKit containers on someone's own Windows or Mac machine, or written down what that setup
looks like -- useful for a GM without a NAS, or for testing without touching the shared
production instance. Needs a docker-compose variant (or documented tweaks) that doesn't
assume the NAS's specific network setup, port-forwarding guidance for a home router on each
OS, and someone actually running it end-to-end on both to catch whatever isn't as portable
as it looks on paper.
