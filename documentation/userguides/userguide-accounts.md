# Accounts, Roles and Permissions

**Audience:** a game master or admin adding players to a Coffee Pub Magpie server and deciding what
each of them can do.

## Add people

On the Manage page, **Users** lists everyone. Choose **Add user**, give them a login, display name
and password (or turn on a personal link), and open their profile to set up their pictures. Only an
admin adds people.

Each account can sign in either way, or both:

- **Login and password.** The admin picks both and tells the player.
- **Personal link.** Turn it on for a player and copy the link, something like
  `https://host.<domain>/j/2f3kd...`. Opening it signs them in and lands them on the list of spaces, ready to join.
  Regenerate it to make the old one stop working; turn it off to require a password.

Nobody changes their own password; an admin sets it. Sessions last 30 days. Changing someone's
password or regenerating their link signs them out everywhere.

There is always at least one admin. The last admin cannot be demoted or deleted, and an admin cannot
change their own role or delete themselves; another admin has to. On a hosted server, where the server is
one environment among several, an admin is called the environment's **owner** in every page (see
[Your environment](userguide-environments.md)); it is the same role.

Every account has a **key**, eight letters and digits made when the account is created. It never
changes. Images, OBS view links and OBS source names use the key, so an admin can rename a login or
a display name without touching anything in OBS.

A player with no camera and no microphone still joins: they sit in the call with their picture, use
chat and reactions, and can be published to OBS like anyone else.

## Let people sign themselves up

Off by default. Under **Server**, turn on **Let anyone at /register sign themselves up** and anyone
who finds that link can make their own account, as an ordinary user in the Lobby.

Without opening it up, an admin can still **invite** someone straight into specific rooms: pick the
rooms and choose **Generate invite link**, then send the link. It works whether or not general
sign-up is on, expires after 7 days, and works once.

## Guests

A guest has no account, for someone dropping in once. While in a call, open the settings popover
(the gear next to chat and reactions) and, under **Guests**, turn on that room's link. Anyone with it
lands on a page asking only for a name, then joins straight into that room with video, microphone,
chat and reactions.

Anyone in the call with the right permission can turn the link on, copy it, or turn it off. It is a
standing door rather than single-use: it works for as many guests as show up until someone turns it
off or generates a new one. Nothing about a guest is kept once they leave. A guest with their camera
off shows the shared **Guest images** picture set (see
[Server settings](userguide-server-settings.md)). A room can turn guests off entirely with **Allow
Guests** on its own settings page, which also turns off any link already in use there.

## Roles and what they can do

Everyone has one of four roles. Open **Roles** on the Manage page to see a grid of checkboxes: one
row per permission, one column per role. Changes save as you click.

- **Admin** can do everything, and cannot be turned down. Admins run the environment: they add people, set
  passwords and change settings.
- **Moderator** is what someone gets in any room where they are marked **Moderator** on their
  profile's Rooms tab, on top of their ordinary role there.
- **User** is an ordinary account.
- **Guest** is everyone who joins from a room's guest link.

The permissions are grouped:

- **Panes**: see and join the conference, open and read the chat. Everyone has both by default. Without
  the first, a person joins a room for its chat and modules only and cannot send or receive audio or video.
- **In the Room**: send chat messages, send pictures in chat, use reactions, share their screen.
- **Asides**: start a private conversation, step aside with someone (recorded).
- **Moderation**: mute other people, kick other people, manage a room's guest link.
- **Images**: change their own profile photo, call background, and each of the Participant and
  Character pictures. By default only admins change the OBS pictures; everyone else can change their
  own profile photo and call background.

A permission that is off for a role hides the control for that person, and the server refuses it even
if someone tries the request by hand.

## Per-room settings for a member

An admin opens someone's profile and chooses the **Rooms** tab to see one section for each room they
belong to. In each, **Moderator** makes them a moderator in that room only, so they get everything
the Moderator role has there and nothing extra elsewhere. **Use Default Profile Images** decides
whether the room's own pictures replace their defaults, and **Remove** takes them out of the room.

## Two-step sign-in

A second step after the password, if you or your admin want one: a six-digit code from an authenticator app on your phone, the standard kind that any such app makes.

- **Turning it on.** On your profile, under **Two-step sign-in**, choose **Turn on**: scan the square with the app (or type the key under it into the app), then type the six digits the app shows. The page then shows ten **recovery codes**, once: keep them somewhere safe. Each one signs you in a single time if the app is ever gone.
- **Signing in.** After your password, a page asks for the app's code. Tick **Remember this browser for 30 days** and that browser is not asked again for a month. **Use a recovery code instead** takes one of the saved codes, which is then spent.
- **A personal link** still gets the code step once you have one; it is the first step, not a way around the second.
- **Turning it off** asks for a code. If the environment requires it (below), it cannot be turned off.
- **Locked out.** Ask an admin: on your profile they can **Reset your second factor**, which signs you out everywhere and lets you set it up again. An admin locked out of their own account on a hosted server asks the host; on a single server, the operator turns on the admin lockout bypass in the compose file, signs in on the password, and presses **Reset my second factor** on their profile (see the getting-started guide).
- **The rule for the whole server** is one switch on Manage > Server, under the sign-in page: **Require two-step sign-in for everyone**. Off (the default), anyone may set it up and is then asked; on, everyone must, from their next sign-in, which lands on the set-up page first; a session already open keeps working. Whether the server offers two-step sign-in at all is the operator's compose setting; when it does not, none of this appears.
