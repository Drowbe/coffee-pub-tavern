# Polls

**Audience:** a player or game master using the Polls module on a Coffee Pub Tavern server, and an admin setting it up.

Polls lets a group decide something together: where to go on a trip, where to stay, what to do on Saturday. There is one set of polls for the whole server and one for each room. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Polls under **Available with this Tavern**, then **Approve and enable** (when a newer version comes with a server update, choose **Update** on its card instead; see [Modules](userguide-modules.md)). It asks to add three permissions to the Roles tab and to send notifications.
2. To use it in rooms, tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: Polls**, choose who can **See polls and their results**, **Vote in polls** and **Start, close and delete polls**. By default users and moderators can do all three, and guests can only see. Guests cannot vote, because every guest shares one identity and their votes would overwrite each other.

The permission to start polls is enforced by the Polls page itself, not by the server, so it is a guard against a mistake rather than against someone determined. See and vote are enforced by the server.

## Start a poll

Choose **New poll**. Give the question and at least two options; each option can carry a short detail, such as a price, a place or a date. Then choose:

- **Allow more than one choice** for a poll where people pick every option they like.
- **Let people add options**, so anyone who can vote can suggest another option while the poll is open. Good for "where should we go?".
- **Closes**, to have the poll close itself at a set time.
- **Tell people about it**, to send everyone who can see the poll a notification.

## Vote

Choose an option to vote for it. In a one-choice poll, choosing another option moves your vote, and choosing the same one again takes it back. In a many-choice poll each option is a switch. Results update live for everyone, with a bar and a count for each option and the names of the people who voted for it, so votes are not secret.

## Link a poll to a task

Drag a poll's question onto a task in the To-do module to link the task to the poll, for example a task to book whatever wins. Clicking the link on the task opens the poll here, and a poll lists what is linked to it under its details, where clicking one opens it. See [To-do](userguide-todo.md).

## Give an option a date

An option can have a date, chosen with the calendar button beside it when you start the poll: "First weekend, Oct 3". The date shows under the option. When the poll closes and one option wins, its date goes out with the result, so something that follows the poll can use it, for example a task that puts the winning date on the Calendar (see [To-do](userguide-todo.md)).

## Link an option to something

Drag an item from another module (an event on the Calendar, say) onto an option to link the option to it. The option shows the item, and clicking it opens the item. You can remove the link with the cross while the poll is open. Only the person who started the poll, or an admin, can link options. When the poll closes and one option wins, the item that option points at goes out with the result, so a task that follows the poll can link to it or use it. A poll that ties, or whose winner has no link, sends only the result line.

## After a poll closes

Closing a poll (or its closing time passing) tells the other modules that were set up to listen, with a one-line result such as "Where to stay: Hotel Nova" (or who tied, or that nobody voted), so a task that follows the poll can tick itself off and keep the result in its notes. A closed poll also offers a button for each thing another module can do with it, such as **Add a task** from the To-do module, which creates a task named for the poll and its winner, linked to the poll. These buttons come from whatever modules you have installed; there is nothing to set up in Polls.

## Close it

The person who started a poll, and an admin, can **Close** it, and **Reopen** it later. A closed poll no longer takes votes and marks its winner, or **Tied** if several options share the top count. **Delete** removes the poll and all its votes; it asks you to press it twice.

In a room, three icons in the Polls' titlebar, before the pane's own buttons and set off by a pipe, choose what the list shows: the empty circle for open polls (its tooltip says how many), the lock for closed ones, and the list icon for all. On the server page, which has no titlebar to put them in, they stay as buttons at the top of the page.

## Where it shows

Choose **Polls** in the header for the server's polls. Under the toolbar it also shows, read-only, the polls of every room you belong to that has Polls on, each headed by its room's icon, with a row of your rooms to show or hide each. To vote in a room's poll, open that room's Polls from a call: choose the Modules button in the header, then **Polls**. It opens as a column beside the conference and the chat, as a floating panel, or in a window of its own.
