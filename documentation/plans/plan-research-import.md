# Research Import Plan

**Audience:** the author deciding how research done in another AI comes into Magpie, and the developers who build parts 1 and 2 from this plan alone: server-development (the format, the check and the routes) and experience-design (the SDK calls and the Assistant's pages).

**Status:** approved 2026-09-25. From GitHub issue #73, in the author's words: "Let people research in Claude Desktop, ChatGPT or any AI and bring the results into Magpie as objects." Nothing here is built. Parts 1 (publish the format) and 2 (import) are phase 1 and are specified to build; part 3 (a direct connection) waits for #64, and more destinations (To-do, Calendar) come soon after phase 1. Both are described only as future work.

## What it is today

- **The Assistant's AI already writes objects in a fixed shape.** `SUMMARY_RULE` in `server/ai.js` (line 565) tells the model to put each part of its answer worth keeping in a fenced ```` ```card ```` block holding one JSON object: `icon`, `kind`, `title`, `content`, `tags`, `place`, `date`, `links`, `basis`, `sources`. The rule is built from `ICONS`, `KINDS` and `MAX_SUMMARIES` (20) in the same file. The word "card" and its fence are between the server and the model only; the comment on `SUMMARY_RULE` says the prompt is kept as it was on purpose.
- **One checker for what the model writes.** `parseSummaries(text, count)` finds fenced blocks (```` card ````, ```` summary ````, ```` json ```` or no language) and hands each parsed JSON object to `cleanSummary(raw, count)`, which keeps only what fits, field by field: `title` (80 characters, required), `content` (2000, required, line breaks kept), `icon` (one of `ICONS`, else `note`), `kind` (one of `KINDS`, else left out), `tags` (at most 5, lower case `a-z0-9-`, 24 characters each), `place` (`name` up to 120, with `lat` and `lng` kept only when both are in range), `date` (a real `YYYY-MM-DD`), `links` (at most 5; today **https only**, no user name or password, 500 characters), `basis` (`general`, `items` or `both`) and `sources` (item numbers). HTML tags and control characters are stripped. A block that is not valid JSON, or has no title or content, stays as text.
- **The Assistant keeps no objects of its own.** `modules/assistant/src/CONTRACT.md` ("Saving a card") and `assistant.js` (`keepOne`, `placeInput`) keep an answer's object by asking another module through the action bus, found by name and input shape, never by naming a module: a suggestion-shaped action (`acceptSuggestion`, a `title` and a `kind`; Travel provides it) for an object with a `kind`, else a note-shaped one (`saveNote`, a `title` and a `body`; Research provides it). **Send all to plan** keeps each object in a reply the same way, after one confirm. `keepInput` in `assistant-lib.js` builds the note's body. Travel is the module whose id is `travel` and which people see as **Planner**; this plan calls it the Planner from here on.
- **How much the destinations keep.** Research's `saveNote` keeps a note's `body` up to 8000 characters (`plainText(i.body, 8000)` in `modules/research/src/research-lib.js`). The Planner's `acceptSuggestion` keeps `content` as the item's `notes`, cut to **2000** twice: in `fromSuggestion` (`modules/travel/src/travel-lib-plan.js`) and in `cleanItem` (`modules/travel/src/travel-lib.js`), and its Notes fields in `travel.html` (`#f-notes`, twice) have `maxlength="2000"`.
- **How an action runs.** `POST /api/bus/actions/request` checks that the asking module was approved for the action and that the person may write to the providing module, cuts each `text` field to **1000 characters** and each `string` field to 200 (`busInput` in `server/index.js`), and queues it. The provider's page carries it out when a person has it open; until then it waits up to seven days. `host.actions.request(..., { wait: true })` polls for five seconds and then answers `{ status: 'queued' }`. The Assistant treats that as a failure today ("it could not be saved"), although the request is still queued and runs later, so trying again makes a second copy.
- **What is dropped on the way.** The Assistant's page never draws an object's `links`, and neither `keepInput` nor the suggestion input carries them, so links the model wrote are lost when an object is kept.
- **Who may use the Assistant.** Its `module.json` has one permission, `use` (member, moderator and guest by default), for both read and write. Asking the AI also needs `aiAllowed` in `server/index.js`: a signed-in person (never a guest), an AI service set up, the space's `aiOff` switch off, and the role's `useAi` permission (off for members and guests by default).
- **Files a page reads.** `public/file-text.js` decodes a picked file (UTF-16 with a byte order mark, else UTF-8) for Manage's theme and template imports. It is a page module; a module in a sandboxed frame cannot load it.
- **Adding a permission to a module** turns the module off on update until an owner approves it again (`pendingFor`, `documentation/architecture/architecture-modules.md`, "Approval").

## Decisions

These are the author's, from issue #73, the direction given with it, and his answers to this plan's questions (all 2026-09-25).

- **Publish the format the Assistant already uses.** A **Copy instructions for another AI** action in the Assistant. Its text is generated on the server from the same source as the Assistant's own rule, so the two cannot drift, and a route serves it. The server also serves a JSON schema. Reason: another AI can then write objects Magpie reads without a person reshaping them.
- **Names.** The published format uses `magpie` fenced blocks and `.magpie-objects.json` files shaped `{ "magpieObjects": 1, "objects": [...] }`, never "card". A `card` block is still accepted. Reason: the Names rule (object, never card), while answers written to the old rule keep working.
- **Import takes three things:** a pasted whole AI answer (the fenced blocks are picked out), raw JSON (one object or a list), or a `.magpie-objects.json` file. Reason: people copy whatever their AI gives them.
- **Preview with a tick per object, then save into the current space** the way the Assistant keeps its own objects.
- **Everything goes through the same checker as the Assistant's output.** An imported object is marked as imported (its basis) and its `sources` are dropped. Reason: one set of rules for what an AI may put into Magpie; an outside AI's item numbers mean nothing here.
- **Caps on size and count: at most 50 objects per import** in phase 1.
- **Links are http and https only, for imports and for the Assistant's own answers alike** (one checker).
- **Who may import, in phase 1:** whoever may use the Assistant (its `use` permission), except guests, and not in a space with AI turned off. No AI service, no `useAi` permission and no new module permission are needed. Reason: bringing text in costs no AI tokens; what is kept is already limited on the server by the destination module's own write permission, since keeping goes through actions; and a new permission would turn the Assistant off on every install until an owner approved it again.
- **Destinations, in phase 1: Research or the Planner**, the same way the Assistant keeps its answers today (an object with a `kind` goes to the Planner's `acceptSuggestion`, anything else to Research's `saveNote`). The Assistant gets no store of its own.
- **Long research survives.** The action bus's `text` cut goes from 1000 to **8000** characters for every action, and an object's `content` limit goes from 2000 to **6000**, in the checker and in the instructions. Both destinations must keep that much (the Planner's limit is raised; see its section below).
- **Links are kept and shown.** Every object's links are drawn, and carried into what is kept, for answers and imports alike.
- **An imported object's kept text ends with the line `External source`.** Only imports get it; the Assistant's own answers do not.
- **A save that waits counts as sent**, for answers too: shown as waiting, never requested twice.
- **The instructions use this environment's word for object.**
- **No duplicate detection** in phase 1.
- **A direct connection comes later, after #64**: a scoped token that can only add objects to one space, for desktop AI apps and AI actions.
- **To-do and Calendar must be honoured as destinations soon after phase 1, through a generic conduit**, not by coding for those modules.
- **Assistant-specific logic stays in the Assistant module; the format and the checker are server and SDK conduits** any module could use. Reason: Magpie is a conduit and never codes for a particular module.

## The contract

### The format, version 1

An **object** in the format is one JSON object:

| Field | Required | Kept as |
|---|---|---|
| `title` | yes | plain text, at most 80 characters |
| `content` | yes | plain text or simple Markdown, line breaks kept, at most 6000 characters |
| `icon` | no | one of `ICONS`; anything else becomes `note` |
| `kind` | no | one of `KINDS`; anything else is left out |
| `tags` | no | at most 5; each lower-cased, reduced to `a-z`, `0-9` and `-`, at most 24 characters; duplicates and empty ones dropped |
| `place` | no | `{ name }` (at most 120 characters), plus `lat` and `lng` rounded to 6 places when both are numbers in range; left out without a name |
| `date` | no | a real calendar date, `YYYY-MM-DD` |
| `links` | no | at most 5 `{ title, url }`; `url` must be `http:` or `https:`, without a user name or password, at most 500 characters; `title` at most 100 characters, else the address's host name |

Any other field is ignored. HTML tags and control characters are removed from every text field. An imported object always comes out with `basis: "imported"` and never with `sources`, whatever it carried.

Where objects are found in what is given:

- **A pasted answer**: every fenced block whose language is `magpie` or `card`, written ```` ```magpie ```` then a new line, the JSON, a new line and ```` ``` ````. A block holds one object or a JSON array of objects.
- **Raw JSON**: text that, trimmed, starts with `{` or `[` and parses as JSON: one object, or an array of objects.
- **A file**: a JSON object with `magpieObjects` (the integer `1`) and `objects` (an array of objects). The file is recognised by its content, not its name; `.magpie-objects.json` is the name the instructions ask for.

Caps: **256 KB** of text or file per import; at most **200 candidates** read; at most **50 objects** kept per import. Past those, the rest is counted and reported, never kept.

The file, as the instructions ask another AI to write it:

```json
{
  "magpieObjects": 1,
  "objects": [
    { "icon": "hotel", "kind": "hotel", "title": "Casa do Largo, Faro", "content": "Small guesthouse in the old town, about 90 EUR a night.", "tags": ["faro", "stay"], "place": { "name": "Faro" }, "date": "2026-10-03", "links": [{ "title": "Casa do Largo", "url": "https://example.com/casa" }] }
  ]
}
```

### The JSON schema

Served by `GET /api/objects/format/schema` and built by code from the same constants as the checker (`ICONS`, `KINDS`, the length caps), never written by hand. It describes what is kept; the checker is more forgiving (it trims and lower-cases rather than refusing). `<ICONS>` and `<KINDS>` below stand for those arrays, in their order in the code.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:coffee-pub-magpie:objects:1",
  "title": "Magpie objects, format 1",
  "description": "One object, a list of objects, or a .magpie-objects.json file. Other fields are ignored.",
  "oneOf": [
    { "$ref": "#/$defs/object" },
    { "type": "array", "items": { "$ref": "#/$defs/object" }, "maxItems": 50 },
    { "$ref": "#/$defs/file" }
  ],
  "$defs": {
    "file": {
      "type": "object",
      "required": ["magpieObjects", "objects"],
      "properties": {
        "magpieObjects": { "const": 1 },
        "objects": { "type": "array", "items": { "$ref": "#/$defs/object" }, "maxItems": 50 }
      }
    },
    "object": {
      "type": "object",
      "required": ["title", "content"],
      "properties": {
        "title": { "type": "string", "minLength": 1, "maxLength": 80 },
        "content": { "type": "string", "minLength": 1, "maxLength": 6000 },
        "icon": { "enum": "<ICONS>" },
        "kind": { "enum": "<KINDS>" },
        "tags": { "type": "array", "maxItems": 5, "items": { "type": "string", "pattern": "^[a-z0-9-]{1,24}$" } },
        "place": {
          "type": "object",
          "required": ["name"],
          "properties": {
            "name": { "type": "string", "minLength": 1, "maxLength": 120 },
            "lat": { "type": "number", "minimum": -90, "maximum": 90 },
            "lng": { "type": "number", "minimum": -180, "maximum": 180 }
          }
        },
        "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "links": {
          "type": "array",
          "maxItems": 5,
          "items": {
            "type": "object",
            "required": ["url"],
            "properties": {
              "title": { "type": "string", "maxLength": 100 },
              "url": { "type": "string", "pattern": "^https?://", "maxLength": 500 }
            }
          }
        }
      }
    }
  }
}
```

### The instructions for another AI

Built by one function from the same pieces as `SUMMARY_RULE`: the example object, `ICONS`, `KINDS` and the caps. That function takes the fence (`card` or `magpie`), the noun, the maximum, and whether to ask for `basis` and `sources`.

- **The Assistant's own rule** is the function called with `card`, the noun "card", `MAX_SUMMARIES` and `basis` and `sources` on. The result must equal today's `SUMMARY_RULE` character for character; a check holds it to that.
- **The published instructions** are the function called with `magpie`, the environment's word for object (`word('object')`, so a template's own word shows), 50, and `basis` and `sources` off, followed by the lead-in and the file paragraph. The text, with the environment word shown as "object":

````text
I keep my research in Magpie. When I ask you to find or plan something, answer as you normally would, and put each thing worth keeping in a fenced block in exactly this form (at most 50, one block per object):
```magpie
{"icon":"note","kind":"optional","title":"a short title","content":"the text to keep; plain prose, or simple Markdown (headings, **bold**, *italic*, lists, links) if that reads better","tags":["one","word"],"place":{"name":"optional"},"date":"optional YYYY-MM-DD","links":[{"title":"optional","url":"https://..."}]}
```
The icon is one of: <ICONS joined with ", ">. If the object is plainly one of these everyday things, set "kind" to it (leave it out otherwise): <KINDS joined with ", ">. When asked for several distinct things (an itinerary, a list of options, "find me three hotels"), write one object per thing instead of folding them into prose; a single question still gets one object. Keep each title under 80 characters and each content under 6000. Links must start with http:// or https://. Leave out the optional parts you do not need, and add no other fields.
If I ask for a file instead, write one JSON file named <something>.magpie-objects.json holding {"magpieObjects":1,"objects":[...]}, with the same objects in the list.
````

### Server

New file **`server/object-format.js`**, the conduit. It owns `ICONS`, `KINDS`, the bases, the caps and:

- `FORMAT_VERSION = 1`, `MAX_IMPORT_OBJECTS = 50`, `MAX_IMPORT_CANDIDATES = 200`, `MAX_IMPORT_BYTES = 262144`.
- `cleanObject(raw, { count = 0, imported = false })`: today's `cleanSummary` moved here unchanged, except that `content` is kept up to 6000 characters (was 2000), links accept `http:` as well as `https:`, and with `imported: true` the basis is always `imported` and `sources` are never kept. Without `imported`, a `basis` of `imported` from the model is not accepted (it falls back as any unknown basis does).
- `objectRule({ fence, noun, max, withProvenance })`: the rule text above.
- `instructions(noun)`: the published instructions.
- `schema()`: the schema above, as an object.
- `readObjects(text)`: returns `{ objects, found, dropped, over }` or throws an error with a status and one of the sentences below. In order:
  1. Drop a leading byte order mark. Trimmed text that is empty: refuse.
  2. If the trimmed text starts with `{` or `[` and parses as JSON: an object with a `magpieObjects` key is a file (see the refusals for a bad one); any other object is one candidate; an array gives one candidate per element.
  3. Otherwise each fenced `magpie` or `card` block (the pattern ```` /```(magpie|card)[ \t]*\n([\s\S]*?)\n?```/g ````) gives its parsed object, or one candidate per element of its array; a block that is not valid JSON is one candidate that fails as "not valid JSON".
  4. If step 3 finds no block: every balanced top-level `{...}` span in the text (strings and escapes respected) that parses as a JSON object with a string `title` is a candidate. This catches an answer copied from a chat's rendered view, which loses the fences. Spans that do not parse, or have no `title`, are ignored, not reported.
  5. Candidates past 200 are not read. Each candidate goes through `cleanObject(candidate, { imported: true })`. Kept objects past 50 are counted in `over`.
  6. `found` is the number of candidates read. `dropped` lists each candidate that was not kept, as `{ at, why }`: `at` counts candidates from 1, `why` is one of `not valid JSON`, `not an object`, `it has no title`, `it has no content`.
- `server/ai.js` takes `ICONS`, `KINDS`, `cleanObject` and `objectRule` from `object-format.js`, builds `SUMMARY_RULE` from `objectRule`, and keeps exporting `cleanSummary` (as `cleanObject` called with `{ count }`), `ICONS`, `KINDS` and `MAX_SUMMARIES`, so `tools/check-ai.mjs` runs unchanged. `parseSummaries` also accepts a `magpie` block. The Assistant's own answers get the 6000 and the http links too; `SUMMARY_RULE`'s text does not change, since it names no content length.
- **The action bus**, `busInput` in `server/index.js`: a `text` field is cut at **8000** characters instead of 1000, for every action. A `string` field stays at 200. Nothing else in the bus changes.

Routes, in `server/index.js`:

- **`GET /api/objects/format`**: a signed-in person or a guest with a link (`moduleViewer`), else 401 `sign in first`. Answers `200 { version: 1, fence: "magpie", fileSuffix: ".magpie-objects.json", instructions, schema }`, the instructions in this environment's words.
- **`GET /api/objects/format/schema`**: the same caller rule. Answers `200` with the schema alone, `Content-Type: application/schema+json`.
- **`GET /api/modules/:id/objects/check`**: whether this person may bring objects into this place with this module, for a page to show or hide its controls. `moduleAccess(req, res, 'write')`, then the rule below. Answers `200 { available, why }`, `why` being `""` or one of the 403 sentences below.
- **`POST /api/modules/:id/objects/check`**: reads objects out of what was given; stores nothing. Its own body parsers, placed on the route: `express.text({ type: 'text/plain', limit: MAX_IMPORT_BYTES })` for pasted text and `express.raw({ type: 'application/octet-stream', limit: MAX_IMPORT_BYTES })` for a file's bytes, which the server decodes as `public/file-text.js` does (UTF-16 by its byte order mark, else UTF-8). Then `moduleAccess(req, res, 'write')`, the rule below, the rate limit, and `readObjects`. Answers `200 { version: 1, objects, found, dropped, over }`, each object in the format above with `basis: "imported"`.

The rule (phase 1): the module's `write` permission (for the Assistant, `use`) through `moduleAccess`; a guest is refused; a space with `aiOff` is refused; no AI service, `useAi` permission or new module permission is needed.

Every refusal, with its sentence (words in `${}` go through `word()`, as the rest of the server does):

| Status | When | Sentence |
|---|---|---|
| 401 | not signed in, no guest link | `sign in first` |
| 404, 403, 400 | `moduleAccess`'s own refusals | as they are today |
| 403 | a guest | `${guests} cannot bring in ${objects}` |
| 403 | the space has `aiOff` | `AI is turned off in this ${space}` |
| 415 | neither `text/plain` nor `application/octet-stream` | `send the text as plain text, or the file as it is` |
| 413 | over 256 KB (a branch in the error handler for this path) | `that is over 256 KB; bring it in in parts` |
| 400 | nothing but white space | `paste an answer or choose a file first` |
| 400 | `magpieObjects` is an integer above 1 | `that file is format ${n}; this server reads format 1` |
| 400 | `magpieObjects` is anything else but 1 | `that is not a .magpie-objects.json file` |
| 400 | a file whose `objects` is not an array | `that file has no list of ${objects}` |
| 400 | no candidate found at all | `nothing in that could be read as ${objects}: paste the whole answer, with its magpie blocks` |
| 429 | over the new `check` limit, 20 a minute per module and person (`server/module-limits.js`) | `limitMessage()`, with `Retry-After` |

Candidates found but none kept is `200` with `objects: []` and the reasons in `dropped`, so the page can say why.

### SDK

In `public/sdk/host.js` (`host.objects`) and `public/module-host.js` (the bridge, sending the module's own id and place as the other `objects.*` calls do):

- `host.objects.format()` resolves to the `GET /api/objects/format` answer.
- `host.objects.checkAvailable()` resolves to `{ available, why }`.
- `host.objects.check(input)`: `input` is a string (sent as `text/plain`) or a `Blob` or `File` (sent as `application/octet-stream`). Resolves to `{ objects, found, dropped, over }`; rejects with the server's sentence as the error's `message` and its `status`.

These are generic: nothing in them knows the Assistant.

### The Assistant's pages

In `modules/assistant/src/`: `assistant.html`, `assistant.js`, `assistant-lib.js`, `assistant.css`, `CONTRACT.md`. All text goes in with `textContent`; the objects' content is drawn with `host.util.markdown`, as answers are. Colours only from the theme tokens.

- **Opening it.** A titlebar icon `{ id: 'import', icon: 'file-import', title: 'Bring in research' }` in `host.header.set`, before New conversation, shown when `host.objects.checkAvailable()` says available **and** a save action exists (the same `findSaveAction` as today). Where there is no titlebar, a fallback button `#import-open` in `.ask-head`, like `#new-chat`. It shows even when the AI is not available here (no service set up, or the role lacks `useAi`): the unavailable state stays in the thread and the import still works.
- **The panel**, `#import-panel` (hidden until opened, like `#ask-picker`), holds:
  - `#import-copy`, **Copy instructions for another AI**: fetches `host.objects.format()` and writes `instructions` to the clipboard, then says "Copied. Paste it into the other AI first." If the clipboard refuses (a sandboxed frame may), `#import-show`, a read-only textarea, shows the text selected, with "Select all and copy it."
  - `#import-text`, a textarea, placeholder "Paste the whole answer here".
  - `#import-choose`, **Choose a file**, opening `#import-file` (`accept=".json,.md,.txt,application/json,text/plain,text/markdown"`); a chosen file goes to `host.objects.check(file)` at once.
  - `#import-check`, **Preview**, sending the textarea's text.
  - `#import-close`, and `#import-why`, the line a refusal's sentence goes in.
- **The preview**, `tpl-msg-import`: a message in `#thread` like an answer (`.msg-ai.msg-import`, `.who` "Brought in" with the `file-import` icon). Its `.parts` hold one `tpl-import-row` per object: a checkbox (ticked at first, `aria-label` "Keep this one") beside the object drawn with the same `tpl-aicard` as an answer, so it has the kind's colour, keep and copy, and can be dragged like any answer object. Under them, `tpl-import-foot`: **Keep ticked** with `[data-slot=count]`, and `[data-slot=dropped]` saying what was left out in one plain line ("2 could not be read: 1 had no title, 1 was not valid JSON." and "12 more were left out: at most 50 at a time.").
- **Keep ticked** works as Send all does: one confirm naming what goes out ("Keep 3 hotels and 2 notes?"), then `keepOne` for each ticked object not already kept, in order. A kept object's checkbox is disabled.
- **The imported mark.** `data-basis="imported"` on the object; its basis line reads "From another AI: check it before you rely on it".
- **Where it goes.** Unchanged from today's keep: an object with a `kind` goes to a suggestion-shaped action (`acceptSuggestion`, the Planner's), anything else, or everything when no such action exists, to a note-shaped one (`saveNote`, Research's). Both are found by name and input shape, never by module id.
- **Links, for every object** (answers and imports): a new `[data-slot=links]` in `tpl-aicard` lists each link as a `.link` pill, its title shown and its address in the `title` attribute. Hidden when there are none.
- **What is kept** (`assistant-lib.js`): one new helper, `keptText(summary, { question, sourceNames })`, builds the text for both paths, so they match and a check can test it. In order, separated by a blank line where a part is present:
  1. the object's `content`;
  2. for an answer only, `Asked: <question>` and `From: <names>`, as `keepInput` writes them today;
  3. `Links:` and one `- <title>: <url>` line per link, when there are links;
  4. for an imported object only (`basis: "imported"`), the last line `External source`.
  The whole text is at most 8000 characters (the bus's cut): when it would be longer, the content is shortened and ends with `…`, and every other part is kept whole. `keepInput` puts it in `body`; the suggestion input puts it in `content`.
- **A queued keep counts as sent**, for answers and imports: when `host.actions.request` answers `queued`, the keep button gets `.queued` and the title "Waiting: it is kept when that module is next open", it counts as kept for Send all and Keep ticked, and it is never requested again. Only an answer with `status: 'done'` and `result.ok` false, or a refused request, is a failure.
- **Version:** Assistant goes from 0.1.16 to 0.1.17 (`modules/assistant/module.json`, and its entry in `tools/module-versions.json` through the build).

### The destinations' limits

- **Research** needs no change: `saveNote` keeps a `body` of up to 8000 characters, which fits the 6000 content with its links and lines.
- **The Planner** (module `travel`) keeps a suggestion's `content` as its item's `notes`, cut at 2000. Raise that cut to **8000** in `fromSuggestion` (`modules/travel/src/travel-lib-plan.js`) and in `cleanItem` (`modules/travel/src/travel-lib.js`), and the Notes fields' `maxlength` to 8000 (both `#f-notes` in `modules/travel/src/travel.html`), so a person can edit what was kept without it being cut. Nothing else in the Planner changes. **Version:** Travel goes from 0.7.37 to 0.7.38.

### Files to touch

- `server/object-format.js` (new), `server/ai.js`, `server/index.js` (four routes, the body parsers, the 413 branch in the error handler, `busInput`'s `text` cut), `server/module-limits.js` (`check: 20`).
- `public/sdk/host.js`, `public/module-host.js`.
- `modules/assistant/module.json`, `modules/assistant/src/assistant.html`, `assistant.js`, `assistant-lib.js`, `assistant.css`, `CONTRACT.md`.
- `modules/travel/module.json`, `modules/travel/src/travel-lib-plan.js`, `travel-lib.js`, `travel.html`.
- `tools/module-versions.json` (both modules, through the build).
- `tools/check-object-format.mjs` (new, added to `npm run check` in `package.json`), `tools/check-assistant.mjs`, `tools/check-travel.mjs`, fixtures in `tools/fixtures/object-format/`.
- For content-manager afterwards: `documentation/api/api-module-sdk.md` (the three `host.objects` calls), `documentation/api/api-modules.md` (the routes), `documentation/architecture/architecture-modules.md` (the format as a conduit), and the Assistant's user guide.

## Left to build, in order

Each step can be built, checked and committed on its own.

1. **server-development: the format module.** `server/object-format.js` with `cleanObject` (content 6000, http and https links, the `imported` option), `objectRule`, the constants and caps; `server/ai.js` uses it; `SUMMARY_RULE` unchanged; `parseSummaries` accepts `magpie`. Checked by `tools/check-ai.mjs` unchanged and check cases 1 and 10 to 13 below.
2. **server-development: the bus's `text` cut to 8000.** `busInput` only. Checked on a throwaway server: a 7999-character `text` input arrives whole, a 9000-character one arrives as 8000.
3. **experience-design: the Planner keeps 8000.** `fromSuggestion`, `cleanItem`, the two `maxlength`s, Travel 0.7.38. Checked by `tools/check-travel.mjs`: a 7000-character `content` in `fromSuggestion` comes out as 7000 characters of `notes`.
4. **server-development: publish.** `instructions()`, `schema()`, `GET /api/objects/format` and `GET /api/objects/format/schema`. Check cases 2 and 3.
5. **server-development: read.** `readObjects`, `GET` and `POST /api/modules/:id/objects/check`, the parsers, the 413 branch, the `check` limit. Check cases 4 to 9 and 14 to 16, and the route checks.
6. **experience-design: the SDK.** `host.objects.format`, `checkAvailable`, `check`, and the bridge.
7. **experience-design: the Assistant.** The panel, copy instructions, paste and file, the preview, Keep ticked, the links slot, `keptText` with `External source`, the queued state, `CONTRACT.md`, 0.1.17. Needs steps 2, 3, 5 and 6.
8. **content-manager:** the documents listed above, and a CHANGELOG entry with each commit.

## Check cases

In `tools/check-object-format.mjs`, run on the module alone (no server), with fixtures in `tools/fixtures/object-format/`:

1. `SUMMARY_RULE` equals the rule before this work, character for character (a copy of today's string kept in the check).
2. The published instructions contain the `magpie` fence, every `ICONS` and `KINDS` name, "at most 50", the file paragraph, and neither `basis` nor `sources`.
3. `schema()` is valid JSON, its `icon` and `kind` enums equal `ICONS` and `KINDS`, and every fixture object the checker keeps in full also fits the schema's lengths and patterns.
4. A pasted answer with prose and three `magpie` blocks gives three objects in order; one with a `card` block gives one.
5. A `magpie` block holding an array of two gives two.
6. Raw JSON: one object gives one; an array of three gives three.
7. A file `{ magpieObjects: 1, objects: [...] }` gives its objects; `magpieObjects: 2` is refused with the format sentence; `magpieObjects: "1"` with the not-a-file sentence; `objects` missing with the no-list sentence.
8. A UTF-16 file with a byte order mark reads the same as its UTF-8 copy (checked through the route's decoding helper).
9. An answer copied without fences (the rendered-view fixture) gives its objects by the balanced-brace step; text with braces but no title gives nothing and the "nothing in that" refusal.
10. Every kept object has `basis: "imported"` and no `sources`, even when the input had `basis: "both"` and `sources: [1]`.
11. `cleanObject` without `imported` refuses a model's `basis: "imported"`.
12. Links: `http:` and `https:` kept; `javascript:`, `data:`, `ftp:`, one with a user name, and one over 500 characters dropped; a sixth link dropped.
13. Title over 80 and content over 6000 are cut (a 5999-character content is kept whole); `<script>` tags are stripped from content; a missing title or content lands in `dropped` with its sentence and its `at`.
14. 60 valid objects give 50 and `over: 10`; 250 candidates read only 200.
15. Empty and white-space-only text is refused with its sentence.
16. A block that is not valid JSON is in `dropped` as `not valid JSON`, and the other blocks still come through.

In `tools/check-assistant.mjs`, for `keptText` and both inputs built from it (`keepInput`'s `body`, the suggestion's `content`):

- An answer with no links: the content, then `Asked:` and `From:` as today, and no `External source`.
- An answer with two links: a `Links:` line and two `- <title>: <url>` lines, and no `External source`.
- An imported object with links: the content, the links, then `External source` as the last line; no `Asked:` or `From:`.
- A 6000-character content with five 500-character links and `External source`: the whole text is at most 8000 characters, the content ends with `…`, and every link and the last line are whole.

In `tools/check-travel.mjs`: `fromSuggestion` with a 7000-character `content` gives 7000 characters of `notes`, and `cleanItem` keeps them.

On a throwaway server (`PORT=3001 DATA_DIR=/tmp/import-check`), by quality-assurance with `curl`: each route's answer and every refusal in the table, including 413 at 256 KB plus one byte, 415 for `application/json`, the guest refusal with a guest link, `aiOff`, and 429 on the twenty-first check in a minute; and an action request whose `text` input is 9000 characters stored as 8000.

## Acceptance criteria

- In the Assistant, **Copy instructions for another AI** puts the instructions on the clipboard, or shows them to copy by hand. They are in this environment's word for object, ask for `magpie` blocks, at most 50 objects and content under 6000 characters, and offer the `.magpie-objects.json` file.
- Another AI given those instructions writes `magpie` blocks that, pasted whole into the Assistant, show as a preview of ticked objects in their kinds' colours, each marked as from another AI, with its links shown.
- A pasted JSON object or list, and a `.magpie-objects.json` file, preview the same way. At most 50 come through; the rest are counted in one line.
- **Keep ticked** keeps each ticked object into the current space: one with a `kind` into the Planner, the rest into Research, through the same actions the Assistant already uses. Content of up to 6000 characters arrives whole in both, with its links, and the kept text ends with `External source`.
- A keep that waits for a closed module is shown as waiting, counts as kept, and is never sent twice, for answers and imports alike.
- Anything that could not be read is named in one line; nothing unread is kept. Importing the same thing twice keeps it twice (no duplicate detection in phase 1).
- A guest, and anyone in a space with AI turned off, sees no import control, and the server refuses them with the sentences above. Anyone else who may use the Assistant can import, with or without an AI service set up and with or without `useAi`.
- The Assistant's own answers work as before, except that http links are now kept, links are drawn and carried into what is kept, content up to 6000 is kept, and a waiting keep shows as waiting. They never get `External source`. `SUMMARY_RULE`'s text is unchanged.
- Every action's `text` input is kept up to 8000 characters.
- Assistant is 0.1.17 and Travel is 0.7.38; no other module changes.
- `npm run check` passes, including the new check.

## Verify

- Steps 1, 4 and 5: checked by a tool (`tools/check-object-format.mjs`, `tools/check-ai.mjs`), and the routes by `curl` on a throwaway local server.
- Step 2: checked by `curl` on a throwaway local server.
- Step 3: checked by a tool (`tools/check-travel.mjs`), and a long note edited in the Planner's form in a browser.
- Steps 6 and 7: verified live in a browser on the local server with the Assistant, Research and the Planner on a space's canvas. No AI service is needed to import, so the whole path can be checked locally; the fixtures stand in for real answers. The waiting state needs Research or the Planner closed.
- No step needs a LiveKit call.
- What a local server cannot show: how a given outside AI actually follows the instructions. Try the copied instructions in at least two outside AIs and paste their real answers, and say which were tried.

## Not in scope

- The direct connection (part 3, below).
- Destinations other than Research and the Planner (below).
- Magpie writing a `.magpie-objects.json` file (export).
- Spotting duplicates of objects already kept.
- Dropping a file onto the Assistant, or spotting `magpie` blocks pasted into the question box.
- Choosing where each object goes: it goes where the Assistant's keep sends it today.
- Strict structured-output modes of particular AI services.
- Pictures, attachments and `sources`.

## Later: more destinations (soon after phase 1)

To-do and Calendar must be honoured as destinations soon, through a generic conduit, never by the Assistant naming them. Today the Assistant finds two action names (`saveNote`, `acceptSuggestion`) by name and shape, which reaches only Research and the Planner. The next plan should give every module one way to say "I can keep an object like this": for example a shared action shape, or a `module.json` declaration, that takes the format's fields (`title`, `kind`, `content`, `place`, `date`, `links`). The Assistant, and any other module, would then list every destination in the space from `host.actions.list()` and let the person choose, or send by `kind` and `date` (a dated object to a calendar, say). To-do and Calendar would provide it the same way Research and the Planner do. That needs its own plan, which also settles whether the person picks a destination per import or per object.

## Later: a direct connection (part 3, after #64)

Once #64 gives Magpie long-lived, revocable integration tokens, an owner (or a person, if #64 allows) could make a token scoped to **adding objects to one space**, and nothing else, for a desktop AI app or an AI's custom action. That AI would read the schema and send objects to a route such as `POST /api/objects/import` with `Authorization: Bearer`; they would go through `readObjects` and `cleanObject` exactly as a paste does. The question to settle then: modules run no server code, so where the objects wait until someone keeps them. Two shapes: queue them as requests to the space's save actions (they land when the providing module is next open), or hold them in a small per-space inbox the Assistant shows as a preview to tick. That needs its own plan once #64 is planned.

## What is not decided

Nothing blocks phase 1. Left for later plans:

- The generic destination conduit above: its shape, and how a person chooses among destinations.
- The direct connection: where objects wait, and who may make a token.
- Whether phase 2 adds a separate `import` permission, or duplicate detection, if phase 1 shows a need.
