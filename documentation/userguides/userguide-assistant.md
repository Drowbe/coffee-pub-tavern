# Assistant

**Audience:** a player or game master having a conversation with the AI using the Assistant module on a Coffee Pub Magpie server, and an owner setting it up.

Assistant is a place for an open-ended conversation with the AI the owner set up: docked, floated or popped out like any other module. It keeps nothing of its own. Add any object (a note, a place, an event) as context if you want the answer to draw on it, or ask it anything. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. Set up the AI itself first: on the Modules tab, **AI service** (none, OpenAI, Anthropic, or another OpenAI-compatible service), a model and a key, then **Approve and enable**. See [Modules](userguide-modules.md).
2. On the Modules tab, choose **Install** beside Assistant, then **Approve and enable**. It asks to link to every other module's objects, to ask their actions, and to use the AI hook.
3. Tick **Available in every space**, or tick it per space.
4. On the Roles tab, **Use AI in modules** (under AI) governs who may actually get an answer here; it is off for everyone until you turn it on, and a guest never can. A separate **Use the assistant** permission, under Module: Assistant, governs who may open the module at all (on by default).

## Ask

Type a question and send it. With no context, it answers from what the AI already knows; add context (**Add context**, a checklist of everything reachable here: this space's objects and your own) to have it draw on your notes, places, plans and anything else, and it says which parts of the answer came from them. **New conversation** clears the thread; closing the module does the same. Nothing here is stored, on the server or on your device.

When the AI writes something worth keeping, it appears as an answer of its own: a title, the text (which may use headings, **bold**, lists and links), tags, and where it came from. Asked for several things at once (an itinerary, a few hotel options), it writes one answer per thing rather than folding them into prose. The bookmark keeps it: an answer that is plainly a flight, a hotel, a sight and so on is placed as that proper kind of object if Planner is installed, on the day it names; any other answer, or without Planner, is saved as a note (a module that keeps notes, such as Research, must be installed; without one, the button is disabled and says so). The copy button copies its text, and it can be dragged onto a plan or anywhere else that takes one. An answer's links show under it, and what is kept carries them.

If Planner or Research is not open when you keep something, the bookmark shows it is waiting ("Waiting: it is kept when that module is next open"). That counts as kept: it arrives the next time someone opens that module, and it is never sent twice.

## Bring in research from another AI

You can research in another AI (a chat app on your computer or phone, say) and bring the results into Magpie as objects, kept the same way the Assistant keeps its own answers. Bringing research in uses none of this environment's AI: it works without an AI service set up and without **Use AI in modules**.

Who can: anyone with **Use the assistant**, except guests. In a space where **Turn AI off in this space** is ticked, nobody can. It also needs somewhere to keep things: Planner, or a module that keeps notes such as Research. When you can't, the button is not shown.

1. Choose **Bring in research** (the file icon in the Assistant's titlebar, beside **New conversation**, or at the top of the Assistant when it has no titlebar).
2. Choose **Copy instructions for another AI**. The instructions go on your clipboard ("Copied. Paste it into the other AI first."). If your browser does not allow that, the text is shown selected instead: select all and copy it.
3. Paste the instructions into the other AI, then ask it your question. It answers as usual and puts each thing worth keeping in a `magpie` block. You can also ask it for a file, which it names something ending in `.magpie-objects.json`.
4. Back in the Assistant, bring the answer in:
   - paste the whole answer into **Paste the whole answer here** and choose **Preview**; or
   - choose **Choose a file** and pick the `.magpie-objects.json` file (it is read as soon as you pick it).
5. A preview appears in the conversation, marked **Brought in**. Each object has a tick beside it, ticked at first, and each reads "From another AI: check it before you rely on it". Untick any you don't want.
6. Choose **Keep ticked**; the button shows how many are ticked. Confirm (for example "Keep 3 hotels and 2 notes?"). Each ticked object is kept, and its tick is greyed out once it is.

What to know:

- **Where each one goes.** The same as an answer's bookmark: an object that is plainly a flight, a hotel, a sight and so on goes to Planner as that kind, if Planner is installed; anything else, or everything without Planner, goes to Research as a note. See [Planner](userguide-planner.md) and [Research](userguide-research.md).
- **At most 50 at a time.** Anything past 50 is left out, and the preview says how many ("12 more were left out: at most 50 at a time."). Bring the rest in as a second paste.
- **What could not be read** is named in one line under the preview, for example "2 could not be read: 1 had no title, 1 was not valid JSON." Nothing that could not be read is kept.
- **The kept text ends with the line "External source"**, after the object's text and its links, so you can tell later where it came from. The Assistant's own answers never get that line.
- **Size.** A paste or file can be up to 256 KB. Each object's text is kept up to 6000 characters; anything longer is cut.
- **Twice is twice.** Bringing the same answer in again keeps it again; nothing spots duplicates.
- If the other AI's answer was copied from its formatted view and lost its `magpie` blocks, pasting it usually still works.

## Research this

Another module's object menu may offer **Research this** (Research's does): it opens Assistant with that one object already added as context, so you can ask about it straight away.

## For module authors

Assistant provides one action (see [the SDK guide](../api/api-module-sdk.md)): `askAssistant` (optional `ref`, a pointer to add as context, and optional `question`, asked at once), a `local` action carried out only in the requester's own open Assistant, opening it if it is not. It consumes every kind another module produces, so context can come from anywhere. A kept object, answered or brought in, is saved through whichever module offers a matching action, found by name and input shape, never by naming a module: an object with a recognised `kind` prefers a suggestion-shaped action (a `title` and a `kind`), which Planner's `acceptSuggestion` offers; any other object, or without one, falls back to a note-shaped action (a `title` and a `body`), which Research's `saveNote` offers. Bringing research in uses `host.objects.format`, `host.objects.checkAvailable` and `host.objects.check` ([the SDK guide](../api/api-module-sdk.md), "Bringing objects in").
