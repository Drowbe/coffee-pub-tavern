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

## Room Settings: real tabs, not anchor-scroll

`roomconfig.html`'s sections are still the old `.section-nav` pattern -- links that just
scroll you down the page, not real tabs like admin.html/profile.html already use
(`selectTab()`/hash-based). Needs converting to that same real-tab pattern, and while doing
it, splitting into exactly two tabs: **Room** (name, description, profile type, launch link
and its icon -- the room's own design) and **Members** (invite, guest link, and the
participant list/checklist -- currently split across "Access" and "Members" sections that
should merge into this one tab).

## Profile Rooms tab: remove, default images, and per-room permissions

Three related, not-yet-built pieces on each room's card in a user's **Rooms** tab
(`profile.html`'s per-room sections):

- A **Remove** action to take that user out of the room entirely (distinct from deleting
  the user) -- needs a server endpoint if one doesn't already exist for "admin removes one
  user from one room."
- A **"Use Default Profile Images"** checkbox, checked by default. Checked, that room's own
  per-room image slots (see the Participant/Character `.slot` grids) stay hidden and the
  user's account-level defaults apply; unchecked, the room's own slots show and can be set.
  Needs a new persisted per-room-per-user field (e.g. `user.rooms[roomId].useDefaultImages`)
  and server support to store/honor it, alongside client-side show/hide.
- A **Permissions** section above the images, with four checkboxes: **Moderator** (inert for
  now -- "we will use this later," just captured, not wired to anything), **Can Kick**,
  **Can Mute**, **Can Invite**. Needs a new per-room-per-user data field (e.g.
  `user.rooms[roomId].permissions = { moderator, canKick, canMute, canInvite }`), server
  validation, the profile.js UI, and -- this is the part that actually does something --
  wiring Can Kick/Can Mute into the admin hover-tools gating in `room.js`'s `tileFor()`
  (currently `if (me?.role === 'admin')`), so a non-admin with the flag set for *that room*
  also gets the Mute/Kick buttons there. Can Invite needs a feature to gate decided (most
  likely the room's own guest-link controls, since nothing else maps to it as directly).

## Profile Call Settings: visibility and order

Three small layout/visibility fixes to `profile.html`'s Call Settings section, agreed on but
not done:

- Hide the whole Call Settings section when an admin is editing someone else's profile
  (`editingKey` truthy) -- it's the user's own mic/camera setup, an admin adjusting it for
  them doesn't make sense. Only show it on your own, unedited profile view.
- Move **Mic Level** onto its own full line, positioned above **Noise Gate** (currently
  sharing a row per the existing `.fields` layout).
- Move the whole **Call Settings** section to appear *after* **Default Profile Images** in
  the profile-tab panel, instead of before it.

## Studio needs to read a room's profile

A room's **profile** (Roleplaying / Participants / Characters, set on its config page) now
decides which of the Participant and Character image groups actually exist for it -- both
on a member's per-room profile section and, in principle, in what Coffee Pub Studio should
offer to publish. Studio doesn't read `room.profile` yet, so today it still offers Character
sources for a Participants-only room (and vice versa) with nothing behind them. Studio's own
TODO.md should pick this up: fetch the room's profile alongside its members and grey out (or
just not build) the source kind the profile doesn't offer.

## Scheduling

Not started. A way to schedule when a room's session happens next (date/time, maybe a
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
