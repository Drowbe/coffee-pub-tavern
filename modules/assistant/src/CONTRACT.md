# Assistant: the markup and behaviour contract (draft)

**Audience:** whoever writes the Assistant module's script and whoever styles it. Plan: `documentation/plans/plan-assistant-module.md`. Reference rendering: `design/assistant.html`. This file moves to `src/CONTRACT.md` when the module is scaffolded.

**How it works.** The stylesheet styles elements by class and attribute; the script builds them from `<template>`s and toggles states, and never sets a style. Colours come only from the theme tokens. Text from people, and the model's own words, go in with `textContent`, never as HTML.

## What Assistant is

A normal bundled module (`panel: { dock, float }`, poppable into its own window like any other): a place to have an open-ended conversation with the AI the admin configured, with optional context. It keeps no data of its own; a kept card is saved by whichever module offers to (see "Saving a card").

## The pane

```
<div id="app" class="ask [narrow]">
  <header class="ask-head">           #new-chat (clears the conversation) -- a titlebar icon wherever there is one; this is the fallback for the module's own page when it isn't popped out
  <div id="ask-context" class="ask-context">   "Use as context", #ask-chips, #add-context
  <div id="ask-picker" class="ask-picker" [hidden]>   #ask-picker-list, #picker-count, #picker-done
  <div id="thread" class="thread">    the conversation; #ask-empty shows until the first message
  <form id="ask-form" class="composer">  #ask-input, #ask-send
```

`.narrow` under 720px, set by the script from the pane's width, not the window's.

## Context

`#ask-chips` holds one `tpl-ask-chip` per object the answer may use (an icon, its title, a remove button). **Add context** opens `#ask-picker`: a checklist (`tpl-pick-row`, one per reachable object, grouped or not) with a live count and **Done**. With no chips, the model answers from its own knowledge; with some, it uses them too. Opening Assistant through the `askAssistant` action with items pre-fills the chips (see Conduits); the header's own open (from the space's bar) starts with none.

## The conversation

`#thread` holds, in order: `tpl-msg-you` (your line), `tpl-msg-ai` (`.who`, then `.parts` holding `tpl-msg-text` pieces, `tpl-aicard`s, and `tpl-writing` while a card is still streaming). Nothing here is stored; closing or popping the pane, or **New conversation**, drops it.

## The card (`tpl-aicard`)

An icon badge, "Answer" with a permanent AI mark, a title, the content (the model's own Markdown, rendered with `host.util.markdown`; `[data-slot=content]` is a `div`, not a `p`, since rendered Markdown can hold headings and lists), tags, `[data-slot=basis-wrap]` (`[data-slot=basis]`, `data-basis=general|items|both`: "From general knowledge: check it before you rely on it", "From your notes", or both), an optional place and date, and `[data-slot=sources-wrap]` listing what it drew on as `.link` pills (`.gone` for one no longer reachable). `.actions` holds **keep** (bookmark; `.kept` once saved) and **copy the text**. The card is draggable, like any card, onto a plan or anywhere else that takes one. A card may carry a `kind` (an everyday word: a flight, a hotel, a sight...), set as `data-kind` on `.aicard` (`el.dataset.kind`); it is turned to that word's own hue, the same ones Planner's own type tiles use (`.aicard[data-kind=flight|train|ferry|bus|car|hotel|restaurant|cafe|bar|sight|museum|tour|show]`), so the same word reads as the same colour everywhere. No `kind`, or one not on that list, keeps the plain accent-turned default.

## Saving a card

Keeping a card asks whichever module offers a matching action, found by name and input shape (as Places' `addPlace` is found today — never by naming a module): a card with a `kind` prefers a suggestion-shaped action (a `title` and a `kind`, giving it the card's title, kind, content, place and date), which places it as that proper sort of item; any other card, or when nothing offers one, falls back to a note-shaped action (a `title` and a `body`), giving it the card's title, tags and sources folded into readable text (the action bus carries no list of several pointers or tags of its own). If neither exists, the keep button is disabled and `tpl-state-nowhere-to-save` explains why (install a module that keeps notes).

## Send all to plan (see `plan-smart-cards.md`)

`tpl-send-all` (`div.send-all`, `button[data-action=send-all]`, `[data-slot=count]`) sits under a reply's `.parts` when it has more than one card and something could keep at least one of them, with a count ("3 in all"). Clicking it confirms once, naming what is about to go out grouped by kind ("2 hotels, 1 sight, 1 note": a card with a `kind` nothing here recognises, or no `kind` at all, counts as a note), then keeps each not-already-`.kept` card in order, the same way that card's own **keep** button would (a card already kept, from a person clicking it by hand first, is skipped). `.send-all button[disabled]` is styled for while it runs. The button stays after every card is kept (clicking it again is a harmless no-op); it is not removed live as individual cards are kept by hand.

## Conduits

- **Provides** `askAssistant({ ref?: ref, question?: string })`: opens Assistant (wherever it already is, docked if it has never been opened) with the object `ref` points at as starting context, and sends `question` at once if given.
- **Consumes** `"*"`: any object with a summary can be added as context, or dropped onto Assistant: the shared drop menu (`host.objects.dropMenu`, see `api-module-sdk.md`, "Dragging") offers **Use it as context** and **Ask about it** (Assistant's own), then whatever the modules around offer for an item of that kind. Assistant's own answer cards drag out as cards, not pointers (nothing here is stored): the module they land on makes of them what takes a title, a kind, text, a place or a date.
- **Uses** `"*"`: to find a save action for a kept card.
- **Hooks:** `ai`.

## States

| State | What is drawn |
|---|---|
| Loading | `tpl-state-loading` |
| AI not available here (not enabled, the role may not, or the space turned it off) | `tpl-state-unavailable`, `[data-slot=why]` the server's reason; no composer |
| Nothing can save a kept card | `tpl-state-nowhere-to-save`, keep disabled |

## Surviving a mode change

Switching between docked and floating (the pane's own buttons, not popping into a window) does not touch the page: the host moves the frame in place rather than tearing it down and starting the module over, so the conversation, its context chips and anything mid-flight survive exactly as if nothing happened. Popping into its own window is a real new page, so that still starts the module over, the same as closing the pane or **New conversation** — a conversation is not carried into a window, and a history of past conversations is not kept, by design.

## Not decided yet

Whether a conversation could be handed off into a popped-out window too (it would mean serialising and replaying it there, not just moving a frame).
