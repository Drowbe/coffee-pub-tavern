# Optional Conference Plan

**Audience:** the author deciding how a Tavern server can run without a video conference (and without LiveKit), and whoever builds it afterwards.

**Status:** Direction set by the author; nothing built. The findings below are from reading the server and the room page.

## What the author wants

A server whose admin does not want the conference, or does not want to install LiveKit, should not have to. Rooms with a chat and modules (Planner, Places, Research and the rest) are a product on their own. The built-in panes (Conference, Chat) become cards on the Modules tab that can be enabled or disabled like a module, with the same plain "what this does" wording.

## What the server needs LiveKit for today

Reading `server/index.js` and `public/room.js`:

1. **Startup.** The server refuses to start without `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` and creates a LiveKit client at load.
2. **Tokens.** Joining a room, the OBS pages and the guest link all mint a LiveKit token; the room page always connects (`room.connect`).
3. **Presence.** "Who is at the table" and who is in which room come from LiveKit's participant lists (`participants()`), including whether a camera or microphone is on.
4. **Chat.** Messages travel over LiveKit (`sendChatMessage`, and the data channel); the server only keeps the history.
5. **Small live features.** Reactions, away notices, private asides and the "return to the table" calls use LiveKit data messages.

So switching off the conference alone is not enough: the chat, presence and asides would still need LiveKit. A server with no LiveKit needs those three moved onto something the server already has.

## The stages

1. **A switch for the conference, LiveKit still there** (small, safe). A server setting turns the Conference pane off: no camera or microphone, no video tiles, no "join the call", and it disappears from the room bar and the modules menu. Chat, presence and asides keep working over LiveKit. This gives the Modules-tab cards and the enable step now.
2. **Chat and presence without LiveKit** (the real work). The server delivers chat messages, presence (who is where, online), reactions and away notices itself, over a server-sent-events stream (Tavern already uses one for modules, presence beat and notifications), with the same history. The room page stops connecting to LiveKit unless the conference is on. Asides and private conversations become chat-only when there is no conference.
3. **LiveKit becomes optional.** The server starts without the two LiveKit keys, says so once in the log, and treats the conference as unavailable. The install docs and the compose file show the no-conference setup first; LiveKit is the option you add for video. The OBS pages and the guest link say "no conference" where they need one.
4. **Conference on later.** An admin can add LiveKit afterwards and turn the conference on; nothing else changes.

## The Modules tab

Chat and Conference each have a card like a module's: an icon, a name, "Built in", an Enabled or Disabled state, and one switch. Enabling says what it does and, for the conference, that it needs a LiveKit server. The existing per-role permissions (See and join the conference, Open and read the chat) stay on the Roles tab. Disabling Chat is a separate, later choice: with no chat and no conference a room has only its modules.

## Risks

- **Chat transport.** Moving chat off LiveKit changes a load-bearing path; it needs its own tests and a phone check. The history and permissions already live on the server.
- **Presence accuracy.** LiveKit knows exactly who is connected; the server-side beat is looser (a minute or so). "In a call" and "camera on" only mean something when the conference is on.
- **Pages that assume a conference.** The room page, the popped-out window, the phone tab bar (the call is the first view), OBS and the guest join flow each assume it and need a no-conference state.

## Decisions

1. **The author:** yes to the conference being optional, and to LiveKit not being required. (Said 2026-09-21.)
2. **Order:** stage 1 first, stage 2 next, stage 3 when stage 2 is proved on a real server.
3. **Open:** whether Chat itself may be switched off (recommended: later, and only once modules alone make a useful room).
