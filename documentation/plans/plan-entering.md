# Entering Plan

**Audience:** Thomas, who decided how a person enters a space and what they find there the first time, and the sessions that build it: server-development (the space's `opensWith`, what the account remembers having seen, the owner's welcome words) and experience-design (the space list, the call control, the welcome cards, the checklist and the empty states).

**Status:** approved by Thomas, September 24, 2026 ("look good. approved."); nothing built. From two GitHub issues. #3: "The space's button and flow treat opening a space as joining a conference. A space may be used without a call at all (only modules on the canvas). The primary action should be entering the space; joining the call is a separate choice inside it." #2: "Signing in to an environment for the first time, and entering a space for the first time, drops people straight in with no guidance. Both need a first-time experience: what this place is, what they can do here, and where to start."

**Waits for [plan-names](plan-names.md).** Part 1 waits for step 5b (`room.html` and `room.js` become `space.html` and `space.js`, `roomconfig.*` becomes `space-settings.*`) and step 6 (`room-modules.js` becomes `canvas.js`, `#stage` becomes `#canvas`). Part 2 waits for step 4 (the roles decide who sees what), step 5b, and part 1. This plan uses the new names throughout. "Today" below names the files as they are now.

## What it is today

**Entering a space.** Most of the mechanics already exist. What still assumes a call is the words and the defaults.

- [plan-canvas](plan-canvas.md), stages 1 to 4, is built and not yet checked in a real call. Closing the conference leaves the call and keeps the person in the space. The Modules menu offers "Rejoin call". Each space remembers the modules a person had open (`__open`, `public/room-modules.js:46-58`). The card's "Join with" popover sets them (`public/room.js:466-503`).
- [plan-optional-conference](plan-optional-conference.md), stage 1, is built: the `conferenceEnabled` switch (`server/store.js:205`) and the Conference card on the Modules tab (`server/index.js:2585`). Stage 2 is not built. The page always connects to the call service to be in a space, for presence and chat (`connectAndSetup`, `public/room.js:~2185`).
- The microphone is asked for only when the conference opens (`startCall`, `public/room.js:~2210`). Entering without the call therefore already works in the code.
- The space list still frames entering as joining the call:
  - The card's button says "Join" with a chat icon (`public/room.html:58`, `public/room.js:362`). Its other buttons say "Join in a pop-out window" and "Choose what to join with" (`room.html:59-60`).
  - Under the list, "Your browser will ask for your microphone the first time..." (`room.html:34`). The guest form says the same (`room.html:43`).
- A space someone has not been in opens with the conference (`room-modules.js:972`). plan-canvas decided that default ("default: the conference and chat"), and this plan replaces it.
- The card shows "n/m Online" (`room.js:376`). `GET /api/presence` already answers `inCall` for each person (`server/index.js:2262`), but the card does not use it.
- The status line says "in <space> (not in the call)" when the conference is closed (`room.js:~2201`).

**The first time.** There is no guidance anywhere.

- Signing in goes straight to the space list (`server/index.js:1595-1597`). A new environment has only the Lobby, "Where everyone meets." (`server/store.js:488`), and a new space has no modules on.
- The dashboard is hidden until a module provides a widget (`room.html:27`). An empty space list has no empty state (`renderRooms`, `room.js:344`). An empty canvas says "Nothing is open. Open the conference, the chat or a module from the space bar." (`room.html:308-310`).
- The sign-in page shows the owner's `loginText` (`login.html:20`). A hosted sign-up lands the new owner on `/login` (`public/landing.js:187`), then on an empty environment.
- Nothing records that a person has seen anything. A user record has no such field.
- [plan-environment-templates](plan-environment-templates.md), not built, already applies a template's Lobby name and description once. Templates are where words suited to an environment come from.

## Decisions

### Part 1: entering a space (#3)

1. **The primary action is Enter**, with a door icon. When the person is already in that space, it reads "Back to <space>". Joining the call is not part of it.
2. **Joining the call is its own control inside the space**, showing who is in the call: "2 in the call · Join".
3. **The space's card shows who is here and who is in the call.**
4. **Each space has an "Opens with" default, set by the owner** and stored on the space.
5. **A person's remembered layout wins after their first visit.** "Opens with" decides only a first visit.
6. **With nothing set, a first visit opens the chat and the space's modules, without the call.**
7. **Guests enter with the call open, unless the space's "Opens with" leaves it out.**
8. **The microphone note moves to joining the call.** It leaves the space list and the plain guest form.
9. **No call service at all stays in plan-optional-conference.** Until its stage 2 is built, entering a space still needs the call service, for presence and chat. The call is only closed.

### Part 2: the first time (#2)

