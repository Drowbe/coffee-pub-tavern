# Assistant Module Plan

**Audience:** the author confirming the shape of a standalone AI module, and whoever builds it.

**Status:** Decided by the author (2026-09-21): AI is its own module, with its own pane, dock/float/popout, not a feature bolted onto Research. Supersedes the Ask panel built inside Research (0.1.10–0.1.12); that work moves here.

## Why

The AI service (Manage > Modules > AI service) is a server-wide setting, like Places' search provider. What was missing is the front end for it: a place to have an open-ended conversation, on its own, poppable and dockable like Chat or Planner. Bolting that experience onto Research made Research's own job (notes, links, photos) harder to see, and meant every other module that wants "ask the AI" would have to rebuild the same conversation UI.

## Naming

The module is **Assistant** (id `assistant`), not "AI": the **AI service** stays the name of the server-wide setting (provider, key, model), and Assistant is the room-facing module that uses it. This is the same split Places/Maps already made (Maps uses Places' search setting without being it).

## What it is

- A normal bundled module: a room pane with `panel: { dock, float }` like Research or Planner, poppable into its own window through the existing native flow (`popOut`, `mode: 'window'`).
- Its content is the Ask experience already built for Research: the conversation thread, optional context chips, the picker to add research items as context, and the AI's answer with an inline card (icon, title, content, tags, place, date, sources, a "kept" state).
- **Answering:** general knowledge by default; context (added by hand, from Research or anywhere else) narrows or grounds the answer. The card says where it came from (`general`, `items`, `both`).
- **Kept cards become Research items.** Assistant does not keep its own store: bookmarking a card asks whichever module offers to save one (Research's `saveNote`-shaped action, found generically, not by name), the same way a place is saved today. This keeps "answer" as a kind Research already owns, and Assistant owns none of its own data beyond the open conversation.
- **The conversation itself is never stored,** on the server or the client, exactly as designed before. Closing the pane ends it.

## Conduits (generic, as always)

- **Provides:** `askAssistant(items?: ref[], question?: string)`, an action any module may request. Requesting it opens the Assistant pane (docked or floated, whichever it already is, or docked if closed) with the given items as starting context and, if given, the question pre-filled or sent.
- **Consumes:** anything with a card (`refs.consumes: ["*"]`), so a picked context item can come from Research, Places, Planner, or any future module, found the way Maps finds Places' actions: by name and input shape, never by naming a module.
- **Research's part shrinks:** its own "Ask about this" on a note's menu becomes a request for `askAssistant` with that one item, exactly as Places' "show on the map" requests Maps' `showOnMap`. Research keeps `saveNote`/`saveLink` so Assistant (and anything else) can save a card.
- Any module can add its own "Ask about this" the same way, for free, once it has an item with a card.

## What moves out of Research

- `#ask`, `#ask-context`, `#ask-picker`, the `tpl-msg-*`, `tpl-aicard`, `tpl-ask-chip`, `tpl-pick-row` templates, and their CSS (already written for Research 0.1.11–0.1.12) move to `modules/assistant/src/`, largely unchanged.
- Research keeps: notes, links, photos, tags, the item menu (with "Ask about this" now requesting `askAssistant` instead of opening a local panel), `saveNote`/`saveLink`, and the answer *kind* (an answer is still a Research item once kept).
- Research's header loses its own Ask button; Assistant is opened from the room bar/modules menu like any pane.

## Order of work

1. **Scaffold** `modules/assistant/` (module.json, src/), the way Research was scaffolded: panel dock+float, `refs.consumes: ["*"]`, `refs.produces` none (it keeps nothing), `actions.provides: [askAssistant]`, `actions.uses: ["*"]` (to find a save action and, later, other modules' items), `hooks.ai`.
2. **Move the design:** the Ask templates and CSS become Assistant's `assistant.html`/`assistant.css`, adapted to be the whole pane (its own header, not a panel inside another module). Contract moves with them.
3. **Server/script:** Server Development moves the `tavern.ai.ask` call and prompt logic from research.js into assistant.js; wires `askAssistant`; Research's menu item becomes a request instead of a local open.
4. **Saving a kept card:** Assistant requests whichever module offers a note-shaped save action (found by name/input, as `newPlace`/`addPlace` are today); Research is the only one that offers it at first.

## Open question

None from the author; this is the whole decision. One implementation note for Server Development: whether `askAssistant` opens Assistant in the requester's current dock/float state or always docks it fresh — proposed: whichever it was last, docked if never opened, the same rule `openModule` already uses elsewhere.
