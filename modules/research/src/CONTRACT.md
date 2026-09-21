# Research: the markup and behaviour contract (draft)

**Audience:** whoever writes the Research module's script (the modules side) and whoever styles it (the interface side). The plan is `documentation/plans/plan-research.md`; the reference renderings are `design/pane.html` (`?state=normal|photos|empty|uploading|position|filtered`, `?theme=light`, `?w=390`) and `design/ask.html` (`?state=normal|streaming|kept`). This file moves to `src/CONTRACT.md` when the module is built.

**How it works.** The stylesheet styles elements by class and attribute; the script builds them from `<template>`s and toggles states, and never sets a style (the one exception is a tag's colour, `--tag`). Colours come only from the theme tokens. Text from people goes in with `textContent`.

## The pane

```
<div class="rs [narrow]">                     narrow under 720 px (the script sets it from the pane's width)
  <header class="rs-head">                    h1 "Research", .count, .views (Mine, This room: button.view[aria-pressed])
  <div class="rs-tools">                      .rs-search (input[type=search]), button.ai-btn "Ask" (hidden unless AI is available)
  <div class="rs-chips">                      kind chips: All, Notes, Links, Photos, Answers (.rs-chip.on)
  <div class="rs-chips">                      tag chips (.rs-chip.tag[style=--tag], .on)
  <main class="rs-body">                      .upload and .pos-ask when needed, then .rs-grid of .rcard, or .rs-empty
  <div class="rs-bar">                        the host's bottom bar is the quick add (see below)
```

Views are as in Places: **Mine** (the person scope, private across rooms) and **This room**; the choice is remembered and a guest has only This room. Filtering combines: search text, a kind, and one or more tags.

## A card (`article.rcard[data-kind=note|link|photo|answer][data-id]`)

`.top` holds `.kind` (the kind's icon in a round badge), `.kicker` ("Note", "Link", "Photo", "Answer", and for an answer a permanent `.ai-mark` "AI") and `button.menu` (the item menu). Then `h3` (the title), for a link `.site` (the site's name), `p.excerpt` (the body, clamped to four lines), `.tags` of `.tag[style=--tag]`, and `.meta` (the date, the place, an attachment count, and `.by` with the adder's initial). A photo also has `.thumb` first, an image cropped 4:3 across the card's top. The card is focusable and draggable (as any card: onto a plan's day, onto a task); Enter or a click opens it in the editor.

**The menu** (`⋯`): Open, Edit, Copy to "This room" / "Mine", Ask about this (only when AI is available), Remove. Removing a photo also removes its file.

## Quick add (the host's bottom bar)

One field, "Write a note, or paste a link", with a + button and a camera button (`iconOnly`). Text becomes a note (title from its first line); a pasted web address becomes a link card; the camera button opens the file chooser (on a phone, the camera or the library). Enter with nothing typed opens the note editor.

## Photos

- **Upload flow** (\`.upload\`): choose the file, "Preparing…" (the page resizes to about 2000 px and makes the thumbnail, converting a phone's HEIC), a progress bar while it uploads, then the card appears. Several files queue one row each.
- **A position in the file** (\`.pos-ask\`): the server drops it by default; when the reply says the photo had one, the row asks "This photo has a position (near X). Photos are shared without it unless you keep it." with **Keep it** and **Leave it out**. Keeping re-uploads with the position and removes the first copy.
- A photo with a position shows on the map and one with a date on its day, through its card's \`place\` and \`when\`.

## The editor (a dialog)

A note: title, body, tags (a field that suggests the tags already used), an optional place (paste coordinates or a map link, as Places) and date. A link: the address, a title, the excerpt (what to remember from the page), tags. A photo: the caption, tags, whether to keep the position. All show who added it and when. A person may edit and remove their own; in This room, anyone with the edit right may edit, and only the adder or an admin removes a photo.

## Tags

Plain words, typed freely, one word each. A list of well-known tags with a colour is kept in Module Configuration (the list control); a tag that is on the list wears its colour (\`--tag\`), any other is grey. The tag chips under the kind chips list the tags in use.

## Ask (the AI)

See `design/ask.html` and the plan. `button.ai-btn` opens the Ask panel over the pane (a dialog on a phone) with the selected items (or all the visible ones) as its context. The conversation is not saved. A card the model writes appears inline as `.aicard` with a bookmark (keep) and a copy button, and can be dragged; keeping creates an `answer` item in the current view.

## States

| State | What is drawn |
|---|---|
| Loading | a skeleton grid |
| Nothing yet | `.rs-empty`: an icon, "Nothing here yet", one sentence, and **Write a note** and **Add a photo** |
| A filter matches nothing | "Nothing matches", with **Show everything** |
| An upload failed | the `.upload` row turns to an error line with **Try again** |
| AI unavailable | no Ask button; a tooltip on nothing (there is no dead button) |

## Not decided yet

Sorting (newest first is the default), a compact list instead of the grid, several photos sharing one card, and comments on a card.

## Templates and hooks (as built in `research.html`)

The script clones these and fills them by hook only: `[data-slot=x]` (its text, or hidden when empty; `[data-slot=x-wrap]` hides when the slot inside it is empty), `[data-icon=name]` (an icon).

- `tpl-card` (`article.rcard`, the script sets `data-kind`, `data-id`): slots `thumb` (an `img`, its `src`), `kind`, `ai` (shown for an answer), `title`, `site`, `excerpt`, `tags` (holds `tpl-tag` clones, each with `--tag`), `when`, `place`, `by`; `button[data-action=menu]`.
- `tpl-conflict` (as in Places: `text`, `use-theirs`, `keep-mine`), `tpl-source` (a pill for an answer's source; `.gone` when it is no longer there).
- `tpl-chip-tag` (a tag chip in `#tag-chips`, `--tag`, `.on`), `tpl-tag`.
- `tpl-upload` (`.upload`: `name`, `progress`, `step`, `[data-action=retry-upload]`), `tpl-pos-ask` (`text`, `[data-action=keep-position]`, `[data-action=drop-position]`).
- The dialog is one form, `#form.editor-card[data-kind=note|link|photo|answer]`; each row lists the kinds that show it in `data-kinds`, and the stylesheet hides the rest. Fields: `f-title`, `f-caption` (a photo), `f-url`, `f-body`, `f-excerpt`, `f-tags` (with `#tag-list`), `f-point` and `f-date`, `#f-asked` (an answer: `asked`, `sources`), `f-by`, `f-error`, `f-save`, `f-cancel`, `f-delete`.
- `#item-menu`: `edit`, `copy-to` (its label reads "Copy to This room" or "Copy to Mine"), `ask-about` (hidden unless AI is available), `delete`.
- Ask: `#ask.ask-panel > .ask` with `#thread`, `#ask-form`, `#ask-input`, `#ask-send`, `[data-action=close-ask]`; clones `tpl-msg-you`, `tpl-msg-ai` (`who`, and `.parts` for `tpl-msg-text`, `tpl-aicard` and `tpl-writing` in order), `tpl-aicard` (`title`, `content`, `tags`, `place`, `when`, `sources`; `[data-action=keep-card]`, `[data-action=copy-card]`; the icon badge holds the card's icon).
- States: `tpl-state-loading`, `tpl-state-empty` (`[data-action=new-note]`, `[data-action=add-photo]`), `tpl-state-noresults` (`[data-action=clear-filter]`).

## Suggest tags, dropping onto Research, a missing photo (0.1.5)

- **Suggest tags:** `button[data-action=suggest-tags]` beside the tags field (`.with-button`), hidden unless AI is available and the item is a saved note, link or answer. It puts suggested words into `#f-tags`; nothing is saved until Save.
- **Drop onto the pane:** while something from another module is dragged over Research, `.rs.drop-target` draws a dashed accent frame round the pane and `#drop-hint` ("Drop to start a note about it") appears above the bottom bar; dropping starts a note linked to the item, with its title.
- **A photo whose file is gone:** the script sets `.missing` on `.thumb` when the picture fails to load; it shows a quiet hatched placeholder.

## Where a card is used (backlinks, 0.1.7)

`.backlinks[data-slot=backlinks]` sits at the foot of a card, above the meta line, hidden when nothing links to it (room view only; Mine is never linked). It holds one `tpl-backlink` pill per **group** of linkers, grouped by the linker's kind name: the linker module's icon (`[data-slot=icon-holder]`) and a label (`[data-slot=label]`): with one linker its kind and title ("Task: book the hotel"), with several "2 plans". The pill's `title` lists the linkers, and a click opens the linker (the only one, or the first). When there are more groups than fit, a `tpl-backlink-more` pill ("+2") ends the row. Reference: `design/pane.html` (the first card).
