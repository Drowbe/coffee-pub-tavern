# Changelog

All notable changes to Coffee Pub Tavern. Format follows Keep a Changelog, and versions follow SemVer.

## [Unreleased]

### Fixed
- Travel 0.3.1: the nights a stay covers (and its check-out day) sit at the top of each day as a banner, not at the end after the timed items; an item from another module whose card is all day, or whose time is exactly midnight (a date with no time), is treated as having no time of day instead of sorting first as 00:00 with a false gap. A check covers the midnight case.

### Changed
- Travel 0.3.0 lays the days out top to bottom at every width instead of as columns side by side, which did not scale to a long trip: one scrolling list with each day's heading held at the top and the strip of days always shown; on a wide pane the list keeps a readable width. A stay's later nights no longer squash into a narrow column. Verified in a browser with a 22-day trip.

### Changed
- A room's own page has a **Modules** tab that holds everything about modules: which are on for the room and their settings for it. The tab only appears when there is something to set, and a module's settings for the room appear as soon as it is ticked. Verified in a browser: the tab hidden with no modules, present with modules, opening on it from the address, and the settings appearing after ticking a module.

### Added
- Module settings. A module declares settings in its manifest (yes/no, a choice, a number or short text) with a scope: `server` (an admin), `room` (an admin or that room's moderators) or `person` (each person). Tavern draws the forms (the Modules tab, the room's page, a page for a room's moderators, the profile page), keeps the values, checks them against the declaration and tells the module (`tavern.settings.get()` and `onChange`). Changes to server and room settings are logged in the activity list. A setting holds plain data, never a secret. First users: Calendar 1.17.0 ("Open on", per person) and Polls 1.12.0 (close new polls after N days, server; suggested options on by default, room). Verified against a running server and in a browser: the three scopes and their permissions (a member ticked as moderator may set a room's; another member, another room and the server's are refused), validation, the values a module sees, the activity lines, the moderator page saving, the profile panel, and the Calendar opening on the chosen view. Not verified: the Modules-tab and room-page panels in a browser, and the moderator button on the rooms page.

### Added
- Calendar 1.16.0: a **Week** view (seven day columns with their events in full, a vertical list in a narrow pane; the arrows step a week and the month follows), and the view buttons are icons with titles (Month, Week, Month + list, List), now shown in narrow panes too. Opening a day from the dashboard also sets the week.

### Changed
- The Modules tab shows how many module updates wait as the same count bubble as the header gear (9+ past nine) instead of "Modules (3 updates)", with a tooltip.

### Changed
- Travel 0.2.2 adds items from the shared bar at the bottom of the pane, like the To-do, Polls and Calendar, instead of a row in each day (the Ideas column keeps its own row, and a pane with no bar keeps them all). A typed day of the trip wins over the day in view. Bookings shows each reference code as a chip.

### Fixed
- Quick add read "sunset" as Sunday, "monument" as Monday and so on: a weekday now has to be a whole name or a usual short form (mon, tue, tues, wed, thu, thur, thurs, fri, sat, sun). Verified: "Sunset walk at 6pm" keeps its title.

### Added
- Travel 0.2.0: a **Bookings** view (stays and journeys with reference codes), a **Money** view (costs with who paid and who shares them, each person's balance, and the fewest payments that settle it; a trip currency), following a poll's result (an item can follow the item it points at: when it reports a result the item keeps it and a stop appears on the day it names), dragging a trip item out to link a task, and dropping items from other modules onto items with the same drop menu the Calendar uses. Travel now asks to hear events (an admin approves it on update). Verified in a browser with seeded data: Bookings and Money with the right balances and settlement, and a followed poll closing once (the result on the item and exactly one stop added); the sums are also checked without a page (`tools/check-travel.mjs`, 23 checks). Not verified: dragging out and the drop-on-item menu in a real browser, and two people.

### Changed
- Calendar 1.15.0 has a third view, **Month + list**: the month grid with that month's events listed under it. To-do 1.11.1 draws only one place to add a task: when the host draws the bottom bar, the field at the top is hidden.

### Added
- Oversight for modules. The recent-activity list on the Modules tab is kept across restarts, and what a module does through Tavern is rate limited per module and person: 240 saves, 60 events, 60 asked actions, 60 schedules and 20 notifications a minute. Over a limit a call gets 429 (with `Retry-After`) and the activity list notes that the module was slowed. Verified against a running server: 240 saves went through and the next 20 were refused with 429, the activity list showed one "was slowed" line, and the list was intact after a restart. The limits cover only what passes through Tavern, so they do not bind a module running in the page.

### Fixed
- Travel 0.1.2: an item from another module (a Calendar event) sorts by that item's own time, not first in its day; two travellers whose names start with the same letter show two letters as their initial ("Ch", "Cl"). The phone header, the time column, "any" for untimed items, the owner checkboxes and the empty-trip wording are refined in `travel.css` and `travel.html`. A check covers the sort.

### Fixed
- Travel 0.1.1: an item whose card gives its time in milliseconds (a poll's closing time) stopped the Decisions view drawing and was never suggested or placed on its day. A card's time may now be a day, an ISO moment or milliseconds. Verified in a browser with a linked task and poll: both suggested on their days, added as pointers, and listed under Decisions.

### Added
- Travel 0.1.0, a module that ships with Tavern: plan a trip for a room, day by day. A trip has dates; each day has stops, stays (drawn on every night they cover), journeys and notes, in order (untimed first, by hand, then timed by time), with gaps shown between timed items. Items move by dragging on a computer and by an item menu (Earlier, Later, Move to day, Back to ideas) anywhere; an edit that meets someone else's change shows Use theirs or Keep mine. Dated items other modules hold on a trip day are offered as suggestions and can be added as pointers; another module can add to the trip through two actions (`addStop`, `addToDay`) and by dropping an item on a day. A Decisions view lists what is linked to the trip and still open. A Trips card on the rooms page shows the next trips and today's items. Built with the interface side: `travel.html`, `travel.css` and `CONTRACT.md` are theirs, the script and data are the modules side's. New SDK call `tavern.people()`; a module's libraries can be several files. Verified in a browser: the trip page on desktop and at phone width, adding with a time typed, the item menu, moving between days, the editor, dragging with the drag state toggled and cleared, a version conflict with Keep mine, creating a trip from the empty state, and the dashboard card; the model and plan are also checked without a page (`tools/check-travel.mjs`). Not verified: two people at once, a live call, the Decisions view with real links, and the suggestions list with a live poll or task.

### Added
- Who's around shows who is online, not only who is in a room: every page tells the server it is open (`POST /api/presence`, every half minute while visible), and `/api/table` reports `present`. Each person shows their room or "online".
- Invite someone to talk: a people-arrows button beside each online person makes a private room for the two of you and takes you into it (`POST /api/table/invite`); they get a toast with Join and Decline on whatever page they have open, over the existing notification stream. Off the record like a pull-aside; needs the private-conversation permission and setting; an invitation lasts two minutes.
- Widget items show their room's icon on the left and a circle-right arrow on the right (Calendar 1.14.0, To-do 1.11.0, Polls 1.11.0). New `tavern.ui.icon(name, style)` gives a module any Font Awesome icon as inline SVG (`/api/icons/:style/:name`), for a sandboxed frame.
- Verified: against a running server with two accounts (offline invite refused, presence, the invite, the invitee's live event, self-invite and bad icon names refused) and in a browser (the strip with the invite button, the ad hoc room created, the invitee's toast, and Join reaching the join step, which fails only because the test server has no media server). Not verified: an actual conversation with two people in a call, and the toast on a phone.

### Changed
- The rooms page has a new layout: the dashboard is a sidebar on the left (sticky under the header), and the right has a Who's around strip over the room cards in two columns. One column on a phone, rooms first. The Calendar's Coming up is now a small month with a dot on each day that has something, over the next few events; clicking a day opens the full calendar on that month with the day marked. To make that possible a module can ask for its own page at a place in it: `tavern.page.open(hash)` from a widget, and `tavern.page.onHash(fn)` on the page. Widget size `tall` added. Calendar 1.13.0. Verified in a browser at desktop and 375px wide, and the day click opening the calendar on the right month. Not verified in a light theme, or on a real iPhone.

### Changed
- Opening an item from a dashboard widget takes you into its room with just that module's pane open on it, instead of onto the module's page: an item in a room joins that room (or returns to it) with the module docked and showing the item. That layout is not remembered as the room's until you open or close a pane yourself.
- The header no longer has an item for a module that has a dashboard widget (Calendar, To-do and Polls): the widget card's heading opens the module's page, and the module's unread count shows on the card. A module with a page and no widget keeps its header item, so nothing becomes unreachable.
- Verified in a browser: after asking for an open on an event, only the Calendar opened with the event's editor showing, the room's remembered panes were unchanged until the chat was opened by hand, the header had no module items, and the To-do card showed an unread count. Not verified: the full click-through with a real join (it needs a LiveKit connection, which the test server does not have).

### Added
- Two more dashboard widgets. To-do 1.10.0 provides **Due soon**: tasks not done that are due within a week or overdue (overdue in red), soonest first, across all your rooms and the server's list. Polls 1.10.0 provides **Need your vote**: open polls you have not voted in, soonest closing first. Each item shows its room's icon and opens in its room. Verified in a browser with seeded data: overdue, tomorrow and later tasks listed, and done, far-off, undated, voted and closed items left out; clicking a poll opened it in the room's Polls. Not verified: two people, and a poll in a room where the viewer cannot vote (the widget lists polls the viewer can read).

### Added
- A dashboard on the rooms page, under the room cards: who is around, and a card for every module that offers a widget. A module declares `surfaces.widget` (an entry, a title, a size and an order), Tavern lists them (`GET /api/modules/widgets`) and hosts each as it hosts a module page, so Tavern names no module. Calendar 1.12.2 provides **Coming up**: the next seven days across all your rooms and the server calendar, with each room's icon; clicking an item opens it in its room, the heading opens the calendar. A module's build can share code between its page and its widget (`src/<id>-lib.js`). Verified in a browser: the dashboard with the Calendar widget in the page and in a sandboxed frame (sized to its content), on desktop and at phone width, and an item opening its event in the room's calendar. Not verified: a repeating event from a room the viewer is a member of, and two people.

### Changed
- The chat's Send button is the right-from-bracket icon (it keeps the label "Send" for screen readers and as a tooltip), the same size as the other controls in the bottom row.

### Added
- Chat history on the server. A room now keeps its last 500 text messages (none older than 30 days), so someone who joins late, or from a new browser, reads what was said; before, each browser kept its own copy and a new person saw almost nothing. The sender posts each message to the server (`POST /api/rooms/:id/chat`) and everyone reads the history on joining (`GET /api/rooms/:id/chat`), above a line marking where they came in. Text only: pictures stay live, and a pull-aside room keeps nothing. Reading needs the chat permission and membership of the room; posting is rate limited; deleting a room deletes its history. Clear chat now hides what came before on that browser only. Verified against a running server: anonymous 401, unknown room 404, an outsider refused on a room, empty and oversized messages, the rate limit, and history surviving a restart. The join-time rendering (history above live messages, Clear chat, no posting from asides) was run in Node against the real code with a stubbed page. Not verified in a real call with two people.

### Fixed
- Typing an S (or M, V, D, C, L, R, F or a digit) in a module's field opened the screen-share picker, or toggled the mic, camera, chat and so on. A module that runs in the page keeps its fields in a shadow root, where the page's key handler saw only the root's host as the target and did not know a text field had the focus. It now looks at the field the key actually went to. Verified in a browser: typing "Yes, Sms Mvd" into a poll option did not call the screen-share picker, or open the chat.

### Fixed
- The controls in the shared bottom row were different heights (the call toolbar's 38px buttons, the chat's 25 to 33px input and Send, each module's quick-add) and sat a couple of pixels apart. They all use one height token now, `--bar-control-h`, and line up. Verified in a browser: the chat icons button, input and Send, and the Calendar and To-do quick-add fields and buttons all measure 38px tall from the same top and bottom edge, and a multi-line message grows the chat upward. Not verified with the call toolbar itself on screen (it needs a joined call); its buttons were already 38px.

### Changed
- The chat box's formatting toolbar is a layer above the input row, opened by a new icons button to the left of the box, so the chat bar is one row instead of two. The picture button moved into that layer. It closes on a click elsewhere, Escape, or choosing a picture. Verified in a browser at desktop and phone width: bold applied to the selection with the layer staying open, the emoji popup opened inside it, and outside click, Escape and the picture button closed it.

### Changed
- On a phone, one view at a time, the conference included: the conference, the chat and each module are tabs, and the one shown takes the whole stage. The others stay open and hidden, so the call keeps running while the chat is read; tapping a tab switches the view and never closes a pane or hangs up. The conference strip above the chat is gone. The conference tab carries `in-call` while the call is on, so the tab bar can show that a microphone may be live with the conference out of sight. Verified in a browser at 375px wide with the call panes open: chat, calendar and conference each took the whole stage, the highlighted tab followed the view, and tapping the shown tab did nothing. Not verified in a real call with a live microphone.

### Fixed
- The chat box's bottom bar was painted from the page colour while the video toolbar and the module bars beside it used the shared shade, so in a light theme it looked like a different theme. All the cells of the shared bottom row now use the same background.

### Changed
- On a phone (a stage under 640px wide) one pane is open at a time, and a module opens docked, filling the area under the conference strip like the chat does, instead of floating. Opening the chat or a module closes any other pane except the conference; a module that cannot dock still floats; its titlebar buttons are wider for touch. Verified in a browser at 375px wide: opening the chat, then the Calendar, then the To-do left one pane at a time, each filling the screen with its quick-add bar at the bottom. Not verified: with the conference joined (the strip above the pane), which needs a real call.

### Added
- An update indicator on the settings gear in the header: a small count badge (and a tooltip, "Manage: 1 module update available") when a module that ships with this Tavern has a newer version than the one installed. Admins only; it clears when the update is applied on the Modules tab. Verified in a browser with a newer bundled version: the badge showed on the gear, and disappeared after the update was installed.

### Changed
- Icons: the To-do titlebar uses an empty square for open and a ticked square for done; Polls uses an open padlock for open and a closed padlock for closed; the quick-add button is a plus in a circle. To-do 1.9.1, Polls 1.9.1.

### Fixed
- Quick add did not understand "noon" or "midnight": "lunch fri at noon" kept "at noon" in the title and the default time. Both are times now.

### Added
- The drop menu remembers the last choice: `tavern.actions.pick(items, point, { remember })` keeps it per browser and module and lists it first, marked "last used". The Calendar keys it by the kind of item and whether it landed on a day or an event (Calendar 1.11.1). Verified in a browser: after choosing "Set this task's due date", the next drop listed it first with "last used", and it set the task's due date.

### Changed
- The bottom bar of the Calendar, To-do and Polls is now a quick-add field with a small + button, bottom-aligned with the chat box, replacing the Add event, Add task and New poll buttons. What is typed opens the add form filled in, and a shared parser in the SDK (`tavern.util.parseWhen`) pulls a date and time out of it: "meet with bob sep 29 at 7pm" becomes a title, a day and a time. The bar item is `{ type: 'quickadd' }`, available to any module. Calendar 1.11.0, To-do 1.9.0, Polls 1.9.0. Verified in a browser: all three bars, and the Calendar, To-do and Polls forms prefilled from typed text; the parser was also run on eleven phrases. Needs the `.quick-add` rules in `public/style.css`, which come with the room header work.

### Added
- Rules that create things in other modules. A rule on a task's link can ask another module to act on what the item reports: the To-do offers every action another module provides whose required fields the event can fill (a date, its summary, the item itself), and asks once however many people have it open. Poll options can carry a date (Polls 1.8.0) that goes out with the result. To-do 1.8.1 asks for `actions.uses`, which an admin approves. Verified in a browser: a poll with dated options was voted and closed, and the task's rule created the calendar event on the winning date; the editor offered "Calendar: Add it to the calendar". Not verified: two people with the To-do open at once (the once-only guard is the task's version check).

### Added
- The Calendar announces when an event has passed (Calendar 1.10.0, event `ended`, with a one-line summary), once, by whoever has it open first after it ends; repeating events and events more than a week old are skipped, and moving an event clears the mark. A task linked to the event can follow it with the same rules as a poll closing. Verified in a browser: a past event with a linked task set to tick and keep the result was announced on opening the Calendar, and the task ticked and got "Result: Trip day one, Sep 19".

### Added
- Shared tools in the SDK. `tavern.ui.datePicker` (the Calendar's picker, now for any date field, with the weekday shown under it, Escape to close and an optional shaded range) and `tavern.util` (`esc`, `id`, `refKey`, `ymd`, `parseYmd`), so modules do not each carry a copy. Calendar 1.9.2, To-do 1.7.2 and Polls 1.7.1 use them; the To-do's due date and a poll's closing time now have the picker. Verified in a browser: the picker in the To-do (open, choose a day, weekday updated), and the three pickers in the Calendar's editor and one in Polls'. Not verified: the Calendar's shaded range after the move.

### Added
- A rule on each link. An event can declare the data it carries, and Tavern tells a module what each kind of item it may link to can report (`/api/refs/kinds` now lists events and their data). To-do 1.7.1 shows, under each link, what the item can report and lets the person choose what the task does: tick, add the result to the notes, use it as the title, or link what it picked. The older per-task settings are folded into rules.
- A poll option takes a link. Polls 1.7.0: drop an item from another module on an option; the option shows it, the poll tells Tavern what it points at, and when the poll closes the winning option's item goes out with the result (`pick`). Verified in a browser: an event dropped on an option, a rule chosen on a task, the poll voted and closed, and the task then linked to the event. Not verified: two people, and a real mouse in the deployed build.

### Added
- Dropping an item on a module offers what can be done with it. An action's `ref` input can name the kind of item it takes (`ref:todo:task`), Tavern enforces it, and `tavern.actions.list({ accepts, self })` lists the actions that take a given kind. `tavern.actions.pick(items, point)` shows a small menu at the drop so the person chooses when there is more than one thing to do. Nothing in Tavern or in the modules names the module the item came from.
- Calendar 1.9.1: drop a task on a day to add it as an event or set its due date, or on an event to link the task or set its due date to the event's; provides a "createEvent" action other modules can ask for. To-do 1.6.0 provides "linkTask" and "setTaskDue", and a task can add a linked poll's result to its notes when it finishes. Polls 1.6.1 sends a one-line summary with its close event. Verified in a browser: a drop on an event offered both choices and linking worked through the To-do's action; a drop on a day offered adding an event (created) and the due date; a poll closed from its own page added its result to a linked task and ticked it. The due-date choice was offered but not run in the browser. Not verified: two people, and a real mouse in the deployed build.

### Changed
- Modules can run in the page, not only in a sandboxed frame. Modules that ship with Tavern run in the page, each in its own container with its own shadow root, so they can share drag and drop, layout and theme with the page. Modules an admin uploads stay sandboxed unless the admin switches one to run in the page after a plain warning that such a module can read and change everything on the page and that Tavern can no longer hold it to its approved permissions. The Modules tab marks each card "In the page" or "Sandboxed", offers the switch, and lists recent activity. One SDK works either way (`createTavern`); modules look elements up in `tavern.root` rather than `document`, and an uploaded module that runs in the page must be a single HTML file with its style and script inline. Calendar 1.8.0, Polls 1.5.0 and To-do 1.5.0 use `tavern.root`. Verified in a browser: all three in the page with no frames, and a drag from a Calendar event onto a To-do task linking it. Not verified: a real mouse in the deployed build, and two people.

### Fixed
- The container image left out the `modules/` folder, so the bundled modules (and their updates) were never offered on a deployed server. The image now includes it, and a `.dockerignore` keeps local data, git and built zips out of the build.

### Added
- Modules can react to and ask things of each other, through generic conduits with no module named in Tavern. **Events**: a module declares the events it publishes and the ones it wants to hear (`events.publishes` / `subscribes`, the latter approved by an admin); Tavern delivers each to the modules approved to hear it, about modules the person can see, live and, for a module that was not open, when it next is (`tavern.events.publish` / `subscribe`). **Actions**: a module declares what it can be asked to do (`actions.provides`: a name, a label and typed input) and what it wants to ask for (`actions.uses`, approved by an admin); Tavern checks the input against the declared types, queues the request for the owning module, and its page carries it out (`tavern.actions.list` / `request` / `provide`), one page only, however many people have it open. Modules that offer an action appear as buttons in modules that use `"*"`, with no change to either.
- Polls 1.4.0 announces when a poll closes (by hand or by its time) and offers, on a closed poll, a button for every action another module offers that takes a title. To-do 1.4.0 hears events, can tick a task when a linked item is finished (a per-task setting) and provides an "Add a task" action, which a finished poll uses. Verified in a browser: closing a poll ticked the task that followed it, the closed poll offered "Add a task", and using it created a linked task that the poll then listed under Linked from. Verified against the API: declared events only, other modules' items refused, oversized data refused, delivery only to subscribers, action input checked, unapproved asks refused, one claim only, and a request's status private to its asker. Not verified: two people with the same module open, and delivery to a module in another browser.

### Added
- Links do something, through generic conduits, with Tavern naming no module. A link to another module's item is a button that opens the item where it lives (`tavern.refs.open`, answered by the owner's `tavern.refs.onOpen`): the module's pane opens, or its page, and it shows the item. The item shows what links to it (`tavern.refs.linksTo`, for a kind marked `backlinks`): an event lists the tasks linked to it, a poll the same, and clicking one opens it. A module tells Tavern what its items point at (`tavern.refs.setLinks`); Tavern keeps only the pointers (`server/module-links.js`), and shows each only to people who can see its source.
- Modules can consume `"*"`, whatever other modules share, and ask Tavern what that is (`tavern.refs.kinds`, `/api/refs/kinds`). The To-do no longer names the Calendar or Polls: a module installed later, declaring what it shares, is linkable from a task with no change to either. Checked against a small test module (Places) installed after the others. A kind can also carry a display `name`, and flags `open` and `backlinks`.
- Calendar 1.7.0, Polls 1.3.0 and To-do 1.3.0 use them. To-do 1.3.0 asks the admin to approve linking to whatever other modules share.

Verified in a browser: a task's link opened the Calendar pane on the event's editor, which listed the task under Linked from, and clicking that opened the task in the To-do. Verified against the API: links, backlinks, refused impersonation, a deleted item dropping out, and a module added afterwards appearing in the To-do's kinds and search.

### Fixed
- Installing a module whose module.json omitted `hooks`, `permissions` or `access` failed with a server error; the stored manifest is the author's original, so the gaps are now filled in when it is read.

### Added
- A trace for drags between modules, to find where one stops: open Tavern once with `?debug=1` (`?debug=0` turns it off) and every step (pressed an item, drag began, pointer over a module, released, drop received, why it was ignored) shows as a line in a box at the bottom left of the page. To-do 1.4.2 adds the reason a drop was ignored.

### Fixed
- Joining a room with only the chat left the conference's titlebar and toolbar showing over the chat's (the conference pane was hidden only after it had been closed once, never at the start). It now starts hidden.
- Dragging still did nothing on drop for you, so it no longer uses the browser's drag and drop, which does not reliably carry a drag between sandboxed frames. It is driven by the pointer: press an item (an event, a poll's question, a task), move a few pixels, and Tavern draws its label at the pointer and hands the drop to the module under it (`tavern.refs.draggable`). Calendar 1.7.1, Polls 1.4.1 and To-do 1.4.1 use it. Verified in a browser through the host: the label followed the pointer, the task under it highlighted, and the drop linked the event to the task; the frame's press-and-move handling is checked in isolation. Not verified with a real mouse in a real browser, which my test browser cannot do: if it still does nothing, the browser console shows nothing yet, so tell me and I will add a visible trace.

### Fixed
- Dragging an event or a poll onto a task did nothing on drop. A drag that starts in one module frame does not reliably deliver its data into another, so Tavern now brokers it: while a drag lasts it puts an invisible layer over the other module frames, tells the frame under the pointer where the drag is and what was dropped, and removes the layers when the drag ends (or after 20 seconds). Modules receive it with `tavern.refs.dropTarget`. To-do 1.2.1 uses it, and highlights the task the drag is over. Verified in a browser: the layer went up over the other pane, accepted the drag, the task highlighted, the drop linked the event to the task, and the layers came down. Not verified with a real mouse drag, which the test browser cannot perform.
- `npm run check` did not parse the browser scripts as modules, so an error only a module parse finds (a name declared twice) passed, and one such error broke the room page. It now checks those files as modules (`tools/check-syntax.mjs`).

### Added
- Calendar 1.6.0: a date picker. Each date field has a calendar button that opens a small month with the days of the week across the top, so the weekday is visible while choosing; typing still works, the weekday of the date in the field shows beneath it, and when choosing an end date the days from the start are shaded.
- Modules can put icon buttons in their titlebar (`tavern.header.set`), before the pane's buttons and set off by a pipe. To-do 1.2.0 and Polls 1.2.0 use it for Open / Done (Closed) / All, and drop the title that repeated the titlebar's name above their content. On a module's server page, which has no titlebar, the buttons stay in the page.

Verified in a browser: the To-do and Polls titlebars with the filter icons (choosing Done changed the list and marked the icon), the picker opening under the end date and filling it, with the weekday shown. Not verified: the module's own window titlebar.

### Added
- Modules that ship with Tavern install and update from Manage without uploading a zip. The Modules tab lists the ones not installed under "Available with this Tavern" with an Install button. When a server update carries a newer version of an installed module, its card says "Update available" with an "Update to" button, and the tab reads "Modules (1 update)". An update keeps the data, keeps the old version to switch back to, and stays off until approved if it asks for anything new. The zip builder moved to `server/module-build.js`, shared by the build tool and the server; uploading a zip still works, and is the way to add a module that does not ship with Tavern. Verified in a browser and against the API: the update banner and the tab count, an update that asks for a new link staying off until approval while keeping the old version, an unknown or path-like id refused, and a non-admin refused.

### Added
- Modules can point at each other's items (refs), the one narrow door between otherwise isolated modules. A module lists in `module.json` the kinds of item it lets others point at (`refs.produces`: a kind, the stored key and which fields make the card) and the kinds it wants to point at (`refs.consumes`, approved by an admin when enabling, and shown on the module's card). A pointer is stored instead of a copy, and Tavern turns it into a small card each time it is drawn, only for people who can already see the item; a deleted or hidden item reads as not available. The SDK gains `tavern.refs` (`make`, `resolve`, `search`, `drag`, `accepts`, `parse`) and the server `/api/refs/resolve`, `/api/refs/search` and `/api/modules/:id/refs/:kind/:id`. Storage and permissions are unchanged. This is the module issue's proposal (Refs #1), with one change: the card is built by the server from the fields the producer names, because modules have no server code to ask.
- Calendar 1.5.0, Polls 1.1.0 and To-do 1.1.0 use them. Events and polls can be dragged, and a task can link to up to five events and polls (search from the task editor, or drop one on a task), shown on the task with their name and date. To-do 1.1.0 asks the admin to approve its links. Upload the three new zips on Manage > Modules after deploying.

Verified against a sandbox server: an approved consumer resolves events and polls, unapproved, missing, invalid and unauthenticated requests are refused with the right errors, a stored record's other fields never leave it, a non-member gets nothing from a room's data, a role without a module's view permission gets nothing from it, and the search and link flow in the To-do editor showed both links on the saved task. Not verified: dragging between two frames (the test browser does not perform real drag and drop), and two people.

### Changed
- In a room the header no longer shows the links to the global module pages (Calendar, To-do, Polls); the Modules button is the way to a module there. Out of a room they are unchanged.

### Added
- Calendar 1.4.0: events can last several days. An event has a start date and time and an optional end date and time (an all-day event's end is its last day). It shows on every day it covers in the month, with an arrow on the days after the first, and the list shows the span; a repeating event keeps its length, and an event that began before the month still appears in it. Existing events are unchanged. It replaces 1.3.0 (upload the new zip on Manage > Modules).

Verified in a browser against a sandbox server: an all-day event over four days, an overnight event across midnight, a five-day timed event that began before the week, the list and month views, and the editor's end fields. Not verified: saving a multi-day event from the editor, and repeating multi-day events.

### Fixed
- With three or four modules open in a room, each showed "Tavern did not answer". Every module (two streams for a room panel) held a live connection open, and a browser allows about six to one site over HTTP/1.1, so the modules' first requests never completed. All the modules on a page now share one live stream (`/api/modules/stream`). Verified in a browser: the Calendar, To-do and Polls docked together in a room all loaded, and a change made elsewhere appeared live in a room pane and on a module's server page.

### Added
- A Polls module (1.0.0), for deciding things together such as where to go, where to stay and what to do: polls for the server and for each room, as a header page and a room pane. Each option can carry a detail; a poll can allow more than one choice, let people add options while it is open, close itself at a set time, and notify people when it starts. Results update live with a bar, a count and the names of the voters; a closed poll marks its winner or a tie. Each person's vote is its own stored value, so people voting at once never conflict. It asks for three permissions (see, vote, start and close polls, of which only the first two are enforced by the server) and the notify hook. Guests can see but not vote. Build it with `node tools/build-module.mjs modules/polls`.

Verified in a browser against a sandbox server: the server page with a room's polls under its icon, voting and the result bars, suggesting an option, the closed view with a winner, and starting a poll from the editor. Not verified: the room pane in a call, a scheduled close, notifications, two people voting at once, and a guest.

### Added
- A To-do module (1.0.0): a shared task list for the server and for each room, as a header page and a room pane (docked, floating or in a window). Tasks have notes, a due date (overdue in red) and an optional reminder at 9:00 that day; there is a quick-add box, Open / Done / All views, and on the server page the lists of your rooms shown read-only under their room's icon, with chips to show or hide each. It asks for two permissions (see, and add and change) and the schedule and notify hooks. Build it with `node tools/build-module.mjs modules/todo`.

Verified in a browser against a sandbox server: the server page with a room's list under its icon, quick add, the editor and Save, ticking a task done, and read-only room tasks. Not verified: the room pane in a call, a reminder actually firing, two people, and a guest.

### Added
- Calendar 1.3.0: the server calendar shows, read-only, the events of every room you belong to (with the Calendar on for it), each marked with its room's icon, and a row of room chips to show or hide a room. It replaces 1.2.0 (upload the new zip on Manage > Modules; it asks for no new permissions).
- Modules: a server page can read across the viewer's rooms. `storage.list(prefix, { scope: 'rooms' })` returns items with a `roomId`, `tavern.rooms()` lists those rooms with their icons as inline SVG, and the module's live `change` events cover them. Only rooms the viewer is a member of, with the module on and readable by their role (an admin's access to every room does not count).

Verified in a browser against a sandbox server: events from two rooms on the month grid and the list with icons, a room the viewer is not in staying out, the filter chips, and a live add from another request appearing. Not verified: two people, and a guest.

### Added
- Rooms remember their layout. The panes open when you last used a room (the conference, the chat, modules), each pane's mode (docked, floating, in a window) and its sizes are restored when you join it; a room you have not used before opens with the conference. Hanging up is remembered like any other change.
- "Join with" on each room card (the button with sliders): choose the panes a room opens with before you join, so you can join with only the chat, or the chat and the Calendar. The list leaves out what your role does not allow.

Verified in a browser with forced states: the card's popover, a chat-only join restoring the chat without the conference, the saved list following changes, and a simulated disconnect leaving the saved layout alone. Not verified: a real join, a real reload and a dropped connection.

### Fixed
- A floating conference could not be resized: its toolbar reached the panel's corner and covered the drag handle.
- A pane in a window of its own could only dock again; its titlebar now offers both dock and float.
- A module opened in a window of its own had no titlebar. It now has one, with close and, while the room page that opened it is still open, buttons to bring it back as a docked column or a floating panel (the choice is remembered).
- The header's module links are icons only, the same size as the other header icons; the name is the tooltip.
- Popping the conference out with its titlebar button opened an empty window and left the call: the window's "closed" handler ran when its blank starting page navigated, closing the pane at once. The handler is now registered once the window has loaded. The chat's own window had the same fault.

### Changed
- Pop out (in the header) now moves the whole app, header included, into the popup, and the page behind shows a "Bring the app back" button. The header hides with the titlebar and toolbar when idle. The conference titlebar's own Modules and Full screen buttons are gone, since the header comes along. A header link in the popup brings the app back before it acts.

### Added
- The conference has the same titlebar as the chat and the modules, with buttons to float it, open it in a window of its own (the chat and modules stay on the page), and close it, which leaves the call. The header now holds the controls for the whole app, at the right: Modules, Full screen and Pop out, then Sign out; the Modules button left the toolbar, and Full screen and Pop out left the corner of the video. The header also reads profile, then the module links, then rooms and settings.
- The popped-out window no longer has a floating pill toolbar: it has the same titlebar and toolbar as the page, and both slide away when nothing moves and back on any movement, leaving only the tiles. Since the header is not there, the titlebar has its own Modules and Full screen buttons while popped out.
- The conference is a pane like the chat and the modules, and it can be closed. The hang-up button now leaves the call and keeps you in the room, with the chat and the modules still open; your tile goes for everyone else, and your microphone, camera and incoming audio and video stop. The Modules menu offers "Rejoin call", and while the conference is closed the Modules button is shown in the header. Leave room, in the header, is what leaves the room. The conference is the flexible column when it is docked, otherwise the first docked pane takes the leftover width, and an empty stage says nothing is open. On a narrow window the conference stays as a strip above the chat instead of being replaced by it.
- Two permissions in a new Panes group on the Roles tab: "See and join the conference" and "Open and read the chat". Everyone has both by default. The first is enforced in the LiveKit token: a role without it joins for the chat and modules only.
- `/api/table` reports `inCall` for each person. Anyone in the room is online whether or not they are in the conference; the aside tools refuse someone who is not in it.

Verified in a browser with forced states (no LiveKit server here): the columns with and without the conference, the chat as the flexible column, the empty hint, the menu under the header button and above the toolbar button, the narrow strip layout, the Roles grid, and the tokens for an admin, a join with the call off and a role without the conference. Not verified: a real call, two people, closing and rejoining the conference, and hang-up in a pop-out window.

### Changed
- The Modules tab of Manage lists Chat and Conference first, as built-in modules that are always on and cannot be removed. Every other module is listed beneath them.
- The toolbar has one button for panes: the Modules button (the puzzle piece), always shown, whose menu lists Chat and the room's modules. The separate chat button is gone; C still toggles the chat, and the chat's unread count shows on the Modules button. The menu now opens just above the button (or above More when the button has been tucked into it) instead of at the toolbar's right end. Verified in a browser: the menu centered on the button, Chat and Calendar listed, Chat opening and closing from it, and the unread badge. Not verified in a real call.

### Added
- Chat is a pane like a module: docked beside the video (the default), a floating panel, or a window of its own, with the same header buttons a module has. The chat's width is now one of the docked columns.
- Panes follow the call when it is popped out: chat and modules open in the popout window, docked or floating as they were, instead of floating over the main window.
- Module frames authenticate the host with a per-frame secret in the frame's address, instead of checking which window a message came from (which is wrong when the call has been popped out).

### Fixed
- The Calendar page opened over a call showed nothing: the overlay adds `room=<name of the room>` to every page it opens, and the module page took that as a room id. A module popped out of a room now carries its room as `moduleRoom`.

Verified in a browser with forced states: chat docked, floating, docked again and closed, with the columns following (video, chat, Calendar; Calendar alone when chat closes); dragging the chat edge; and the call stage moved into a stand-in second window, where the chat and the Calendar (with its Add event bar) worked and the columns shrank to keep room for the video. Not verified: a real popped-out window and the chat in a window of its own (the test browser blocks popups), a real call, and two people.

### Added
- Module action bars: `tavern.bar.set([...])` gives a module buttons the host draws along its bottom. Docked, the bar is a cell in the room's shared bottom row, so the Calendar's Add event button sits beside the video toolbar and the chat box; elsewhere it is a strip under the module. A manifest that does not list modes can now be docked or floating (Calendar 1.0.0 could only float because its manifest never said otherwise). Calendar 1.2.0 uses the bar and replaces 1.1.0.
- Modules can dock. A module whose manifest lists `dock` opens as a column beside the video and the chat (video, chat, module), with a header the host draws at the shared height and a drag handle to set its width. A pane can be switched between docked and floating, or opened in a window of its own (`/modules/<id>?moduleRoom=<room>&popout=1`); the choice and width are remembered per module. On a narrow window a module opens floating, and when the call is popped out docked modules float over the main window until it returns.
- Calendar 1.1.0: it docks by default and, in a narrow pane, shows the month on top with that month's events listed beneath. Events can repeat (daily, weekly, every 2 weeks, monthly, yearly, with an optional end date), and a repeating event's reminders keep coming.
- Repeating schedules for modules: `tavern.schedule({ repeat: { every, until, tz } })`. Tavern computes each next time in the given time zone, keeps the day of the month across short months, and puts the schedule back as it fires.

Verified in a browser against a sandbox server: the module docked as a third column with its header aligned to the chat's, the month-above-list layout in the narrow pane, switching between docked and floating and back, dragging the docked edge (400 to 480 px, remembered), the call-popout conversion and restore, the module popout page with a room in its address, and a repeating schedule firing and putting itself back for the next day. The repeat and Save logic were also run under jsdom against a fake SDK. Not verified: a real popped-out window opened by the pop-out button, two people, a real call, and the Save fix in a real browser (the sandbox flag is the standard cause of the symptom, but I could not reproduce it in the test browser).

### Fixed
- The Calendar's Save did nothing in a real browser: a sandboxed frame without `allow-forms` swallows a form's submit event. Module frames now allow forms (their policy still forbids submitting one anywhere), and the Calendar saves from the button as well as from the form.

### Added
- Modules run now. A module page is served sandboxed, with the SDK and base styles injected; modules read and write their own data per server or per room with versions and live changes, add permissions to the Roles grid, get a header item and a page (`/modules/<id>`), open as draggable floating panels from a Modules button in the call, are switched on per room from the room's page, and can schedule reminders and send notifications (toasts and unread counts). New server files `modules.js` (runtime helpers), `module-data.js` and `module-hooks.js`; new pages and scripts `module.html`, `module.js`, `module-host.js`, `room-modules.js` and `sdk/tavern.js`.
- The Calendar module (`modules/calendar`, built zip in `modules/dist`; the first version was 1.0.0, replaced by 1.1.0 above): a month grid and an upcoming list, events with reminders, for the server and for each room, updating live. `tools/build-module.mjs` builds a module zip from a source folder.
- Verified in a browser against a sandbox server: the SDK from inside a sandboxed frame (ready, permissions, storage with a version conflict, blocked network, parent and cookie access), live changes and schedule events reaching the frame, a schedule set from the frame firing a notification and toast, permission checks by role, per-room enablement, panel drag and resize, and the Calendar's month and list views in the page and in a room panel. Not verified: two people at once, a real call, real Chrome and Safari behavior for a sandboxed frame, and the Calendar form in a real browser (the frame could not be driven by the test tools). The Calendar's form and logic were instead run under jsdom against a fake SDK: adding an event with a reminder scheduled it the right time ahead, editing hit a version conflict message, deleting cancelled the reminder, a server event was read-only in a room, and a live change appeared.

### Changed
- On a narrow window the toolbar now collapses chat, then camera, then the microphone into the More menu after the other buttons, so the smallest bar is just More and leave. The More menu wraps long labels and stays within the bar. Verified in a browser at 360, 270 and 190 px wide, and by shrinking the stage to 170, 130 and 100 px; not verified in a real call.
- The room page is now a grid of module columns, each a content area over an action bar, with the bars sharing one bottom row: the video toolbar sits under the video and the chat message box under the chat, lined up. The chat is a real column instead of an overlay, the popped-out toolbar is a floating bar over the video, and on a narrow window chat replaces the video with the toolbar still under it. The measured toolbar height and hand-subtracted chat width are gone, and a check (`tools/check-room-layout.mjs`, part of `npm run check`) keeps them out. Verified in a browser with forced states: docked with chat open, popout, narrow width with chat open and closed, and the settings popover position. Not verified in a real call.

### Added
- Themes have a Card background, for the small items inside a section (member tiles, facts, thumbnails), on
  Auto by default. The Card background used to be the section color; that one is now Section background,
  its variable is `--bg-section`, and themes saved with the old field name are migrated on start.
- Themes can now set the header background and text, icon color and hover, Primary accent hover, and the
  Secondary accent with its text and hover, each on Auto (derived) until set. Buttons gain a stronger
  hover with a border and glow, and a press effect.

### Fixed
- The logo in the header filled 40px in a 43px bar, leaving a gap above and below; it now fills it.

Verified in a browser on the Theme tab: Auto values resolve to the right colors, setting them applies
live to the header and buttons, a saved theme's `/theme.css` carries only the values it sets, and the
logo is 43px in a 44px bar. Not checked on the room page or in a call.

### Changed
- Documentation moved into `documentation/` following the Coffee Pub documentation standard:
  `README.md` is now the product page, the guides are in `userguides/`, the OBS link contract is in
  `api/api-obs-view.md`, and the design notes are in `architecture/`. The old `DESIGN.md`, root
  `TODO.md` and `docs/MODULES.md` were folded into it. Added `tools/wiki-sync.mjs` and
  `tools/check-docs-structure.mjs`, copied unmodified from coffee-pub-studio, and a `module.json` for
  them to read. Verified by running `node tools/check-docs-structure.mjs` (passes) and
  `node tools/wiki-sync.mjs build` (builds 14 pages, Home and a sidebar); the guides themselves have
  not been walked in a running server.

## [0.3.0]

### Added
- Roles and permissions: four fixed roles (admin, moderator, user, guest) with a grid of checkboxes on
  the Manage page, enforced by the server, including per-image permissions. Per-room Moderator.
- Per-room member settings: remove a member, use default profile images or the room's own, and
  moderator. Room pictures now show on call tiles and on the room list.
- Manage tabs reordered and renamed: Server, Theme, Rooms, Roles, Users, Modules, About. The Theme tab
  holds theme colors, Default Images, Guest images, Reactions and a Font Awesome icon list that now
  drives the room launch-link and home icon pickers.
- Modules, step 1: upload a zip on the Modules tab, review and approve what it asks for, enable it,
  roll back among the newest three versions, uninstall with or without its data. Nothing a module does
  is visible to players yet.
- Away message: the away button asks for an optional multi-line message shown on your tile.
- Join a room straight into a pop-out window from the room list.

### Changed
- Chat, popups, tile name labels and the muted badge follow the theme, so light themes are readable.
- Chat emoji picker offers the same list as the reactions tray. Replies no longer leave a blank gap
  under the quote.

Verified in a browser against a sandbox server with the LiveKit connection unavailable, so anything
that needs a live call (tile names and away messages on other people's screens, kick, mute, asides)
was checked by reading the code only.
