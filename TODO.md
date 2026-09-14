# To do

Things agreed on but not built yet, roughly in order. See the Studio repo's own TODO.md
for that app's side of things (Windows OBS capture work, mainly).

## Done this pass

- **Pull aside, corrected.** A private word is private from the rest of the table, not
  from the recording -- while the admin is aside with someone, that conversation is what
  airs, exactly like any other room the admin is in. (The earlier "nobody is on stream
  during a pull-aside" rule was a wrong assumption made overnight with nobody around to
  check it against; reverted once the real intent was confirmed.)
- **Pull aside, more than one person.** Click a tile's door icon to pick who (toggles a
  selection instead of pulling immediately), "Step aside with N" to confirm. Everyone
  picked moves and is notified together, no click needed on their side.
- **Back to the table returns to where you came from**, not always the Lobby (an aside
  room now remembers its `origin`), and returning is symmetric: either person clicking it
  brings the other one back too, the same as pulling aside itself only needs one click.
- **Deafen** (mute what you hear, next to the mic, also the D key): local-only, does not
  touch your mic or leave the call.
- **Admin-editable reactions** (Manage > Settings): add, remove, reorder, edit glyph and
  label. No longer a hardcoded six baked into the client.
- **Profile/Manage from inside a call load in an in-page overlay** (an iframe), not a new
  tab and not a real navigation -- the call keeps running underneath the whole time,
  verified end to end (the first version used a new tab; that was a workaround, not this
  fix). No separate bar of our own on top of it: a "Back to [room]" button is injected into
  the loaded page's own header instead (`wireOverlayBack()` in brand.js). What stepping away
  means is shown where a bystander would actually look for it -- dimmed on the person's own
  tile back in the room ("Away") -- not as a message on the page only they can see.
- **A bystander sees "in an aside", not a vanished tile.** While someone (or the admin) is
  off in a private pull-aside room, anyone left behind in the room they came from sees a
  dimmed placeholder in their place -- their picture, "In an aside", who they stepped out
  with -- instead of their video just disappearing as if they'd hung up. Clears back to a
  live tile the moment they return.
- **Editing moved from one flat admin table to each user's own profile page.** An admin
  visiting `/profile/<key>` gets the same page a player sees at `/profile`, in edit mode
  for that person (account, images, personal link, OBS link, mute/kick/delete); a player's
  own `/profile` stays limited to their own photo, same as before. The Manage roster is now
  just status + a link to each profile, not a second editor. Images keep the same Player /
  Character grouping (each its own heading, hint, and 4-slot row) the old admin table used
  -- not one flat undifferentiated grid of all eight.

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

This is bigger than the "one aside, GM plus N" work just finished -- treat it as its own
design pass, not a quick extension. The data model already allows more than one `ephemeral`
room to exist at once; what's missing is a way to move between existing asides (today you
can only create a new one) and the operator-switch capability above.

## Per-room character settings

A user's character settings (images, in the future border overrides) become per-(user,
room) instead of purely global: someone in two campaigns needs two characters. The current
global values become the default a room falls back to when it has no override of its own;
changing the default should not retroactively touch a room that already has its own
override.

Decide, field by field, which settings stay self-service and which stay admin-only when
this lands on top of the new profile pages -- the split already exists at the global level
(a player's own photo is self-service, the Player box's admin-set "Online" picture is not,
because it can be part of a matched OBS image set) and needs re-deciding per room, not
assumed uniform.

## Room "type"

A room needs a `type` (e.g. "Tabletop Roleplaying", "Simple" -- just an image, no
character concept at all) that gates which per-room settings even exist for it, and which
options Studio's publish UI offers (a "Simple" room has nothing to toggle a Character
source for). Design this alongside per-room settings, not before it -- what a room's
settings panel shows depends on both.

## Background blur / virtual background

Not started. LiveKit itself (the server) has no part in this -- it is entirely a
per-camera-track client-side effect. Not a from-scratch build either: LiveKit publishes
an official add-on, `@livekit/track-processors`, built on MediaPipe segmentation, that
plugs into `livekit-client`'s `track.setProcessor()` API (present in the `livekit-client`
2.22.3 already in use here). Real option, but adds a WASM/ML dependency and real CPU cost
in every player's browser -- worth a small spike to confirm it behaves well before
committing to it, rather than wiring it in blind.
