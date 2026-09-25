# Canvas Plan

**Audience:** whoever is building the room page's pane model, and the author reviewing it before any of it is built.

**Status:** All four stages built, awaiting a real call to verify. Delete this plan once the real-call checks below pass and the TODO entry is done; the rules are already in [architecture-canvas](../architecture/architecture-canvas.md). The decisions below are settled. Delete this plan once the last stage is done and its rules are in [architecture-canvas](../architecture/architecture-canvas.md).

## The idea

Today the room is "a video conference with optional modules". The better picture is a **canvas** with three kinds of pane on it: the conference, the chat, and any number of modules. Chat and modules already go through one pane manager and can each be docked, floating or in a window of their own ([architecture-canvas](../architecture/architecture-canvas.md)). The conference is the exception: it is the stage itself, always present, always the first column.

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
| Narrow screens | Panes keep showing in a fixed order of priority: the conference first, then the chat, then modules (their own order is decided as they are built). While the person is in the call, the conference is never hidden, because a hidden conference would leave their microphone or camera live without them seeing it; they close it, which leaves the call, if they want it gone. When there is not room for every open pane, the lowest priority ones drop out of view first. A pane that drops out stays open and comes back when there is room. Picking a hidden pane from the Modules menu shows intent, so it takes the place of the lowest priority pane showing, never the conference. |
| Presence | Anyone in the room is online, whichever panes they have open, including only the Calendar. OBS, Studio and the room list treat them as online and show their Online picture. |

## What presence needs

Today "online" and "in this room" come from LiveKit's participant list, and chat travels over LiveKit's data channel, so a person with only the chat or the Calendar still has to be connected to LiveKit. That changes the presence design from the heartbeat first planned:

- The page stays connected to the room's LiveKit session for as long as the person is in the room, and sends and receives audio and video only while the conference pane is open. So "in the room" is still LiveKit's participant list, and no heartbeat or grace period is needed.
- A participant attribute, `call`, says whether they are in the conference (`on` or `off`). The server puts it in the token, so a person who joins without the conference is never shown as a tile, and a person changes it when they close or reopen the pane. Others draw a tile only for people whose `call` is not `off`.
- `/api/table` adds `inCall` for each person. OBS views, Studio and the room list treat anyone in the room as online whether or not they are in the conference.
- An aside is still a call feature: the aside tools only act on people who are in the conference (the server refuses the others).
- The "See and join the conference" permission is enforced by the server: a role without it gets a token that cannot publish or subscribe. "Open and read the chat" is enforced by the page, as the chat's other permissions are.

## Stages

Each stage keeps the default experience unchanged and is verified before the next.

1. **The conference as a closable pane.** The stage's conference area joins the pane manager as a native pane that can be closed and reopened, and the flexible-column rule moves into the manager. Joining no longer requires the conference pane; closing it leaves the call. Presence heartbeat and the two new permissions land here. Result: chat only, and chat plus Calendar, work.
2. **The floating conference.** The conference pane can float over the canvas. It gets the same titlebar as the other panes; the full screen and pop-out buttons move to the app header and apply to the whole app; the aside, recall and away overlays and the settings and reaction popovers anchor to the conference pane instead of the stage.
3. **The conference in its own window.** The conference pane moves to a window and the other panes stay on the main page. The header's Pop out still moves the whole app. The room card's pop-out join opens the chosen panes accordingly.
4. **Remembered layouts.** The panes, modes and sizes used last in each room are restored on join, and "Join with" on the room card exposes them.

## Progress

Stage 1 (the conference as a closable pane):

