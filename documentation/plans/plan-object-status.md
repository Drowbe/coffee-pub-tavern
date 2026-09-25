# Object Status Plan

**Audience:** Thomas, who decided that a status belongs to every object and not only to the Planner's, and the sessions that build it: server-development (the manifest, the summary, the checks) and experience-design (the SDK's chip and list, and the Planner as the first module to use it).

**Status:** approved by Thomas, September 24, 2026 ("look good. approved."); nothing built. From GitHub issue #12: "Objects need a status such as action required, tentative, or locked in (confirmed), shown on the card and filterable, so a group can see what still needs doing." It also answers the question [plan-travel](plan-travel.md) left open in its last section: "what 'locked down' means once a decision lands".

**Waits for [plan-names](plan-names.md) step 7** (Object). That step renames what this plan changes: `host.refs` becomes `host.objects`, the resolved card becomes an object's summary, and the manifest's `kinds[].card` becomes `kinds[].summary`. Building this first would mean building it twice. This plan uses the new names.

## What it is today

- **The summary already carries one shared state:** `done`, a boolean.
  - `CARD_FIELDS` (`server/modules.js:34`) lists what a manifest may map: `title`, `subtitle`, `when`, `end`, `allDay`, `done`, `place`, `category`, `text`.
  - `refCard` (`server/index.js:2908-2928`) copies them into what resolve, search and the links answer, keeping `done` only when it is a real boolean.
  - The To-do maps `done` (`modules/todo/module.json:104-109`), and so does the Planner (`modules/travel/module.json:113-123`).
  - A status would be a second shared field of the same kind.
- **The Planner** has `done` and a booking reference, `confirm` (`modules/travel/src/travel-lib.js:44`, `52`). It has no status and no filter. Its toolbar holds the view switch (`host.ui.viewSwitch`, `travel.js:762`) and the header items "Hide empty days" and "Edit trip" (`travel.js:776-777`). The Decisions view lists polls to vote on and tasks due before the trip (`travel.js:~641-690`).
- **The SDK** draws nothing for a summary's state. Each module draws `done` its own way.

## Decisions

1. **The status is part of the shared object summary**, not something only the Planner has. Any module can map it. The Planner is first.
2. **A small fixed set of values:** action required, tentative, confirmed.
3. **The server checks it.** A value outside the set is never passed on.
4. **The SDK draws the chip**, so every module shows a status the same way.
5. **The words can be changed by templates.**
6. **Status is separate from `done`.**
7. **A booking reference does not set it.**
8. **A new object has no status.**
9. **In the Planner:** a filter in its toolbar, and objects needing action listed in Decisions.
10. **Other modules may map it later.** This plan changes only the Planner.

### Decided with the plan

These were open questions; each is the recommended answer, accepted with the plan.

11. **A day with nothing matching the filter is drawn collapsed**, like a hidden empty day, so the days stay in order. (Recommended, accepted with the plan.)
12. **The icons are `circle-exclamation`, `circle-question` and `circle-check`**, from Free Font Awesome, for action required, tentative and confirmed. (Recommended, accepted with the plan.)
13. **No dashboard view of what needs action yet.** A widget showing it across a person's trips is a later change of its own. (Recommended, accepted with the plan.)

## The contract

### The values

| Stored value | Words (default) | Meaning |
|---|---|---|
| `action` | Action required | someone has to do something about it |
| `tentative` | Tentative | pencilled in, not settled |
| `confirmed` | Confirmed | settled: booked, agreed, locked in |

No status is absent, never an empty string. The stored values are code names and never change. The words are the only thing a template changes.

### The server

- **Manifest** (`server/modules.js`): the summary fields gain `status`. A module maps it like any other field: `kinds[].summary.status: "<stored field>"`. The existing rule applies: it must name a stored field.
- **The summary** (the `refCard` successor after step 7): `status` is copied only when the stored value is exactly `action`, `tentative` or `confirmed`. Anything else, including a module's own words, is left out. So `objects.resolve`, `objects.search`, `linksTo`, `linksFrom`, a dragged object's summary and the AI's summaries all carry it the same way.
- **Nothing is written by the host.** Each module stores the status in its own data. Who may change it is the module's own edit permission.

