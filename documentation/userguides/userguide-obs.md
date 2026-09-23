# Magpie in OBS

**Audience:** a streamer or game master putting Coffee Pub Magpie players into OBS scenes.

Every player is available to OBS as a separate Browser Source, on a transparent background, so you lay
them out however you like and they stay in place as people talk, join or leave. An absent player
renders as their Offline picture, or as nothing.

## With Coffee Pub Studio

Skip everything below. Studio's Magpie tab signs in as an admin and creates and maintains both sources
for every player in the room you pick, in one click. See Studio's own guide for that.

## By hand

1. On the Manage page, open **Users** and find the player's card, or open their profile. Choose
   **Player** (the Participant box) or **Character**, then **Copy link**.
2. In OBS, choose Sources, +, Browser, and paste the link.
3. Set the width and height you want, and untick "Shutdown source when not visible".

The **Player** view shows the camera, or the player's Online picture when the camera is off, with a
talking border while they speak and a muted border while their microphone is off. The **Character**
view shows the Character pictures only and never the video. See
[Participant and Character images](userguide-images.md) for how to set those up.

The links carry the server's **stream key**, which you can see (and regenerate) under **OBS access** on
the Server tab. Regenerating it stops every existing link working, so do it only if a link has leaked.

The exact options a link accepts (name plate, silent audio, hiding reactions) are in
[OBS view links](../api/api-obs-view.md).

## Sound

The Player view plays the player's audio. To take it through OBS's mixer, tick "Control audio via OBS"
on the source. Add `audio=0` to the link to silence it.

## Kick and mute

Next to each player at the table on the Manage page are buttons to kick them or mute their microphone.
Admins can always do this; other roles need the **Mute other people** and **Kick other people**
permissions on the Roles tab.

## What is not on stream

Sharing a screen at the table gives it its own tile there, but the OBS view never shows a shared
screen; capture that window in OBS directly. Guests have no OBS view either, since the links are keyed
by an account.
