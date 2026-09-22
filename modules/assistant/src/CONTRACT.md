# Assistant: the markup and behaviour contract (draft)

**Audience:** whoever writes the Assistant module's script and whoever styles it. Plan: `documentation/plans/plan-assistant-module.md`. Reference rendering: `design/assistant.html`. This file moves to `src/CONTRACT.md` when the module is scaffolded.

**How it works.** The stylesheet styles elements by class and attribute; the script builds them from `<template>`s and toggles states, and never sets a style. Colours come only from the theme tokens. Text from people, and the model's own words, go in with `textContent`, never as HTML.

## What Assistant is

A normal bundled module (`panel: { dock, float }`, poppable into its own window like any other): a place to have an open-ended conversation with the AI the admin configured, with optional context. It keeps no data of its own; a kept card is saved by whichever module offers to (see "Saving a card").

## The pane

```
<div id="app" class="ask [narrow]">
  <header class="ask-head">           an icon, h1 "Assistant", #new-chat (clears the conversation)
  <div id="ask-context" class="ask-context">   "Use as context", #ask-chips, #add-context
  <div id="ask-picker" class="ask-picker" [hidden]>   #ask-picker-list, #picker-count, #picker-done
  <div id="thread" class="thread">    the conversation; #ask-empty shows until the first message
  <form id="ask-form" class="composer">  #ask-input, #ask-send
```

`.narrow` under 720px, set by the script from the pane's width, not the window's.

## Context

`#ask-chips` holds one `tpl-ask-chip` per item the answer may use (an icon, its title, a remove button). **Add context** opens `#ask-picker`: a checklist (`tpl-pick-row`, one per reachable item, grouped or not) with a live count and **Done**. With no chips, the model answers from its own knowledge; with some, it uses them too. Opening Assistant through the `askAssistant` action with items pre-fills the chips (see Conduits); the header's own open (from the room bar) starts with none.

## The conversation

`#thread` holds, in order: `tpl-msg-you` (your line), `tpl-msg-ai` (`.who`, then `.parts` holding `tpl-msg-text` pieces, `tpl-aicard`s, and `tpl-writing` while a card is still streaming). Nothing here is stored; closing or popping the pane, or **New conversation**, drops it.

## The card (`tpl-aicard`)

An icon badge, "Answer" with a permanent AI mark, a title, the content (the model's own Markdown, rendered with `tavern.util.markdown`; `[data-slot=content]` is a `div`, not a `p`, since rendered Markdown can hold headings and lists), tags, `[data-slot=basis-wrap]` (`[data-slot=basis]`, `data-basis=general|items|both`: "From general knowledge: check it before you rely on it", "From your notes", or both), an optional place and date, and `[data-slot=sources-wrap]` listing what it drew on as `.link` pills (`.gone` for one no longer reachable). `.actions` holds **keep** (bookmark; `.kept` once saved) and **copy the text**. The card is draggable, like any card, onto a plan or anywhere else that takes one. A card may carry a `kind` (an everyday word: a flight, a hotel, a sight...); nothing in the markup shows it yet (a kind-coloured badge is still to design).

## Saving a card

Keeping a card asks whichever module offers a matching action, found by name and input shape (as Places' `addPlace` is found today — never by naming a module): a card with a `kind` prefers a suggestion-shaped action (a `title` and a `kind`, giving it the card's title, kind, content, place and date), which places it as that proper sort of item; any other card, or when nothing offers one, falls back to a note-shaped action (a `title` and a `body`), giving it the card's title, tags and sources folded into readable text (the action bus carries no list of several pointers or tags of its own). If neither exists, the keep button is disabled and `tpl-state-nowhere-to-save` explains why (install a module that keeps notes).

## Not yet built (see `plan-smart-cards.md`)

**Send all to plan**: a bulk action under a reply with more than one card, calling whichever action each card's `keep` would (once per card, one confirm first), and a kind-coloured badge on a card that carries one.

## Conduits

- **Provides** `askAssistant({ items?: ref[], question?: string })`: opens Assistant (wherever it already is, docked if it has never been opened) with `items` as starting context, and sends `question` at once if given.
- **Consumes** `"*"`: anything with a card can be added as context or dropped onto Assistant to start a conversation about it.
- **Uses** `"*"`: to find a save action for a kept card.
- **Hooks:** `ai`.

## States

| State | What is drawn |
|---|---|
| Loading | `tpl-state-loading` |
| AI not available here (not enabled, the role may not, or the room turned it off) | `tpl-state-unavailable`, `[data-slot=why]` the server's reason; no composer |
| Nothing can save a kept card | `tpl-state-nowhere-to-save`, keep disabled |

## Not decided yet

Whether a conversation may be handed off between dock, float and popout without losing it (today it does not survive a mode change, the same as it would not survive closing); a history of past conversations (none is kept, by design).
