# One Input Plan

**Audience:** Thomas decides; server-development and experience-design build.

**Status:** Approved 2026-09-25 (GitHub issue #58). Thomas: one text input, in Chat, that replaces the modules' own text boxes, with the Assistant merged into Chat. **Phase 1 built** (steps 1 to 5) in PRs #77 and #78. **Phase 2, step 6 built** in PRs #79 to #84 (To-do, Calendar, Research, Planner and Polls lost their typed boxes; Polls gained `/v`). Steps 7 (a shared/private switch for AI replies) and 8 (the Assistant left out of new installs) are not built. Verification so far is by tool only (`tools/check-one-input.mjs`, `tools/check-modules.mjs`, `tools/check-module-window.mjs`); none of the "Verified live" list below has been walked in a browser. See "Progress" at the end.

## What it is today

- Chat is part of the host page (`public/host.js`), not a bundled module. Messages go over LiveKit's data channel and are kept by `server/chat-history.js` (`DATA_DIR/chat.json`, per space).
- The Assistant is a module (`modules/assistant`, `hooks.ai`) that calls `POST /api/modules/:id/ai` (`server/ai.js`). Its conversation lives only in the page and is lost on refresh. Its import panel reads `magpie`/`card` blocks with `readObjects` in `server/object-format.js` (#73).
- Several modules have their own add box that parses a little and opens their add form, for example To-do's `#quick` and Planner's day `add-row` (`modules/travel`).

## Decisions

1. The Assistant merges into Chat. An AI reply is private to the person who asked, with a "Share to the space" action on each reply. Phase 2 adds a shared/private switch like Research's. Reason: one place to type, and AI answers don't clutter the space unless someone chooses to share them.
2. The input lives in Chat. Toolbar buttons in modules stay the main way to add things, and toolbars grow over time (for example "Add flight"). Reason: typing is a shortcut, not the only way to add something.
3. Modules register the commands they accept in `module.json`. Chat routes the text to the module through the action bus and has no code for any specific module. Text with no command is a chat message. `/ai` asks the AI. A picker beside the input lists the registered commands. Reason: Magpie is a conduit, so modules declare what they take and Chat only routes.
4. A module's own text box is removed once its command is registered, because the command does the same job.
5. Private AI threads are saved per person and survive a refresh.
6. Pasting an AI answer that holds `magpie`/`card` blocks into the input offers the object import (the #73 flow, moved from the Assistant to Chat).

## The contract

### Manifest field

A new top-level `commands` array in `module.json`. Each entry names an action the module already lists in `actions.provides`:

```json
"commands": [
  { "name": "r", "label": "Add a research note", "action": "addNote", "hint": "the note's text" }
]
```

- `name`: 1 to 12 lowercase letters or digits, no slash. `ai` is reserved by the host.
- `label`: what the picker shows. `hint`: the input's placeholder once the command is chosen (optional).
- `action`: the name of an entry in this module's `actions.provides`. That action must accept `{ "text": "string" }` and be `local: true`.
- The server validates `commands` at install (bad shape or unknown action: install refused with a message saying which entry).

### Routing

- `/<name> <text>`: Chat looks the command up among the modules placed in the current space and sends `actions.request(<module>:<action>, { text })` on the bus, as the person typing. The module parses the text and opens its add form filled in; it adds nothing without the person confirming. The input clears once the request is claimed; if nothing claims it, the input keeps the text and says "<module name> isn't open".
- `/ai <text>`: a private question to the AI (see below).
- Unknown command: the text stays in the input with "No command /<name>". Nothing is sent to the space.
- No command: an ordinary chat message, exactly as today.
- The picker (a button beside the input, and typing `/` alone) lists `/ai` and every registered command in the space, by `label`, using `host.menu.show`. Choosing one puts `/<name> ` in the input.
- Chat never names a module in code; the list comes from `GET` of the space's placed modules' `commands`.

### AI in Chat

- Server: `POST /api/spaces/:space/ai` with `{ question, refs? }`, the same limits, usage counting and AI setting as `POST /api/modules/:id/ai`. Permission: the environment's existing AI use permission (see Open questions). Returns the reply, which is also saved to the person's thread. 503 when AI is not set up, 429 over the limit.
- `GET /api/spaces/:space/ai/thread` returns the person's own thread; `DELETE` clears it.
- Page: private replies show in Chat only to the asker, marked "Only you can see this", with Copy, Keep (the Assistant's keeping actions) and "Share to the space". Sharing posts the reply as an ordinary chat message from the asker, labelled "AI answer shared by <name>".
- Dropping an object on Chat while `/ai` is chosen adds it as context, as the Assistant's `askAssistant` does today.

### Storage for AI threads

- `DATA_DIR/ai-threads.json`: `{ threads: { "<spaceId>:<userId>": [{ id, at, role: "user"|"ai", text, summaries? }] } }`, written the way `chat-history.js` writes (soon after a change, and on stop).
- Rolling window like chat: the last 200 entries per thread, none older than 30 days. Not kept for an aside.
- Readable only by the person who owns it. Admin and owner do not see it in any view.

### Paste import

- On paste into the input, the page asks the server to read the text with `readObjects`. If it finds objects, the input shows "Bring in N objects" beside Send; choosing it runs the #73 flow (same checks, same keeping actions, found by action name and input shape). Declining sends nothing and leaves the text.

## Left to build, in order

Phase 1

1. server-development: `commands` validation at install and in the module list; `ai-threads.json` store; `POST /api/spaces/:space/ai` and the thread routes; `tools/check-one-input.mjs`.
2. experience-design: `/ai` in Chat with private replies, Share, Copy, Keep, and the saved thread on load.
3. experience-design: command routing and the picker.
4. experience-design: paste import in Chat.
5. experience-design: add `commands` to Research, To-do, Planner and Calendar (one version bump each); the Assistant module is marked retired (version bump, description says to use `/ai` in Chat).

Phase 2

6. experience-design: remove each module's own text box, one module per step, each with a version bump (To-do `#quick`, Planner day `add-row`, then any others).
7. Both: the shared/private switch for AI replies.
8. server-development: remove the Assistant module from new installs once no space places it.

## Verify

- Checked by a tool (`tools/check-one-input.mjs`, run by `npm run check`):
  - install refuses a `commands` entry with a bad name, `ai`, a missing `action` or a non-local action;
  - `POST /api/spaces/:space/ai` saves both turns; `GET .../thread` returns them to the asker and 403 to anyone else;
  - the thread keeps 200 entries and drops entries older than 30 days;
  - an aside keeps no thread;
  - 503 with AI unset, 429 over the limit;
  - a single-environment install behaves as before.
- Verified live in a browser (no LiveKit needed):
  - `/ai` reply shows only to the asker and is still there after a refresh;
  - `/r text` opens Research's add form filled in, and nothing is saved until confirmed;
  - unknown command and closed module keep the text with their message;
  - the picker lists `/ai` and every placed module's commands;
  - pasting an answer with `magpie` blocks offers "Bring in N objects" and keeps them.
- Needs a real LiveKit call: "Share to the space" reaching a second person, and other people never seeing a private reply.

## Acceptance criteria

- One input in Chat sends messages, asks the AI and routes commands.
- Chat has no module-specific code; a new module's command works by `module.json` alone.
- A private AI thread survives a refresh and is seen by no one else.
- Every module with a registered command has lost its own text box by the end of phase 2.
- `npm run check` passes.

## Open questions

1. Two modules register the same command name. Recommendation: allow it, and show both in the picker as `/<name> (<module name>)`; typing the bare name picks the one on the canvas, or asks if both are.
2. The command's module is not on the canvas. Recommendation: say "<module name> isn't open" and keep the text, as above, rather than opening the module for the person. This blocks step 3.
3. Who may use `/ai`. Recommendation: move the Assistant's `use` permission to an environment-level AI permission with the same defaults (member, guest, moderator). This blocks step 1.

## Decided after drafting (2026-09-25, project manager)

- `/ai`: anyone who may use the Assistant (`use`), except guests, and not in a space with AI turned off, the same rule as the #73 import.
- A command whose module isn't open keeps the typed text in the input and says the module isn't open. Nothing is lost or sent.
- Two modules registering the same command: the picker shows both, each with its module's name, and the typed command asks which one to use.

## Progress

- **Phase 1** (PR #77, follow-up #78). `commands` validation (`cleanCommands` in `server/modules.js`), `server/ai-threads.js`, the space AI, thread, command, actions and objects-check routes (see [api-modules](../api/api-modules.md), "Chat routes"), `public/chat-input.js`, and commands in Research, To-do, Planner and Calendar. The Assistant (0.1.20) keeps its `use` permission and its `ai` hook but has no window: `surfaces.canvas.menu: false`, a manifest field added for this.
- **Phase 2, step 6** (PRs #79 to #84). To-do **New todo**, Calendar **Add event**, Research **Add a note** / **Add a link** / **Add a photo**, Planner **Add plan** with Flight, Hotel, Restaurant and Note, Polls **New poll** and `/v`. Research's **Research this** asks in Chat through `host.chat.ask`. **Bring in research** moved from the Assistant into Chat's formatting menu. Action bars now put the primary button on the far right and collapse from the left by width; the "..." is one SDK control, `host.ui.moreButton`.
- **Versions.** Assistant 0.1.20, To-do 1.11.14, Calendar 1.17.17, Research 0.2.19, Planner (Travel) 0.7.42, Polls 1.12.17, Places 0.8.18.
- **Differs from the contract above.** An AI reply is marked with a **private** badge, not "Only you can see this". A command whose module is closed says "<module> isn't open" in a note under the input. `/ai` does not require the Roles tab's **Use AI in modules**; it follows the rule decided after drafting (the Assistant's `use` permission when the Assistant is installed). There is no control on the page to clear one's thread yet; `DELETE .../ai/thread` exists. A duplicate command answers 409 with `choices` from the server; the page asks the person to use the picker.
- **Verified.** Checked by a tool only, as above. Not yet verified live in a browser; sharing a reply to a second person needs a real LiveKit call.
