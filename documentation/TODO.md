# To do

Things agreed on but not built yet, roughly in order. See the Studio repo's own TODO.md
for that app's side of things (Windows OBS capture work, mainly).

## Room layout: walk it in a real call

The grid, the floating popout bar, the narrow-window switch and the header-height check are built and were only checked in a browser with the call unavailable. In a real call, try: chat open and closed; dragging the chat edge; fullscreen; popped out with chat open and closed; a narrow window and a phone; the grid, strip and spotlight layouts; and the reactions tray, settings popovers, overflow menu, aside and recall overlays and the away prompt in each. Step 6 of plans/plan-room-layout.md, docking installed modules, waits on the module host API.

## Modules: steps 2 to 9

Step 1 (install, manifest, approve and enable, rollback, uninstall) is built. The rest, in order: the
host API and SDK with per-module storage; the server nav page surface; floating room panels with
per-room enablement; module permissions in the Roles grid; the shared live store; the hooks and
scheduler with in-app notifications; the Calendar module; the Travel planner. Design and decisions are
in plans/plan-modules.md. Verify each step by installing a small test module and exercising it as an
admin and as an ordinary user.

## Documentation: walk the new guides

The guides were written from the old README and the code, not walked in a running server, and
several screens have changed since that README was written. Walk each one and correct it, most
likely wrong first: userguide-table.md (the pop-out and away claims), userguide-accounts.md (the
roles grid and what each role can do), userguide-images.md (per-room pictures and the Images
permissions), then userguide-server-settings.md. Check each label against the screen.

## Documentation: screenshots

The README and home.md have none. Capture the table, the Manage page and a room's settings on a
scratch server with made-up names, in WebP, into documentation/assets/. No screenshot is better than
one showing real people.

## Away message and late joiners

Suspected, not observed: someone who joins a call after another person has gone away sees that tile
without the Away mark or message, because it is only sent when the state changes. Confirm with two
browsers on a real server, then send the away state to new joiners.

## CHANGELOG entries for later releases

CHANGELOG.md starts at 0.3.0. From here every change gets an entry naming how it was verified.

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

## Scheduling

Not started; the Calendar module in the modules plan is the intended home. A way to schedule when a room's session happens next (date/time, maybe a
recurrence) and let members see it -- session logistics currently live outside the app
entirely.

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