10. **Guidance lives in the page. There is no tour.** Helpful empty states, a one-time welcome card for each role and for each space, and a setup checklist for a new owner.
11. **The owner's setup checklist is in scope.** It disappears when everything on it is done, or when the owner dismisses it.
12. **The words are product defaults that an owner can replace and a template can supply.**
13. **What a person has seen is kept on their account**, so it follows them to another browser.
14. **Guests get one line and nothing is stored.**

### Decided with the plan

These were open questions; each is the recommended answer, accepted with the plan.

15. **The card's popover is headed "Open with"**, so a person's own choice reads differently from the owner's "Opens with". (Recommended, accepted with the plan.)
16. **With nobody in the call, the call control shows "Join" alone**, not "Start". (Recommended, accepted with the plan.)
17. **No limit on what a first visit opens.** With nothing set, every module on in the space opens; the canvas already hides what does not fit ([plan-canvas](plan-canvas.md), narrow screens). (Recommended, accepted with the plan.)
18. **The checklist has the four rows in the contract**: name and icon, invite people, make a space, turn on modules. (Recommended, accepted with the plan.)
19. **The default words are the drafts in the contract**, for the members' welcome and the guest line. (Recommended, accepted with the plan.)

## The contract

### Part 1: the server

- **The space record** gains `opensWith`: an array of module ids in order, which may include the built-ins `conference` and `chat`, or absent for "not set". The store's space cleaning keeps up to 20 strings that match the module id pattern and drops anything else. Nothing is stored for existing spaces.
- **`PATCH /api/spaces/:id`** (today `PATCH /api/rooms/:id`, `server/index.js:2405`, owner only) takes `opensWith: [ids] | null`. `null` clears it. Anything that is not an array of strings, or not null, answers 400 "Opens with must be a list of modules." An id for a module that is off or not installed is kept. The page skips it when entering, so turning that module back on restores it.
- **`GET /api/presence`** is unchanged. It already answers `inCall` for each person, and the space's `opensWith` comes with the space.
- **Asides** have no `opensWith`. An aside is the conference only ([plan-names](plan-names.md), decision 5).

### Part 1: the pages

- **The space's card** (`space.html`, the space list):
  - The primary button reads **Enter** with `fa-door-open`. It reads **Back to <space>** when the page is connected to that space.
  - The pop-out button's title is "Enter in a pop-out window".
  - The sliders button's title is "Choose what opens". Its popover, headed **Open with**, edits the person's own remembered layout, as "Join with" does today.
  - The count reads "3 here · 2 in the call", or only "3 here" when nobody is in the call, from `GET /api/presence` (`space` and `inCall` for each person).
  - In the members row, a person in the call carries a small call mark beside their online dot. It is a mark with a title, never colour alone.
- **What opens on entering**, worked out in `canvas.js`'s `restore()` (today `room-modules.js:963-972`), in this order:
  1. A request to open one module on one object, from the dashboard, as today.
  2. The person's remembered layout for this space (`__open`), if they have been in it before.
  3. The space's `opensWith`, leaving out modules that are off or that the person's role may not open.
  4. The chat and every module on in the space, without the conference.

  For a guest, step 2 does not apply. With no `opensWith` set, a guest gets the conference and the chat.
- **The call control** sits in the space bar (the secondary nav, [plan-nav](plan-nav.md)) while the person is not in the call. It shows how many people are in the call, and a Join that opens the conference module (the same as "Rejoin call" today, which stays in the Modules menu). With nobody in the call it shows only Join. While the person is in the call, the control is not shown; the conference's own hang-up leaves the call, as today. A role without "See and join the conference", or an environment with the conference switched off, never shows the control.
- **The microphone note** ("Your browser will ask for your microphone. You join with your camera off; turn it on whenever you're ready.") is shown as the hint of the call control. It leaves the space list (`room.html:34`). It leaves the guest form (`room.html:43`) unless that space opens with the conference. The "install" hint beside it today moves with it.
- **The status line** reads "in <space>" whether or not the person is in the call.
- **Space settings** (`space-settings.*`, owner only) gain **Opens with**: the conference, the chat and the space's modules, each with a tick, in the order they are listed. Clearing every tick means "not set", which saves `null`. It says: "What opens the first time someone enters this space. After that, each person's own layout is remembered."
- **On a phone,** the first tab is the first module open, not always the call.

### Part 2: the server

- **The account** gains `seen`, kept on the user record in each environment, since accounts are per environment:
  - `welcome`: a time, once the environment's welcome is dismissed.
  - `spaces`: the ids of the spaces whose welcome was dismissed, pruned when a space is deleted.
  - `checklist`: a time, once an owner dismisses the setup checklist.

  `GET /api/me` answers `seen`. `POST /api/me/seen` takes `{ welcome: true }`, `{ space: <id> }` or `{ checklist: true }` and answers the new `seen`. A guest has no account, and the route answers 401 for a guest.
