# Smart, Multiple Cards Plan

**Audience:** the author's request for the Assistant to answer a multi-part question (a 10-day itinerary) with one well-typed card per thing, not a wall of text; and whoever builds it.

**Status:** Proposed. Nothing built. Extends the card the AI already writes (see `plan-research.md`, "The AI writes a card inside its answer") and `plan-assistant-module.md`.

## The request

Ask Assistant "pull together a 10-day itinerary" today and it writes one card summarising the whole thing in prose. The author wants: one card **per** flight, hotel, attraction and so on, each recognisably typed, so a person can drag any one of them onto a plan, or **send all of them** at once.

## The card gets one more optional field: `kind`

Everything a card already has stays (`icon`, `title`, `content`, `tags`, `place`, `date`, `links`, `sources`, `basis`). `kind` is one word describing the everyday sort of thing it is, when it is one of these: `flight`, `train`, `bus`, `ferry`, `car`, `hotel`, `restaurant`, `cafe`, `bar`, `sight`, `museum`, `tour`, `show`. Left out (or anything else), it is a plain card, as today. This is ordinary domain language, not a module's internal names, so it names nothing; it happens to line up with what a plan can already hold, which is exactly the point.

A card with a `kind` is drawn with that kind's icon and colour (the same family Planner and Places already use for the same words), so a reply full of them reads at a glance: green for a sight, orange for food, and so on.

## The prompt: write several, when there are several

Today's instruction asks for "at least one card, at most three." For a request that plainly asks for more than one thing (an itinerary, a list of options, "find me three hotels"), it should write one card per thing instead of folding them into prose, up to a much higher ceiling (proposed: 20; Server Development should tune this against real replies and token cost). A single-question reply ("what's the best neighbourhood to stay in") still gets its one card, as now.

## Send all to a plan

**Where it shows.** Under an AI message that has more than one card: **Send all to plan** (or "Keep all," where no plan is open — see below), next to each card's own keep button.

**What it does.** The same thing keeping one card already does, once per card, in order: it asks whichever module offers to accept a suggestion, generically. Nothing new for a plain card (it keeps it as a note, as today).

**For a card with a `kind`, a plan can do more than keep a note about it.** A plan (Planner) is the obvious thing that wants a typed suggestion turned into a real stop, journey or stay on the right day, not a linked note about one. This needs a **new generic action Planner provides** — a shape like `acceptSuggestion({ kind?, title, content?, place?, date?, links? })` — found by Assistant the same way it already finds a note-saving action, by name and input shape, never by naming Planner. Given a `kind` it recognises, Planner adds a properly typed item, placed on the day the card's `date` names (or the next open day, if none); given no `kind`, or if nothing offers `acceptSuggestion`, it falls back to the existing note-save behaviour. **Send all** simply calls whichever it finds, once per card.

**The person still decides.** Sending all is a shortcut for accepting every card in one reply, not a silent bulk write: it shows what it is about to add (a short list: "3 stays, 6 sights, 1 flight") and confirms once, the same care every other one-click bulk action in Tavern already takes.

## Order of work

1. Server Development: raise the card ceiling and teach the prompt to write several when asked for several; add `kind` to the card's validated schema (one of the fixed words above, or absent).
2. Server Development (Planner's owner): `acceptSuggestion`, provided by Planner, placing a typed item by `kind` and `date`.
3. Interface side (mine, once 1–2 exist): the kind-coloured card badge, the **Send all to plan** button and its confirm list, the fallback wording when nothing offers `acceptSuggestion` ("Send all as notes").

## Not decided

Whether a sent-all item that lands on a day that already has something at that time should ask about the clash, the way dragging one item there already does, or just land un-timed and let the person place it. Proposed: un-timed, since a card seldom carries a time of day, only a date.
