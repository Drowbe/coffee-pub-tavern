# Calendar

**Audience:** a player or game master using the Calendar module on a Coffee Pub Tavern server, and an admin setting it up.

The Calendar keeps sessions and events. There is one for the whole server, and one for each room. An event can remind people before it starts. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. Upload `modules/dist/calendar-1.2.0.zip` on the Modules tab and choose **Approve and enable**. The Calendar asks to add two permissions to the Roles tab and to run reminders.
2. To use it in rooms, tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: Calendar**, choose who can **See the calendar** and who can **Add and change events**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.

## The server calendar

Choose **Calendar** in the header. You see a month with each day's events. Use the arrows and **Today** to move around, and **Month** and **List** to switch between the month grid and an upcoming list. On a narrow window it starts in the list.

## A room's calendar

In a call, choose the Modules button in the toolbar and then **Calendar**. It opens as a column beside the video and the chat: a month on top and that month's events listed beneath it. The header buttons switch it to a floating panel or open it in a window of its own. It shows that room's events, and the server's events beside them marked **server**. Server events are read-only in a room; change them on the server calendar.

## Add and change events

If you can edit, choose **Add event** (in the bar along the bottom of the Calendar; docked, it sits in the same row as the video toolbar and the chat box), or click a day in the month. Give it a title, a date, and a start and end time (or tick **All day**), and add details if you like. Choose **Save**. Click an event to change or delete it; the delete button asks you to click a second time. If two people change the same event at once, the second person is told and can reopen it to see the other change.

Events appear for everyone who has the calendar open as soon as they are saved.

## Repeating events

Set **Repeats** to every day, week, 2 weeks, month or year, and optionally an **Until** date. The whole series is one event: changing it changes every occurrence, and deleting it deletes them all. A monthly event stays on its day of the month, or the last day of a shorter month. Repeating events show a small repeat mark in the month and a tag in the list.

## Reminders

Set **Remind people** on an event to send a notification when it starts, 15 minutes before, an hour before, or a day before. Everyone in that room (or everyone on the server, for a server event) who is allowed to see the calendar gets a toast, and a number on the Calendar item and the Modules button until they open it. Changing an event moves its reminder, and deleting it cancels the reminder. An event with a reminder time that has already passed gets no reminder. A repeating event reminds people before every occurrence, including while nobody has the calendar open.

## Limits

An event belongs to one day; an end time later that day is fine, but events that run across midnight are not shown on more than one day. There is no way yet to skip one occurrence of a repeating event or change just that one. Times show in each person's own time zone.