- [x] The conference joins the pane manager as a native pane (docked only), first column and the flexible one; the flexible-column rule lives in the manager (`syncDock`, `--stage-cols`).
- [x] Closing the conference leaves the call and stays in the room: media stops both ways, tiles go, the `call` attribute goes to `off`; "Rejoin call" in the Modules menu brings it back.
- [x] The hang-up button leaves the call; Leave room stays in the header. In a pop-out window hang-up brings the stage back to the page first.
- [x] The Modules button moves to the header while the conference is closed; the menu belongs to the stage.
- [x] Nothing open shows a hint instead of an empty stage.
- [x] Permissions "See and join the conference" and "Open and read the chat" (Panes group), everyone on by default; the first is enforced in the LiveKit token.
- [x] Presence: settled without a heartbeat (see above); `inCall` on `/api/table`; aside targets must be in the conference.
- [x] Narrow screens: the conference stays as a strip above the chat; a module still floats. Picking the chat on a narrow screen replaces nothing else, since only one docked pane fits below the strip.
- [x] Checked in a browser with forced states: docked columns with and without the conference, the chat as the flexible column, the empty hint, the menu under the header button and above the toolbar button, the narrow strip layout, the Roles grid, and tokens for an admin, a call-off join and a role without the conference.
- [ ] Verified in a real call with two people: closing and rejoining the conference, the other person's tile leaving and returning, chat with no conference, hang-up in a pop-out, a role without the conference, an aside with someone who is out of the conference.

Stages 2 and 3 (built together, as asked):

- [x] The conference has the same titlebar as the other panes, with dock or float, open in a window, and close (which leaves the call).
- [x] The conference can float (a panel, wrapped in its own `.stage`) and can be in a window of its own with the other panes staying on the page; moving between the three leaves the call running.
- [x] The aside, recall and away overlays cover the conference itself, wherever it is. The settings and reaction popovers hang off the toolbar as before.
- [x] The floating toolbar in the popped-out window is gone: the popout has the same titlebar and toolbar, which slide away when idle and back on movement.
- [x] Full screen and Pop out moved out of the conference into the header, at the right (Modules, Full screen, Pop out, Sign out), and apply to the whole app. The Modules button left the toolbar and is only in the header. Pop out moves the header too, so the popped-out app is complete; the page behind offers "Bring the app back".
- [x] Fixed after a first real test: a pane's window fired its "closed" handler when the blank page it opens as navigated, which closed the pane at once (and left the call) and left an empty window with dead icons.
- [x] The compact and tiny sizes follow the conference's own width, not the stage's.
- [x] Checked in a browser with forced states: docked with the chat, floating and docking back, the popout look in both idle and awake states, the header order, the menu from the header and from the popped-out titlebar, a phone-width header and strip.
- [ ] Reported after a real test and not reproduced: in a popped-out app, the icons in the chat and calendar titlebars did nothing. The header now moves with the app; needs a retest in a real window, with the console open if it still happens.
- [ ] Verified in a real call and in real windows (the test browser blocks popups): the conference floating with live tiles, the conference alone in its own window (tiles and audio keep playing after the move, hotkeys, idle, popovers), closing that window, the whole-app pop-out with the new titlebar and toolbar sliding, Full screen from the header while popped out, and the header's Modules button beside a conference in a window.

Stage 4 (remembered layouts):

- [x] Each room remembers its open panes, modes and sizes in the browser and restores them on join; a room not used before opens with the conference.
- [x] Teardown never becomes the layout (the manager is suspended from the start of a disconnect until the next restore); an aside remembers nothing.
- [x] "Join with" on the room card: a sliders button opens a list of the conference, the chat and the room's modules (limited by the role), saved for that room without joining.
- [x] Checked in a browser: the card's popover, a chat-only choice restoring chat without the conference, the saved list following opens and closes, and a simulated teardown leaving it alone.
- [ ] Verified in a real call: joining chat-only and reading the chat, joining with the Calendar only, the layout surviving a reload, a dropped connection, and a real leave.

## Risks

- The conference pane is the most tightly coupled thing on the page: tile sizing, toolbar collapsing, three overlays, the popovers, fullscreen and the pop-out. Stage 2 is where regressions will show; it needs real calls to verify.
- "Leave the call, stay in the room" is a new state with its own edge cases: reconnects, asides in progress, admin tools, and the away state.
- Presence by heartbeat can lag a browser that vanishes without saying goodbye; the grace period trades accuracy for stability.
- On a narrow screen with the conference showing, a picked module still floats over it, which can hide the conference. Modules join the split below the conference strip in a later stage.
