# Research

**Audience:** a player or game master keeping notes, links and photos with the Research module on a Coffee Pub Magpie server, and an owner setting it up.

The Research module keeps what a group finds out while it plans: a note, a link with the part that mattered, a photo with a caption. Each one is a card you can tag, search, link from other modules (drag it onto a day of a plan) and, when it has a place or a date, show on the map or on its day. It is not only for travel: a house purchase or a project has the same shape. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Research, then **Approve and enable**. It asks to link to other modules' items and to use the AI hook.
2. Tick **Available in every room**, or tick it per room.
3. On the Roles tab, under **Module: Research**, choose who can **See research**, who can **Add, change and remove research**, and who can **Remove photos other people added** to a space. By default everyone can see it, members and moderators can edit, guests can see but not edit, and only owners can remove another person's photo. Version 0.2.10 adds that last permission, so updating to it waits for an owner's approval once.
4. **Well-known tags (optional).** Under Research's settings (**Module Configuration**), add tags with a colour each. A tag on the list wears its colour on every card; any other tag stays plain.
5. **Suggest tags (optional).** In the dialog, this button asks the AI for tags; it appears only when the AI is set up on the Modules tab and the Roles tab lets the person use it ("Use AI in modules", off for everyone until you turn it on; a guest never can). See [Modules](userguide-modules.md). To have a whole conversation with the AI, with research as context, install the **Assistant** module (see [Assistant](userguide-assistant.md)).

## Add things

- Type in the field at the bottom and press Enter or the plus button. A web address becomes a link card; anything else starts a note with what you typed as its title. Press the plus with nothing typed for a blank note.
- The camera button adds photos: on a phone it offers the camera or the photo library. Several photos queue one row each. The page shrinks each picture to about 2000 pixels and makes a small thumbnail before it uploads, so large phone photos are fine.
- **A photo's position.** If a photo carries the place it was taken, Research asks whether to keep it. It is left out unless you choose **Keep it**, so a shared photo cannot give away a home address by accident. A photo taken on a known day shows on that day.
- In the dialog, give the item a title, add tags (words separated by commas; the ones already used are suggested), and for a note or a link an optional place (coordinates or a map link) and date.

## Mine and this room

**Mine** is your own research: only you see it, and it follows you into every room. **This room** is what the room shares. Beside that switch, **Cards** or **List**: cards pack together like masonry (a short card never leaves a hole under it, and the columns follow the pane's width), a list is one line per item. Your choice is remembered. An item's menu has **Copy to This room** or **Copy to Mine**, which copies it and leaves the original where it is (photos stay where they were added). Guests have only the room's.

## Find things

The search box matches the title, the text, the site and the tags. The row under it filters by kind (notes, links, photos, answers). Tags are chosen from the **Tags** button in the toolbar: it lists every tag in use with how many items carry it; pick one and it appears beside the kinds as a filter, with an x to drop it. Pick several to narrow further (an item must carry all of them), and **Clear tags** at the top of the menu drops them all.

## Research this

A card's menu has **Research this**, which opens the Assistant module (if it is installed) with that item as context, ready to ask about it; see [Assistant](userguide-assistant.md). A card the AI writes worth keeping is saved back here as an ordinary note. An item saved before this changed may still show as an **Answer**, with the question that made it; nothing new is saved that way now.

## For module authors

Research provides two actions (see [the SDK guide](api-module-sdk.md)): `saveNote` (`title`, optional `body`, `tags` and `ref`) and `saveLink` (`url`, optional `title`, `excerpt` and `ref`), so any module can offer "Save to research" on something without knowing Research is there. Its items are pointers of kind `note`, `link`, `photo` and `answer`, and their cards carry the item's words as `text`.
