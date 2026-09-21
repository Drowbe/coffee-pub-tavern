# Research

**Audience:** a player or game master keeping notes, links and photos with the Research module on a Coffee Pub Tavern server, and an admin setting it up.

The Research module keeps what a group finds out while it plans: a note, a link with the part that mattered, a photo with a caption. Each one is a card you can tag, search, link from other modules (drag it onto a day of a plan) and, when it has a place or a date, show on the map or on its day. It is not only for travel: a house purchase or a project has the same shape. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Research, then **Approve and enable**. It asks to link to other modules' items and to use the AI hook.
2. Tick **Available in every room**, or tick it per room.
3. On the Roles tab, under **Module: Research**, choose who can **See research** and who can **Add, change and remove research**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.
4. **Well-known tags (optional).** Under Research's settings (**Module Configuration**), add tags with a colour each. A tag on the list wears its colour on every card; any other tag stays plain.
5. **The AI (optional).** Research's **Ask** button appears only when the AI is set up on the Modules tab and the Roles tab lets the person use it ("Use AI in modules", off for everyone until you turn it on; a guest never can). See [Modules](userguide-modules.md).

## Add things

- Type in the field at the bottom and press Enter or the plus button. A web address becomes a link card; anything else starts a note with what you typed as its title. Press the plus with nothing typed for a blank note.
- The camera button adds photos: on a phone it offers the camera or the photo library. Several photos queue one row each. The page shrinks each picture to about 2000 pixels and makes a small thumbnail before it uploads, so large phone photos are fine.
- **A photo's position.** If a photo carries the place it was taken, Research asks whether to keep it. It is left out unless you choose **Keep it**, so a shared photo cannot give away a home address by accident. A photo taken on a known day shows on that day.
- In the dialog, give the item a title, add tags (words separated by commas; the ones already used are suggested), and for a note or a link an optional place (coordinates or a map link) and date.

## Mine and this room

**Mine** is your own research: only you see it, and it follows you into every room. **This room** is what the room shares. An item's menu has **Copy to This room** or **Copy to Mine**, which copies it and leaves the original where it is (photos stay where they were added). Guests have only the room's.

## Find things

The search box matches the title, the text, the site and the tags. The chips filter by kind (notes, links, photos, answers) and by tag; pick several tags to narrow further.

## Ask the AI

**Ask** opens a panel over the notes and links you can see (or over one item, from its menu's **Ask about this**). Only what you selected is sent to the AI, and nothing of the conversation is kept. When the AI writes something worth keeping, it appears as a card inside its answer; the bookmark keeps it in Research as an **answer** (always marked AI, with the question and what it drew on), and you can drag it onto a plan like any card. The AI never changes anything itself.

## For module authors

Research provides two actions (see [the SDK guide](api-module-sdk.md)): `saveNote` (`title`, optional `body` and `ref`) and `saveLink` (`url`, optional `title`, `excerpt` and `ref`), so any module can offer "Save to research" on something without knowing Research is there. Its items are pointers of kind `note`, `link`, `photo` and `answer`, and their cards carry the item's words as `text`.
