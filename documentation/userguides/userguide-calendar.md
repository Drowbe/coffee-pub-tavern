# Calendar

**Audience:** a player or game master using the Calendar module on a Coffee Pub Tavern server, and an admin setting it up.

The Calendar keeps sessions and events. There is one for the whole server, and one for each room. An event can remind people before it starts. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Calendar under **Available with this Tavern**, then **Approve and enable** (when a newer version comes with a server update, choose **Update** on its card instead; see [Modules](userguide-modules.md)). The Calendar asks to add two permissions to the Roles tab and to run reminders.
2. To use it in rooms, tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: Calendar**, choose who can **See the calendar** and who can **Add and change events**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.

## The server calendar

Choose **Calendar** in the header. You see a month with each day's events. Use the arrows and **Today** to move around, and **Month** and **List** to switch between the month grid and an upcoming list. On a narrow window it starts in the list.

The server calendar also shows, read-only, the events of every room you belong to that has the Calendar on. Each shows its room's icon (the room's launch-link icon, or the message icon if it has none) before the time and title, and in the list beside the room's name. A row of your rooms under the toolbar shows or hides each room. To change a room's event, open that room's Calendar from a call.

## A room's calendar

In a call, choose the Modules button in the header and then **Calendar**. It opens as a column beside the video and the chat: a month on top and that month's events listed beneath it. The header buttons switch it to a floating panel or open it in a window of its own. It shows that room's events, and the server's events beside them marked **server**. Server events are read-only in a room; change them on the server calendar.

## Add and change events

At the bottom of the Calendar is a quick-add field with a **+** button. Type what the event is and press Enter or click **+**, and the New event form opens filled in: "meet with bob sep 29 at 7pm" gives the title "meet with bob", the day Sep 29 and the time 7:00 PM. Days can be typed as "tomorrow", "fri", "next mon", "sep 29", "29 sep" or "9/29"; times as "7pm", "7:30pm", "19:00" or "at 7". Whatever it does not understand stays in the title, and you can change anything before saving. Clicking **+** with nothing typed opens a blank form.

If you can edit, choose **Add event** (in the bar along the bottom of the Calendar; docked, it sits in the same row as the video toolbar and the chat box), or click a day in the month. Give it a title, a date, and a start and end time (or tick **All day**), and add details if you like. Choose **Save**. Click an event to change or delete it; the delete button asks you to click a second time. If two people change the same event at once, the second person is told and can reopen it to see the other change.

Events appear for everyone who has the calendar open as soon as they are saved.

## Picking a date

Each date field (start, end and the last day of a repeat) has a calendar button beside it. The same picker is on the To-do's due date and on a poll's closing time. It opens a small month, with the days of the week across the top, so you can see what day a date falls on; choose a day to fill the field, or use the arrows to change month, **Today**, or **Clear** on the optional fields. Typing the date still works, and the day of the week it lands on appears under the field either way. When you are choosing an end date the days between the start and the end are shaded.

## Events that last more than a day

Give an event an **Ends** date, and a time if it is not all day, to make it run over several days: a trip, a convention, a night train. An all-day event's end date is its last day. The event shows on every day it covers in the month, with its time on the first day and an arrow on the days after, and the list shows its whole span, such as "Sep 22 - Sep 25". Leave **Ends** empty for an event on one day, and for a timed event you can give just an end time. A repeating event keeps its length in every repeat. Reminders still go out before the start.

## Linking an event elsewhere

An event can be dragged onto a task in the To-do module, or onto an open task there, to link the task to it. The task then shows the event's name and date, and clicking that link opens the event here. When you open an event that tasks (or anything else) link to, it lists them under **Linked from**, and clicking one opens it. See [To-do](userguide-todo.md).

## Dropping something on the calendar

Drag an item from another module (a task, say) onto a day or an event. If there is one thing to do with it, it happens; if there are several, a small menu asks which. On a day you can add the item to the calendar as an event on that day, or, for a task, set the task's due date to that day. On an event you can link the task to the event, or set the task's due date to the event's date. The choice you made last time for that kind of item and place is listed first, marked "last used", so a repeat drop is one click. The choices come from what the other modules can do with the item, so a module added later can add more. A short note confirms what was done.

## When an event has passed

Once an event is over, the Calendar tells the modules that follow it, once, with a line such as "Trip day one, Sep 19". A task linked to the event can then tick itself and keep that line in its notes, if you chose that for the link (see [To-do](userguide-todo.md)). It is announced by whoever has the Calendar open first after the event ends, so it waits for someone to open it if nobody has. Repeating events are not announced, and neither is one that ended more than a week ago. Changing an event's date makes it announce again when the new date passes.

## Repeating events

Set **Repeats** to every day, week, 2 weeks, month or year, and optionally an **Until** date. The whole series is one event: changing it changes every occurrence, and deleting it deletes them all. A monthly event stays on its day of the month, or the last day of a shorter month. Repeating events show a small repeat mark in the month and a tag in the list.

## Reminders

Set **Remind people** on an event to send a notification when it starts, 15 minutes before, an hour before, or a day before. Everyone in that room (or everyone on the server, for a server event) who is allowed to see the calendar gets a toast, and a number on the Calendar item and the Modules button until they open it. Changing an event moves its reminder, and deleting it cancels the reminder. An event with a reminder time that has already passed gets no reminder. A repeating event reminds people before every occurrence, including while nobody has the calendar open.

## Limits

An event belongs to one day; an end time later that day is fine, but events that run across midnight are not shown on more than one day. There is no way yet to skip one occurrence of a repeating event or change just that one. Times show in each person's own time zone.
