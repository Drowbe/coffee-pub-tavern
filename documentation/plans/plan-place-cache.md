# Place Search Cache Plan

**Audience:** the author deciding how Magpie builds its own place data from use, and whoever builds it afterwards.

**Status:** Decided by the author; nothing here is built.

## The idea

When a place search goes to an outside service (Photon, or an address the admin chose), Magpie keeps what comes back on the server. A later search looks on the server first and asks the outside service only when the server has too little. Over time the server builds its own place data from use, and the outside service is asked less and less. A later hosted Magpie service becomes one more source, and this collection can seed it.

## Decisions (author)

- **Keep every result the service returns**, not only the one a person picks. The goal is a database that saves calls, so more is better. Each saved place carries a **used** mark: set when someone saves it as one of their places or picks it from a search, clear otherwise. Later the admin can **purge** by that mark (for instance, everything unused older than N days).
- **A checkbox, off by default (the author's later decision, until Photon's terms and the licence question are settled):** "Save places to the server", shown only when an outside address is chosen (Photon or my own address). It sits with the search choice on the Places Module Configuration page, with a short notice.
- **Local first, outside second.** A search reads the saved places; if they answer well (at least a handful), the outside service is not asked. Each result says where it came from ("Saved on this server" or "From Photon").

## What is stored, and what is not

- Stored per place: the OpenStreetMap type and id (so it can be refreshed and credited), the name, the address and its parts, the position, the category if the service gives one, the time it was first and last seen, how many times it was returned, and the **used** mark.
- **Not stored:** what anybody searched for, who searched, or from which room. The collection has no link to any person. That is the privacy line: a result is a fact about a place, not a record of someone's interest.
- The collection belongs to the server, not to a room or a person, and is shared by every room.

## Notice for the checkbox

"When search goes to an outside service, the places it returns are saved on this server and shared by every room, so later searches use them first and the outside service is asked less. A saved place is a place, not who looked for it. You can purge them later."

## Licence and terms (to settle before this can be on by default; for now it is off and the admin turns it on)

- The data is OpenStreetMap's, under the ODbL. Keeping a private copy is fine. If Magpie (or a hosted edition) serves the saved collection to other people, the ODbL requires the collection to remain open under the same licence and to credit OpenStreetMap. The credit "© OpenStreetMap contributors" stays wherever results are shown.
- Photon's public service asks for reasonable use and says nothing about storing results; read their terms before turning this on by default. A hosted edition should not be built on a public demo service.

## Order of work

1. The saved-places collection (server scope) and its record, with the used mark; local-first search that falls back to the outside service, labelling each result's source; saving what comes back. (Server Development.)
2. The checkbox and its notice on the Places Module Configuration page (interface side, in the settings text and the list).
3. Purge on the Module Configuration page: a "Saved search results" section showing how many places are saved, how many are used, and buttons to purge unused (all, or older than a chosen age) and to purge everything. (Both sides.)
4. Refresh: an admin action, or a slow background one, that re-reads a saved place from the outside service when it is old.

## Open questions

1. How many local results are "enough" to skip the outside service? Proposed: five.
2. Should a used place be protected from purge? Proposed: yes; the used mark exists to protect it.
3. When a place is used, does that make it a saved place of the room automatically? Proposed: no; the used mark is only about the collection. A person still saves a place to Places.
