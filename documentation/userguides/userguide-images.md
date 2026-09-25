# Participant and Character Images

**Audience:** a game master or player setting the pictures that Coffee Pub Magpie and OBS show for
each player.

Each user has two things the recording can show, and both react to the same live signal: who is
speaking and who is muted. Both can be set once as a **Default** on the account and, for a room,
replaced just for that room. Which of the two a room offers depends on that room's **Profile**.

Each has pictures for **Offline**, **Online**, **Talking** and **Muted**, and the Participant box adds
**Aside** and **Private**. The box always shows Offline or Online depending on whether the person is
in the call, and lays Talking or Muted on top while they speak or while their microphone is off. Any
picture left unset is simply not drawn.

## Who can change what

Every person's profile page has their photo, Call Settings, and the image sets. An admin can change
anything for anyone. Everyone else can change only what their role allows: by default their own
profile photo and call background, and nothing else. An admin widens that on the **Roles** tab, under
**Images**, one picture at a time.

The call background can be a picture you upload or one of the pre-made backgrounds that ship with Magpie: choose **Choose from the library** under it, filter by theme and style, and pick one. It is saved as your own picture, so you can replace or remove it like an upload.

## Participant

The Participant box is the person. It shows their camera when it is on, and the **Online** picture
when it is off. Out of the call it shows **Offline**, or nothing. **Aside** shows while they are
online but pulled into an aside elsewhere, and **Private** the same for a private conversation.

While someone speaks, a **talking border** is drawn around the box, and while their microphone is off
a **muted border** in its own color. Both share one width and fit any source size. The borders are
the only things the box ever draws; for anything more, use the Talking and Muted pictures. The
borders, their colors, the width and the **name plate** are the Stream module's settings, the same for
everyone (see [Magpie in OBS](userguide-obs.md)).

Two more defaults shape the box while it shows a picture rather than the camera: a **color behind the
picture**, so the video area stays visible on the recording, and a **picture size** as a percentage of
the box, which leaves a margin around the picture instead of filling the height. The camera always
fills the box.

## Character

The Character box is a second box for OBS with the same pictures and its own talking and muted
borders (off by default, set server-wide under **Character borders**). With no Online picture and no
borders it stays transparent until the person talks or mutes, so it can sit over an existing
character bar. It carries no audio.

## The profile photo is separate

A player's own **profile photo** shows only in the app itself: the header, the call's tiles and their
profile page. It never shows in the recording, because the Online picture may be part of a matched
set of OBS pictures the owner built. The photo falls back to a plate with the player's initials and
always fills its square, cropped rather than letterboxed. The OBS pictures show exactly what was
uploaded, uncropped, since they may be transparent overlays.

## Set a picture

Images are PNG, JPEG, GIF or WebP up to 20 MB. Click a picture box to change it, and the small
**x** over its corner to clear it. An empty box says "not set".

## Per-room pictures

A room section on a member's profile has **Use Default Profile Images**. Leave it checked and the
member's defaults show in that room. Uncheck it to set pictures just for that room, so someone in two
campaigns can give each its own Character images. Any picture left unset there still falls back to
the defaults. In the call, the space list and the call's tiles show the room's Online picture (and the
Offline one for members who are not in the room) when it has been set.

## Server defaults

When neither the member nor the room has set a picture, the box shows the server-wide **Default
Images** from the Theme tab of the Manage page. Guests show the shared **Guest images** set instead of
a member's own.
