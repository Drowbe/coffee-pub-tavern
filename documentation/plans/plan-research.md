# Research Plan

**Audience:** the author deciding what the Research module is and how its AI part works, and whoever builds it afterwards.

**Status:** Direction agreed by the author (the recommendations below, and the answer card). Nothing is built. Decisions taken are at the end.

## What it is for

A place to keep what a group finds out while it plans, and after: a note, a link with the part that mattered, a photo with what it shows. It is not about travel. A trip is the first user; a house purchase, a wedding or a project is the same shape. What is kept can be found again by tag, linked from anywhere in Tavern, put on the map or on a day when it has a place or a date, and questioned or summarised by an AI the admin chose.

## Principles (the ones we already hold)

- **A conduit, not a special case.** Research offers cards, links and actions in the generic ways; no other module is named in it, and it names none.
- **Private by default, shared on purpose.** A person's own research (Mine) is theirs alone, in their profile, across rooms. A room's research is the room's. Sharing is a copy, as with Places.
- **Nothing leaves the server unless the admin turned it on and said where to.** Link previews and AI are both off until configured, and each says plainly what it sends and to whom.
- **No secrets in modules.** An API key for an AI service is a server setting. The module asks the server; it never sees a key.

## The kinds of item, one card family

1. **Note.** A title, a body of plain text (paragraphs and lists; links in it are clickable), tags, and optionally a place and a date.
2. **Snippet** (a link). A web address, a title, the site, and the person's own excerpt (what to remember from the page), tags. With the admin's "fetch link previews" turned on, the server reads the page's title, description and image so the person does not type them; off by default, because it is a request from the server to a site the person named.
3. **Photo.** An image, a caption and tags. On upload the server reads the file's own facts: when it was taken, the camera, and where. **The position is dropped by default** (a shared photo must not give away a home address by accident); a per-photo choice keeps it, and a photo with a position shows on the map and one with a date shows on its day. The file is re-encoded by the server (a size limit, a maximum edge of about 2000 px, a thumbnail), which also removes anything hidden in it.

All of them (and the answer cards the AI writes, below) are cards for the rest of Tavern: a title, a subtitle, a date (`when`), a `place` if it has one, and a category naming its kind. That is what lets a note be dragged onto a plan's day, a photo appear on the map, and a place list "3 notes about this place".

## Photos as a shared album while a trip happens

The room's view is a shared board: anyone in the room adds their own photos, each shows who added it, and they sort by the date taken. On a phone the add button opens the camera or the photo library. This needs a generic piece in the core that modules do not have today: a place for a module's **uploaded files**, per scope (person, room), with limits, thumbnails and clean-up when an item is deleted. It is not specific to Research, and Server Development would build it as a shared tool (see Order of work).

## Views and tags

- **Mine** (the person scope) and **This room**, in a switcher like Places' header. A copy moves an item between them. "Everyone" can come later.
- **Tags** are plain words a person types, with a suggestion from the ones already used. A list of well-known tags with a colour each can be kept in Module Configuration (the same list control the marker types use), so tags can be coloured and shared; other tags stay plain.
- **Find:** a text search, filter chips for tag and kind, and a date range; the list can be a grid of cards or a compact list.

## How other modules use it (conduits)

- **Produces** four kinds of item (note, snippet, photo, answer) with cards as above, openable from anywhere.
- **Provides actions**: `saveNote` and `saveLink`, so any module can offer "Save to research" on something without knowing Research is there (a place, a stop, a search result). A photo is added in Research itself.
- **Backlinks**: when an item links to research (or research links to an item), the item's owner lists it: "Used in 2 plans", "3 notes".
- **Drop targets**: drop an item from another module onto Research to start a note linked to it; drag a research item onto a plan's day to link it there (the ordinary path).

## The AI part

### What it does

Each is a button a person presses on what they are looking at; nothing runs on its own.

- **Summarise** a note, a snippet's text, or a chosen set of items.
- **Ask** a question over the items the person selected ("what did we find about hotels near the station?"), with the answer citing the items it used.
- **Suggest tags** for an item, and **caption** a photo (only with a model that can see images).
- **Extract:** read a note or snippet and propose the places, dates and prices in it as cards, which the person accepts one by one (a place goes to Places, a date to a plan).
- **Draft** a day: from chosen research, propose stops for a day of a plan, as suggestions the person accepts.

### The AI writes a card inside its answer (the author's)

