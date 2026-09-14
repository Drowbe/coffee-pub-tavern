# To do

Things agreed on but not built yet, roughly in order. See the Studio repo's own TODO.md
for that app's side of things (Windows OBS capture work, mainly).

## Architecture: a list is not an editor

A list view's job is to show what exists and let you pick one -- not to host a form for
editing it. Click an item, land on a page that is *about that one thing*. Users worked
this way first (`/profile/<key>`, replacing a flat admin table full of per-row fields);
rooms now work the same way (`/rooms/<id>`, replacing per-card fields and a member
checklist grid in the Rooms tab). Both list tabs are now just a roster: a thumbnail, a
name, a status line, a link. Keep new admin surfaces to this shape rather than growing
another inline editor on a list -- it is why the two existing ones scaled badly enough to
need rebuilding.

## A user's own photo: nothing is admin-proof

Today a player's own portrait is self-service only -- even from `/profile/<key>`, an admin
editing someone else cannot touch it (the slot is deliberately frozen in edit mode). That
was a reasonable-sounding default that turns into a real problem the first time someone
uploads something inappropriate, or just wants help and isn't at their computer: there
should be nothing on a user's account an admin cannot see and override. Unfreeze the
portrait slot in edit mode like every other image slot -- upload and clear both work for
an admin the same as for the user themselves.

## Profile page: sections, not one long scroll

Split `/profile` (and its admin edit mode) into explicit sections rather than one flowing
page: **User** (account, photo, link), **Default Images** (the current Player and
Character image sets, serving as the fallback), then a section *per room* the user
belongs to, below the defaults, once per-room overrides exist (see below) -- so a player
in two campaigns can give each its own Character images without one overwriting the
other. Decide, field by field, which settings stay self-service and which stay admin-only
as each section lands -- the split already exists at the global level (a player's own
photo is self-service, the Player box's admin-set "Online" picture is not, because it can
be part of a matched OBS image set) and needs re-deciding per room, not assumed uniform.

## Room profiles: a room's type gates its own settings

A room picks a **profile** (e.g. "Gaming", "Conference") that decides which settings even
exist for it and which options Studio's publish UI offers for it -- a Gaming room offers
both Player and Character images (and their per-room overrides above); a Conference room
offers only Player images, with no Character concept to configure or publish at all.
Design this alongside the per-room section work above, not before it -- what a room's own
config page and a user's per-room section show both depend on the room's profile.

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

## Background blur / virtual background

Not started. LiveKit itself (the server) has no part in this -- it is entirely a
per-camera-track client-side effect a player would turn on for their own camera, the same
place mic/camera choice already lives. Not a from-scratch build either: LiveKit publishes
an official add-on, `@livekit/track-processors`, built on MediaPipe segmentation, that
plugs into `livekit-client`'s `track.setProcessor()` API (present in the `livekit-client`
2.22.3 already in use here). Real option, but adds a WASM/ML dependency and real CPU cost
in every player's browser -- worth a small spike to confirm it behaves well before
committing to it, rather than wiring it in blind.
