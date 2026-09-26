# Collaborator in OBS

**Audience:** a streamer or game master putting Collaborator players into OBS scenes, and the owner setting the Stream module up.

Every player is available to OBS as a separate Browser Source, on a transparent background, so you lay
them out however you like and they stay in place as people talk, join or leave. An absent player
renders as their Offline picture. A player with no Participant picture set anywhere (their own, the
space's, or the environment's Default Images) shows their profile photo instead, and one with neither shows
nothing. This is the **Stream** module's work: it ships with the
server and is installed and turned on by itself, so an existing server's sources keep working across the
update. If it has been turned off, every view link answers with a sentence saying so, and Manage > Modules
turns it back on.

## With Coffee Pub Studio

Skip everything below. Studio's Magpie tab signs in as an owner and creates and maintains both sources
for every player in the space you pick, in one click. See Studio's own guide for that.

## By hand

1. Open the Stream module from the header (its clapperboard icon), or from Manage > Modules. It lists
   every player with a **Player** (the Participant box) and a **Character** button; each copies that link.
   **Open** shows the Player view in a new tab to check it.
2. In OBS, choose Sources, +, Browser, and paste the link.
3. Set the width and height you want, and untick "Shutdown source when not visible".

The **Player** view shows the camera, or the player's Online picture when the camera is off, with a
talking border while they speak and a muted border while their microphone is off. The **Character**
view shows the Character pictures only and never the video. See
[Participant and Character images](userguide-images.md) for how to set those up; the pictures are still
each person's own, on their profile.

The links carry the server's **access key**, which the Stream page shows (and regenerates) for owners and
the admin (on a hosted server, the host admin), as does **Access key** on the Environment tab of the Manage page. Regenerating
it stops every existing link working, so do it only if a link has leaked. Who may open the Stream page at all
is the module's **See the Stream page** permission on the Roles tab: off for members, moderators and guests
by default (a role that had the old **See the stream links and the access key** keeps it). Anyone who may open
the page but is not an owner or the admin sees "Only an owner or the admin sees the links, since each one
carries the access key."

The exact options a link accepts (name plate, silent audio, hiding reactions) are in
[OBS view links](../api/api-obs-view.md).

## How the boxes look

Under the module's settings (**Module Configuration** on its card on the Modules tab): the talking and
muted borders and their colours and width for the Participant box and, separately, the Character box;
the name plate (on or off, position, box colour and opacity, text colour, size and case); a colour behind
the Participant picture and how large the portrait sits in the box; and how a box is dimmed or tinted
while the person is offline, in an aside away from the space the stream follows, or in a private
conversation. These are the same for everyone. A server that had these on its Server tab (now Environment) before the
module arrived keeps its values: they were carried over when the module installed itself.

## Sound

The Player view plays the player's audio. To take it through OBS's mixer, tick "Control audio via OBS"
on the source. Add `audio=0` to the link to silence it.

## Kick and mute

Next to each player in a call on the Manage page are buttons to kick them or mute their microphone.
Owners can always do this; other roles need the **Mute other people** and **Kick other people**
permissions on the Roles tab.

## What is not on stream

Sharing a screen in the call gives it its own tile there, but the OBS view never shows a shared
screen; capture that window in OBS directly. Guests have no OBS view either, since the links are keyed
by an account. A private conversation never shows the live camera, whatever the settings.
