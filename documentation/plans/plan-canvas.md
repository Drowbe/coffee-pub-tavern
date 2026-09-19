# Canvas Plan

**Audience:** whoever is building the room page's pane model, and the author reviewing it before any of it is built.

**Status:** Planned. The decisions below are settled; nothing here is built. Delete this plan once the last stage is done and its rules are in [architecture-room-layout](../architecture/architecture-room-layout.md).

## The idea

Today the room is "a video conference with optional modules". The better picture is a **canvas** with three kinds of pane on it: the conference, the chat, and any number of modules. Chat and modules already go through one pane manager and can each be docked, floating or in a window of their own ([architecture-room-layout](../architecture/architecture-room-layout.md)). The conference is the exception: it is the stage itself, always present, always the first column.

The plan is to make the conference a pane too, with the same three modes, so a person can join a room and use only chat, or chat and the Calendar, or the Calendar and the conference. The default stays what it is today: everything docked, conference then chat.

## Decisions

| Area | Decision |
|---|---|
| Joining | Joining a room opens the panes the person used last in that room (default: the conference and chat). The room card offers a small "Join with" choice. Being in the room is what makes someone online, whatever is open. |
| Closing the conference pane | Leaves the call and stays in the room. Mic and camera stop and incoming media stops; the person is still online with chat and modules. The Modules menu offers "Rejoin call". |
| Room-level controls | Leave room stays in the header and works with any pane. Away, settings, mic, camera and layout live in the conference pane's bar. The hang-up button leaves the call, meaning it closes the conference pane; it does not leave the room. |
| The flexible column | The conference pane takes the leftover width when it is docked. With no docked conference, the first docked pane takes it and the others keep their widths, so there is never an empty canvas. |
| Names | The video part is called the **conference**, never "video". Chat and Conference are listed on the Modules tab of Manage as built-in modules that are always on and cannot be removed (for now); every future module sits beside them. |
| Permissions | New permissions in the Roles grid, in a Panes group: **See and join the conference** and **Open and read the chat**. The existing "Send chat messages" stays as it is. Everyone has both by default, so nothing changes until an admin turns one off. |
| Narrow screens | Panes keep showing in a fixed order of priority: the conference first, then the chat, then modules (their own order is decided as they are built). When there is not room for every open pane, the lowest priority ones drop out of view first. A pane that drops out stays open and comes back when there is room, or when it is picked from the Modules menu. |
| Presence | Anyone in the room is online, whichever panes they have open, including only the Calendar. OBS, Studio and the room list treat them as online and show their Online picture. |

## What presence needs

Today "online" and "in this room" come from LiveKit's participant list. A person with only the Calendar open would not be in LiveKit at all, so presence needs its own signal:

- The room page reports that it is open in a room with a short heartbeat, and the server keeps a person "in the room" while heartbeats keep arriving and for a short grace period after they stop, or immediately when they leave.
- `/api/table` combines that with LiveKit's list (a person in the call is in the room). The room a person is "in", used by OBS views and Studio, comes from the same combined answer.
- An aside is still a call feature: pulling someone aside needs them in the call, so the aside tools only act on people who are.

## Stages

Each stage keeps the default experience unchanged and is verified before the next.

1. **The conference as a closable pane.** The stage's conference area joins the pane manager as a native pane that can be closed and reopened, and the flexible-column rule moves into the manager. Joining no longer requires the conference pane; closing it leaves the call. Presence heartbeat and the two new permissions land here. Result: chat only, and chat plus Calendar, work.
2. **The floating conference.** The conference pane can float over the canvas. Its toolbar becomes its bar; the fullscreen and pop-out buttons move into its header; the aside, recall and away overlays and the settings and reaction popovers anchor to the conference pane instead of the stage.
3. **The conference in its own window.** Replaces the whole-stage pop-out: the conference pane moves to a window and the other panes stay on the main page. The room card's pop-out join opens the chosen panes accordingly.
4. **Remembered layouts.** The panes, modes and sizes used last in each room are restored on join, and "Join with" on the room card exposes them.

## Risks

- The conference pane is the most tightly coupled thing on the page: tile sizing, toolbar collapsing, three overlays, the popovers, fullscreen and the pop-out. Stage 2 is where regressions will show; it needs real calls to verify.
- "Leave the call, stay in the room" is a new state with its own edge cases: reconnects, asides in progress, admin tools, and the away state.
- Presence by heartbeat can lag a browser that vanishes without saying goodbye; the grace period trades accuracy for stability.
- Picking a hidden pane from the Modules menu on a narrow screen needs a defined result: it takes the place of the lowest priority pane showing, or is brought to the front, and stage 1 must settle which.
