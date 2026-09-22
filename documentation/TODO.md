# To do

Things agreed on but not built yet, roughly in order. See the Studio repo's own TODO.md
for that app's side of things (Windows OBS capture work, mainly).

## Room layout: walk it in a real call

The grid, the floating popout bar, the narrow-window switch and the header-height check are built and were only checked in a browser with the call unavailable. In a real call, try: chat open and closed; dragging the chat edge; fullscreen; popped out with chat open and closed; a narrow window and a phone; the grid, strip and spotlight layouts; and the reactions tray, settings popovers, overflow menu, aside and recall overlays and the away prompt in each. Docked modules are covered by the modules walk below.

## Modules: walk them in a real server and call

Built and only checked in a browser with the LiveKit connection unavailable, and never with two people: install, enable and disable a module; the Roles grid rows a module adds; the header nav item and the server page; the Modules button and panes in a real call (docked beside the video and chat, drag its edge, switch to floating and back, open in its own window, several open at once, the call itself popped out); per-room enablement from a room's page; the toast, unread counts and reminders reaching a second person; live changes appearing on a second browser; a guest seeing a room module. Also confirm in a real Chrome and Safari that a sandboxed module frame renders and the SDK connects (the built-in preview browser refused subresource loads from a sandboxed frame, so modules are inlined and the SDK is injected). Verify with two browsers on a real server.

## Canvas: video as a pane

Make the conference a pane like chat and the modules, so a person can join with only chat, or chat and the Calendar. Decisions, progress and the four stages are in plans/plan-canvas.md. All four stages are built and need real calls and real windows to verify: close and rejoin the conference; the other person's tile leaving and returning; chat with no conference; a role without the conference; an aside with someone out of the conference; the conference floating and in its own window (tiles and audio after the move, hotkeys, popovers); the whole app popped out (the header and pane icons, idle sliding, full screen, header links); a module window's dock and float buttons; and Join with and the remembered layout across a reload, a dropped connection and a real leave. Then delete the plan.

## Ideas and open questions

Collected, none started:

- A module for Foundry that carries communication and commands between Tavern and Foundry.
- A module for WhatsApp or SMS hooks.
- Updating modules that do not ship with Tavern without uploading a zip: a module could name an update address (a GitHub release, say) that the server checks and installs from, with the same approval. Bundled modules already update from Manage.
- The dashboard: built (see plans/plan-dashboard.md), including the Planner's Trips widget. Left: customising the layout, and checking it with two people and in a real call.
- Module interoperability is built (refs, opening, backlinks, events, actions). What is left is in plans/plan-modules.md: a module's own activity on its card, and verifying with two people. Also verify in a real browser: dragging an event or a poll from one pane onto a task in another, and between windows.
- Storage and transport of sensitive data such as passwords: to discuss before any module handles it.
- Call time in the conference titlebar.
- Reduce the height of the header a bit.

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

Built: the Days and Decisions views, the trip, items, moves, suggestions from other modules and the Trips card (see plans/plan-travel.md). The map is the Maps module: any Planner item with a place shows there. Left: reading confirmation emails, and checking it with two people in a real call (drag out and the drop menu on items have only been run as code).

## Modules: what is left

See plans/plan-modules.md: Google Calendar sync, a hello example, reminders for people who are away (nothing sends email or push yet), and in the Calendar, changing or skipping one occurrence of a repeating event and a per-person view of reminders. Events across several days are built.

## Architecture: a list is not an editor

A list view's job is to show what exists and let you pick one -- not to host a form for
editing it. Click an item, land on a page that is *about that one thing*. Users worked
this way first (`/profile/<key>`, replacing a flat admin table full of per-row fields);
rooms now work the same way (`/rooms/<id>`, replacing per-card fields and a member
checklist grid in the Rooms tab). Both list tabs are now just a roster: a thumbnail, a
name, a status line, a link. Keep new admin surfaces to this shape rather than growing
another inline editor on a list -- it is why the two existing ones scaled badly enough to
need rebuilding.

## One-container install: Tavern runs LiveKit itself

Tavern is meant to be sold or given away as a self-hosted product, and today an install is
two services (Tavern plus a separate `livekit-server` in `docker-compose.yml`) with a
LiveKit config, matching API keys on both sides, and four ports to forward. The goal is
"install Tavern" as one thing, with LiveKit an implementation detail.

Shape agreed on: bundle the open-source `livekit-server` binary in the Tavern image and have
Tavern start it as a child process. It generates its own API key/secret on first run (kept in
the data volume), writes the LiveKit config from Tavern's own settings, and Tavern points at
it over localhost, so `LIVEKIT_HOST`/`KEY`/`SECRET` stop being something an installer
touches. Proxy LiveKit's signaling through Tavern's own HTTP port so the only web port to
expose is Tavern's. LiveKit can't go away -- the SFU is what makes more than a handful of
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

## Desktop sharing has no OBS side

Screen sharing (the monitor icon at the table) works live -- a shared screen gets its
own tile, camera stays up alongside it -- but `/view/<key>` (the OBS Participant box)
only ever draws the camera or a picture, never a screen-share track. Someone sharing
their screen doesn't show up on stream unless OBS is separately capturing the app
window itself. Not attempted here; would need its own view.js/Studio work if wanted.

## Studio/OBS needs to know about guests

Guests (join with just a name, no account -- see the "Guests" section in a room's own
Settings popover, and Guest images under Manage > Settings) show up fine at the table and in
chat, but only there: there's no `/view/<key>` OBS source for a guest, since that's keyed by
a real user's key and guests don't have one. Nobody asked for OBS boxes for guests yet, but
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
is itself platform-agnostic under Docker Desktop), but nobody has actually run the Tavern +
LiveKit containers on someone's own Windows or Mac machine, or written down what that setup
looks like -- useful for a GM without a NAS, or for testing without touching the shared
production instance. Needs a docker-compose variant (or documented tweaks) that doesn't
assume the NAS's specific network setup, port-forwarding guidance for a home router on each
OS, and someone actually running it end-to-end on both to catch whatever isn't as portable
as it looks on paper.