- **The owner's words.** The environment's settings gain `welcomeText` (up to 600 characters, plain text) for the members' welcome. Blank means the product's default. `PUT /api/settings` takes it (owner only). `branding()` does not send it; `GET /api/me` answers it with `seen`, to signed-in people only. When [plan-environment-templates](plan-environment-templates.md) is built, a template may set `welcomeText` once, when the environment is created, as it sets the Lobby.
- **The checklist's state** is worked out from the environment, never stored. `GET /api/me` answers `setup` to an owner only: `{ named, invited, space, modules }`, each true or false.
  - `named`: the environment's name or icon has been changed from what it was made with.
  - `invited`: there is more than one account, or an invite is open.
  - `space`: there is a space besides the Lobby.
  - `modules`: some module is on in some space.

### Part 2: the pages

- **The environment's welcome card**, on the space list the first time a signed-in person arrives (no `seen.welcome`). It is shown once and dismissed with "Got it". Its content depends on the role:
  - **Member:** the environment's name. The owner's `welcomeText`, or the default: "This is where your group meets. Each space has its own people, chat and tools; enter one to start. Joining the call is up to you once you are inside."
  - **Owner:** the same card, with the checklist in place of the members' text.
  - **Admin**, the host's stand-in: nothing.
- **The setup checklist,** for an owner, on the space list above the spaces. It has four rows, each ticked from `setup` and each linking to where it is done: "Name the environment and give it an icon" (Manage, the Environment tab, which is the Server tab until Names step 5b), "Invite people" (Manage, Users), "Make a space" (Manage, Spaces), "Turn on modules" (Manage, Modules). It disappears when all four are true or when dismissed ("Hide this"). An environment where all four are already true never shows it.
- **The space's welcome card,** the first time a signed-in person enters each space (the space's id not in `seen.spaces`). It shows:
  - the space's name and description;
  - the modules on in it, each with its icon, a button to open it, and the module's own description;
  - who is here;
  - the call control, as in part 1;
  - for someone who moderates this space, also "You moderate this space: you can change what its modules do here", with a link to the space's module settings.

  It is dismissed with "Got it". It sits over the canvas, not in place of it.
- **Guests** get one line at the top of the space, once per visit and with nothing stored: "You're a guest in <space>. Nothing about you is kept once you leave."
- **Empty states:**
  - A space list with no spaces, for a member: "You're not in any spaces yet. The owner adds people to spaces." For an owner, the same sentence, a "Make a space" link, and the checklist.
  - An empty canvas: "Nothing is open." with a button for each thing the person may open (the call control's Join, the chat, each module on in the space) in place of the sentence about the space bar.

## Left to build, in order

1. **"Opens with" on the space** (server-development). The field, its cleaning and `PATCH`, and the checks.
2. **Entering** (experience-design). The card's words, icon and count; the order in `restore()`; the call control and the microphone note; the status line; the phone's first tab; Opens with in space settings.
3. **What the account has seen** (server-development). `seen`, `POST /api/me/seen`, `welcomeText`, `setup` on `GET /api/me`, and the checks.
4. **The first time** (experience-design). The environment's welcome card, the checklist, the space's welcome card, the guest line, and the empty states.

Documentation (content-manager, after each step): the space and environment user guides, and [plan-canvas](plan-canvas.md)'s default marked replaced.

## Verify

- **Step 1.** Checked by a tool: `opensWith` cleaned (too long, wrong types, null clears), `PATCH` refused for a member and a moderator, and 400 on a bad value.
- **Step 2.** Checked by the tool that covers the canvas (`check-canvas.mjs` after Names step 6) for the order of what opens. Live on a local server, the card's words, Enter and Back to, the count, and Opens with in space settings can be checked. Entering itself connects to the call service, and there is no LiveKit locally. So what opens on a first and a second visit, a guest's first visit, the call control's count and Join, and the microphone note are read as code only until a real server, and need a real call with two people.
- **Step 3.** Checked by a tool: `seen` written and read, pruned when a space is deleted, 401 for a guest; `setup` answered to an owner only and each flag true and false; `welcomeText` saved and answered only to signed-in people. Live on a throwaway `DATA_DIR` under `/tmp`.
- **Step 4.** Live on a throwaway `DATA_DIR` under `/tmp`: a new owner sees the welcome and the checklist, and the checklist ticks as each thing is done and then disappears; a member sees the welcome once, across two browsers; the empty space list for a member and an owner. The space's welcome card and the guest line appear only inside a space, which needs the call service, so they are read as code only until a real server.

