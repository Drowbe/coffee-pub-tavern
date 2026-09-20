# Polls

**Audience:** a player or game master using the Polls module on a Coffee Pub Tavern server, and an admin setting it up.

Polls lets a group decide something together: where to go on a trip, where to stay, what to do on Saturday. There is one set of polls for the whole server and one for each room. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. Upload `modules/dist/polls-1.1.0.zip` on the Modules tab and choose **Approve and enable**. It asks to add three permissions to the Roles tab and to send notifications.
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

Drag a poll's question onto a task in the To-do module to link the task to the poll, for example a task to book whatever wins. See [To-do](userguide-todo.md).

## Close it

The person who started a poll, and an admin, can **Close** it, and **Reopen** it later. A closed poll no longer takes votes and marks its winner, or **Tied** if several options share the top count. **Delete** removes the poll and all its votes; it asks you to press it twice.

**Open**, **Closed** and **All** choose what the list shows.

## Where it shows

Choose **Polls** in the header for the server's polls. Under the toolbar it also shows, read-only, the polls of every room you belong to that has Polls on, each headed by its room's icon, with a row of your rooms to show or hide each. To vote in a room's poll, open that room's Polls from a call: choose the Modules button in the header, then **Polls**. It opens as a column beside the conference and the chat, as a floating panel, or in a window of its own.
