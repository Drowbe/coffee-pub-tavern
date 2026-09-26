# Chat

**Audience:** anyone in a space on a Collaborator server who types in Chat: to talk, to ask the AI, to add something to a module, or to bring in research from another AI.

Chat has one box, **Chat or type / for commands...**. Plain text is a message to the space. Text that starts with a command does something else: `/ai` asks the AI privately, and a module's command opens that module's add form. Opening Chat, formatting, pictures and history are covered in [The call](userguide-call.md), "Chat".

Who can use it: anyone allowed to send messages in the space (set per role on the Roles tab). Commands work only in a space, not in an aside.

## Commands

| Command | What it does | Needs |
| --- | --- | --- |
| `/ai` | Asks the AI; only you see the answer | See "Ask the AI" below |
| `/t` | Opens To-do's new task form | [To-do](userguide-todo.md) open |
| `/c` | Opens the Calendar's new event form | [Calendar](userguide-calendar.md) open |
| `/r` | Opens a new Research note, or a link when you type a web address | [Research](userguide-research.md) open |
| `/p` | Opens the Planner's form for the day you name, or the day in view | [Planner](userguide-planner.md) open |
| `/v` | Opens a new poll with your question | [Polls](userguide-polls.md) open |

A module's command opens the same form as its own add button, filled in from what you typed, and saves nothing until you choose **Save**. A date and a time in the text are picked out: `/t book flights by sep 25` makes the task "book flights", due Sep 25. The list comes from the modules on in the space, so a module installed later can add its own.

1. Type `/` on its own, or open the formatting menu (the icons button left of the box) and choose **Commands**.
2. Choose a command. It goes into the box, and the box shows a hint for what to type.
3. Type the rest and press Enter.

What to know:

- **The module must be open.** If it isn't, the text stays in the box and a line under it says so, for example "To-do isn't open". Open it from the space bar and press Enter again.
- **An unknown command** stays in the box with "No command /x". Nothing is sent to the space. Text that starts with `/` is never sent as a message.
- **Two modules with the same command** are both listed, each with its module's name. If both are open, the line under the box asks you to choose from the list.

## Ask the AI

Type `/ai` and your question, then press Enter. Your question and the answer appear in Chat marked **private**: nobody else in the space sees them. The conversation is saved for you in this space and is still there after a refresh or on another device. It keeps your last 200 entries, none older than 30 days.

Each answer has:

- **Copy**, which copies its text.
- **Share to the space**, which posts the answer as an ordinary message from you, headed "AI answer shared by <your name>".
- **Keep**, on each object the answer holds (a hotel, a sight, a note). An object that is plainly a flight, a hotel, a sight and so on is kept in the Planner as that kind; anything else goes to Research as a note. If that module isn't open, the button shows it is waiting and the object arrives when someone next opens it.

To ask about something you already have, drag it onto Chat while `/ai` is in the box; the line under the box says how many objects the question will use. Research's **Research this** does the same for one object.

Who can: anyone signed in, except guests, in a space where **Turn AI off in this space** is not ticked. If the Assistant module is installed, you also need its **Use the assistant** permission (Roles tab). The owner must have set up an AI service first; see [Assistant](userguide-assistant.md).

## Bring in research from another AI

You can research in another AI and bring what it finds into Magpie as objects. This uses none of the environment's AI.

1. Open the formatting menu and choose **Bring in research** (the file icon). It shows only to people who may bring research in, and only where something can keep it (the Planner, or a module that keeps notes such as Research).
2. Choose **Copy instructions for another AI**, paste them into the other AI, then ask your question.
3. Paste its whole answer into **Paste the whole answer here** and choose **Preview**, or choose **Choose a file** and pick its `.magpie-objects.json` file.
4. A preview marked **Brought in** lists each object with a tick. Untick any you don't want.
5. Choose **Keep ticked** and confirm.

Pasting an answer straight into the Chat box works too: when it holds objects, **Bring in N objects** appears beside Send and opens the same preview. The limits (50 objects at a time, 256 KB, the "External source" line) are in [Assistant](userguide-assistant.md), "Bring in research from another AI".