### The SDK (`public/sdk/host.js`, `public/module-host.js`)

- `host.objects.statuses` is the list, in the order above: `[{ id: 'action', label, icon }, ...]`. `label` is the environment's word. Until [plan-environment-templates](plan-environment-templates.md) step 2 is built, `label` is the default in the table. After it, the words are keys in that plan's set (`status-action`, `status-tentative`, `status-confirmed`), which an owner or a template can change.
- `host.ui.status(id)` returns a chip element (an icon, `circle-exclamation`, `circle-question` or `circle-check` in the order above (decision 12), and its label, from the theme tokens, never colour alone), or null for no status or an unknown id. A module places it where it likes. The chip is the same wherever it appears.
- The API document ([api-module-sdk](../api/api-module-sdk.md)) and the manifest's summary fields list `status`.

### The Planner (`modules/travel`)

- **Data:** an item gains `status`: `action`, `tentative`, `confirmed` or null. `cleanItem` drops any other value. The manifest's `plan` kind maps `summary.status: "status"`. The trip itself has none.
- **Setting it:**
  - The editor gains a **Status** choice: None, then the three.
  - The item menu gains a **Status** entry with the same four.
  - A linked object (a pointer to another module's object) shows that object's status from its summary and cannot set it from the Planner.
- **The card:** the chip from `host.ui.status(item.status)`, beside the category. On a linked object, the chip comes from the resolved summary. `done` is drawn as it is today, independently.
- **The filter:**
  - A header item, "Filter by status", opens `host.menu.show` with: All, Action required, Tentative, Confirmed, No status. It shows as on while a filter is chosen.
  - The choice is remembered for each person in the browser, as "Hide empty days" is (`planner-hide-empty`), under `planner-status-filter`.
  - It applies to the Days view and the Bookings view. Items that do not match are not drawn. A day with nothing matching is drawn collapsed, like a hidden empty day, so the days stay in order (decision 11).
- **Decisions view:** a new first section, "Needs action". It lists every Planner item, and every linked object, whose status is `action`, in date order (items on the line last), each with its day and an Open button that scrolls to it in the Days view.
- The Planner's version is bumped (`modules/travel/module.json`, `tools/module-versions.json`).

## Left to build, in order

1. **The summary field** (server-development). `status` in the manifest's summary fields, the value check in the summary, the checks, and the API document's lines handed to content-manager.
2. **The SDK** (experience-design). `host.objects.statuses` and `host.ui.status`, with the chip's style.
3. **The Planner** (experience-design, with server-development for `tools/check-travel.mjs`). The item's `status`, the manifest mapping, the editor and menu, the chip on the card, the filter, the Decisions section, `CONTRACT.md`, and a version bump.

Documentation (content-manager, after each step): the SDK and manifest documents, the Planner's user guide, and [plan-travel](plan-travel.md)'s open question marked answered.

## Verify

- **Step 1.** Checked by a tool (`check-modules` and the object checks, `check-drop` after step 7): a manifest mapping `summary.status` accepted, and one naming a non-field refused; each of the three values passed on in resolve and search; an unknown value, an empty string and a non-string left out.
- **Step 2.** Checked live on a local server in a module's own page: each value draws its chip in a dark and a light theme; null and an unknown id give null.
- **Step 3.** Checked by `check-travel.mjs` for the item's `status` cleaning. Live on a local server, in the Planner's own page, without a call: set each status from the editor and from the menu; the chip on the card; the filter on Days and Bookings, remembered across a reload; "Needs action" in Decisions; a Planner object's status seen from a second module through `linksTo` or search. The Planner inside a space's canvas needs the call service and is read as code only.

## Builds on this

**#13, Planner changes shown in the Calendar**, is not planned yet. It would carry the status across with no more work, since the Calendar would draw Planner objects from their summaries. It builds on `objects.search` (as the Planner already uses it to find other modules' dated objects, `modules/travel/src/travel-lib-plan.js:199-212`) and on [plan-linked-objects](plan-linked-objects.md)'s change events and date sync, none of which is built. It also needs the Planner's summary to carry `end` and a time.

