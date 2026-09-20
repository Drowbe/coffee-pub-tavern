# To-do

**Audience:** a player or game master using the To-do module on a Coffee Pub Tavern server, and an admin setting it up.

The To-do module keeps a shared task list. There is one for the whole server and one for each room. A task can have notes, a due date and a reminder. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside To-do under **Available with this Tavern**, then **Approve and enable** (when a newer version comes with a server update, choose **Update** on its card instead; see [Modules](userguide-modules.md)). It asks to add two permissions to the Roles tab and to run reminders.
2. To use it in rooms, tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: To-do**, choose who can **See the to-do list** and who can **Add, change and tick off tasks**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.

## The server list

Choose **To-do** in the header. Type a task in the box at the top and press Enter to add it, or choose **Add task** to add notes and a due date as well.

- Tick the box to mark a task done. **Open**, **Done** and **All** choose what the list shows. Open tasks are ordered by due date, with undated ones after, and done tasks are listed newest first.
- Click a task's name to change it, or delete it. A due date shows beside the task: Today and Tomorrow in the accent color, and a date in the past in red.
- Under the toolbar the server list also shows, read-only, the lists of every room you belong to that has To-do on. Each is headed by its room's icon and name, and a row of your rooms shows or hides each one. To tick off or change a room's task, open that room's list.

## Open, Done and All

In a room, three icons in the To-do's titlebar, before the pane's own buttons and set off by a pipe, choose what the list shows: the empty circle for the tasks still open (its tooltip says how many), the ticked circle for done tasks, and the list icon for all of them. On the server page, which has no titlebar to put them in, they stay as buttons at the top of the page.

## Link a task to an event or a poll

A task can point at a Calendar event or a poll, so the task shows what it is for: "Book flights" next to the retreat's dates, or next to the poll that is deciding where to go. Open a task, then in **Linked** type in the box to search your events and polls and choose one, or drag an event from the Calendar (or a poll's question from Polls) onto a task, or onto the open editor. The link shows on the task with the item's name and date, and the item is looked up each time, so it stays current. Click a link to open the item where it lives: its module opens beside the To-do (or its page) and shows the event or poll. The item shows the link back too: an event, or a poll, lists the tasks linked to it. If the item has been deleted, or you cannot see it, the link reads "Not available". A link works with whatever a module shares, including modules added to your server later. A task can have up to five links.

An admin approves the To-do's links when enabling it, and they show only what you can already see in the Calendar and Polls.

## In a room

In a call, choose the Modules button in the header and then **To-do**. It opens as a column beside the conference and the chat, as a floating panel, or in a window of its own, from the buttons on its titlebar. It shows that room's list; the server list is on the server page.

## Reminders

Set **Remind people at 9:00 that day** on a task with a due date to send a notification at 9:00 on that day. Everyone in that room (or everyone on the server, for a server task) who is allowed to see the list gets a toast, and a number on the To-do item and the Modules button until they open it. Ticking a task done, changing its date or deleting it cancels the reminder. A due date whose 9:00 has already passed sends no reminder.
