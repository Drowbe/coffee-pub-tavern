# Assistant

**Audience:** a player or game master having a conversation with the AI using the Assistant module on a Coffee Pub Magpie server, and an admin setting it up.

Assistant is a place for an open-ended conversation with the AI the admin set up: docked, floated or popped out like any other pane. It keeps nothing of its own. Add anything with a card as context if you want the answer to draw on it, or ask it anything. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. Set up the AI itself first: on the Modules tab, **AI service** (none, OpenAI, Anthropic, or another OpenAI-compatible service), a model and a key, then **Approve and enable**. See [Modules](userguide-modules.md).
2. On the Modules tab, choose **Install** beside Assistant, then **Approve and enable**. It asks to link to every other module's items, to ask their actions, and to use the AI hook.
3. Tick **Available in every room**, or tick it per room.
4. On the Roles tab, **Use AI in modules** (under AI) governs who may actually get an answer here; it is off for everyone until you turn it on, and a guest never can. A separate **Use the assistant** permission, under Module: Assistant, governs who may open the pane at all (on by default).

## Ask

Type a question and send it. With no context, it answers from what the AI already knows; add context (**Add context**, a checklist of everything reachable here: this room's items and your own) to have it draw on your notes, places, plans and anything else, and it says which parts of the answer came from them. **New conversation** clears the thread; closing the pane does the same. Nothing here is stored, on the server or on your device.

When the AI writes something worth keeping, it appears as a card inside its answer: a title, the text (which may use headings, **bold**, lists and links), tags, and where it came from. Asked for several things at once (an itinerary, a few hotel options), it writes one card per thing rather than folding them into prose. The bookmark keeps it: a card that is plainly a flight, a hotel, a sight and so on is placed as that proper kind of item if Planner is installed, on the day the card names; any other card, or without Planner, is saved as a note (a module that keeps notes, such as Research, must be installed; without one, the button is disabled and says so). The copy button copies its text, and, like any card, it can be dragged onto a plan or anywhere else that takes one.

## Research this

Another module's item menu may offer **Research this** (Research's does): it opens Assistant with that one item already added as context, so you can ask about it straight away.

## For module authors

Assistant provides one action (see [the SDK guide](api-module-sdk.md)): `askAssistant` (optional `ref`, a pointer to add as context, and optional `question`, asked at once), a `local` action carried out only in the requester's own open Assistant, opening it if it is not. It consumes every kind another module produces, so context can come from anywhere. A kept card is saved through whichever module offers a matching action, found by name and input shape, never by naming a module: a card with a recognised `kind` prefers a suggestion-shaped action (a `title` and a `kind`), which Planner's `acceptSuggestion` offers; any other card, or without one, falls back to a note-shaped action (a `title` and a `body`), which Research's `saveNote` offers.