A conversation with the AI is talk: the question, the reasoning, the follow-ups. **None of that is saved.** What is worth keeping the model writes as a **card** inside its answer, and the Ask panel draws that card inline, between the sentences around it (the author's sketch: some lines of text, a card, more lines). The card is the artifact: it can be **kept** in Research (Mine or This room, wherever the person is working) and **dragged** onto a plan's day or onto anything else that takes a link, like any other card. The prompt tells the model to always write at least one card holding the essence of its answer.

**The card as the model writes it** (a fenced block in its reply, one per card; a reply may hold several, for instance one per place found):

```json
{ "icon": "hotel", "title": "Three hotels near Santa Apolónia, under €140",
  "content": "Hotel Lisboa Plaza (€128, 4 min walk) …", "tags": ["hotels", "lisbon"],
  "place": { "name": "Santa Apolónia, Lisbon", "lat": 38.714, "lng": -9.122 },
  "date": "2026-10-04", "links": [{ "title": "Lisbon hotels", "url": "https://…" }],
  "sources": ["<the ids of the items it drew on>"] }
```

- **Checked, never trusted.** The server (or the page, for a card it displays) validates every field: `icon` must be one of a fixed list of icon names, `title` a line of up to 80 characters, `content` plain text of up to about 2000 characters (no HTML, no script), up to 5 tags of one word, `place` a name and optionally a position in range, `date` a valid day, `links` https addresses only, `sources` only ids of items the asking person was given. Anything else is dropped. A block that does not validate is shown as ordinary text.
- **Drawn as a card:** an icon badge, an "Answer" label with a permanent "AI" mark, the title, the content, tags, the place and date if there are any, and the sources as links. While the reply streams, an unfinished block is not drawn; a small "Writing the card…" stands in for it.
- **Keeping it** (the bookmark on the card, or the first time it is dragged) saves it as an item of kind **answer** in the current view, with the conversation's question stored as the card's "asked" line and nothing else of the chat. A private answer dragged onto a shared plan is copied to the room first, as with any private item. The conversation itself is not stored on the server; closing the Ask panel ends it.
- **A card for Extract and Draft** holds one proposal each (a place, a date, a stop), so a person keeps or drops each one on its own.
- The author's mock: `modules/research/design/ask.html`.

**The AI never changes anything itself.** Its answer is text or a list of proposals; a person accepts each. Text in a note or on a web page is untrusted, and a page can say "ignore your instructions", so the model is given no tools and its output is never run.

### How it is wired: a server hook, like notifications

The module asks the server (a hook, `host.ai.ask`, next to `notify` and `schedule`). The server: checks the person may use AI (a permission on the Roles tab), reads the items **as that person** (only what they may see, from the scope they are in), builds the prompt, calls the provider the admin configured, and returns the answer (streamed). It rate-limits per person and per module, keeps a usage count, and writes a line in the activity log (who, which task, how many tokens; never the text). The key, and the address of a local model, live in the server's settings, never in a page.

### Providers: one adapter covers hosted and local

- **An OpenAI-compatible chat endpoint** (an address, an optional key, a model name). This one adapter reaches the hosted services that offer the interface and, just as well, **a local model server** (Ollama, LM Studio, llama.cpp's server, vLLM), which all speak it. So "a local model" is not a second feature: it is the same choice pointed at an address on the admin's own network.
- **The Anthropic API** as a second, native adapter (a key and a model).
- Later, Tavern's own hosted service is one more entry in the same list.

The setting is a choice, as Place search is: **None** (the default), the two above, with a plain notice under each. With a hosted service the notice says the items a person selected are sent to that company. With a local model it says nothing leaves the admin's network. A room can switch AI off for itself.

### Limits and honesty

- Only what the person selected is sent, never another room, and never someone's Mine unless it is their own request. Photos are sent only for a vision task, only if the admin allowed images.
- A monthly token cap and a per-person rate limit, and a usage panel on Module Configuration (tokens used, by task), so a bill is not a surprise.
- Tavern ships no model and no key. The admin brings them, and the terms of the service or the model are the admin's.

## Order of work

1. **Research core**: notes and snippets, tags, Mine and This room, cards, conduits, actions, the pane and its phone layout. (Design first, then the script.)
2. **A file store for modules** (core, generic): per scope, limits, thumbnails, clean-up. Then **photos**: upload, the server's re-encode, metadata, the album, the map and day links.
3. **Link previews**: the server fetch, off by default, with protection against being pointed at the server's own network.
4. **The AI hook** and the provider setting: Summarise, Ask, Suggest tags. Usage, limits and the notice.
5. **Extract and Draft**, photo captions, and the proposals flow.

## Decisions taken

The author agreed the recommendations:

1. **Photos:** the position is dropped by default, with a per-photo choice to keep it.
2. **AI tasks first:** Summarise, Ask and Suggest tags; Extract and Draft second.
3. **Providers:** an OpenAI-compatible endpoint first (which covers a local model server), the Anthropic API second. The AI is reached through an API key kept on the server.
4. **Who may use AI:** nobody until the admin turns it on for a role; never guests.
5. **Photos:** about 10 MB each, re-encoded to about 2000 px on the long edge with a thumbnail. Still to settle: how many photos a room may keep before the admin is warned.
6. **Name:** Research (id `research`).
7. **The AI writes a card inside its answer** (a JSON block drawn inline), and only that card is kept or dragged; the conversation is not saved.
