# Planner

**Audience:** a player or game master planning a trip with the Planner module on a Coffee Pub Tavern server, and an admin setting it up.

The Planner module plans one trip for a room, day by day. The room's Calendar events, to-dos and polls that fall on the trip's days join the plan, and the module adds what a trip needs on top: stops, stays, journeys and notes. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Planner under **Available with this Tavern**, then **Approve and enable**. It asks to add two permissions to the Roles tab, to link to other modules' items and to ask other modules to do things.
2. Tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: Planner**, choose who can **See the trip** and who can **Plan the trip**. By default everyone can see it, users and moderators can plan, and guests can see but not plan.

## Start a trip

Open the Planner pane in a room. With no trip yet it offers **Start planning**: give the trip a name, where it is, and its first and last day. The days appear as one list from top to bottom, however long the trip, with a strip of days at the top to jump to one and each day's heading staying in view as you scroll. **Edit trip** changes the name or the dates.

## Add to a day

- Type in the field at the bottom of the pane (with the plus button) and press Enter to add a stop to the day in view: "lunch at the pier at 1pm" adds "lunch at the pier" at 13:00, and a day of the trip in what you type ("museum oct 3 at 2pm") puts it on that day instead. Press the plus with nothing typed for the full form. When the pane has no bottom bar, each day has its own add row.
- In the form, first choose what it is, from the tiles: for getting there, a **flight**, **train**, **ferry**, **bus** or **car**; a **stay**; for eating and drinking, a **restaurant**, **café** or **bar**; for seeing and doing, a **sight**, **museum**, **tour** or **show**; or a **note**. The fields you need then appear: a flight has its airline, number, airport codes, terminal, gate, seat and class; a train its operator, number, platform, coach and seat; a stay its address, room, guests and check-out day; a meal its party size and the name it is booked under; a sight, museum, tour or show its number of tickets (and a show its entry). Every kind takes a day, a time and a length where they make sense, a booking reference, a cost and who paid, notes and the people it belongs to. Each kind has its own card in the day, in its own colour, so you can tell a flight from a dinner at a glance.
- **Getting to a stop.** Under **Getting to this stop**, choose how you get there (walk, drive, transit, bike or taxi) and how many minutes it takes from the stop before. A line between the two cards then shows the mode and the time, and the day's heading adds up the time spent getting around.
- **Ideas** (a column after the last day) holds things with no day yet. Choose **Back to ideas** in an item's menu, or add to it directly.

Items with no time come first in a day, in the order you put them; items with a time follow, by time. An item from another module takes the time that item has (a Calendar event's start), so it sorts among the timed ones. Between two timed items a small line shows the gap, such as "45 min".

## Move things

- On a computer, drag an item by the line beside its card to another place in its day or to another day.
- Anywhere, including a phone, open the item's menu (the three dots): **Edit**, **Earlier**, **Later** (an item with no time swaps places with its neighbour; an item with a time moves half an hour), **Move to** another day, **Back to ideas**, and **Delete**.

## What other modules bring

- Something from the Calendar, To-do or Polls that is dated on a trip day appears under that day as a suggestion, with an **Add** button that puts it on the plan. An added item shows where it comes from and has an **Open** button that takes you to it. It is read only here: change it where it lives.
- Drag an item from another module onto a day to put it on that day.
- Another module can ask Planner to add something: a closed poll's winner can go onto the plan as a stop.
- Items other modules link to a stop show under it.

## Bookings

The **Bookings** view lists the stays and journeys in date order, each with its dates, where, how many nights and its booking reference, and an **Open** button to edit it: everything you need at the front desk or the airport, in one place.

## Money

Give a stop, stay or journey a **Cost** and who **Paid by**. The people ticked under **Whose is it** share it; when nobody is ticked, everyone in the room does. Set the trip's **Currency** (three letters, such as EUR) when you edit the trip. The **Money** view shows the total, what each person paid and their share, who is owed and who owes, and the fewest payments that settle everything ("Bob pays Ann 175.00"), then the list of costs. Odd cents are handed out, so nothing is lost.

## Following a poll

An item from another module that reports how it turned out (a poll that closes) can be followed: in its menu choose **Follow its result**. When it closes, the result appears on the item, and if the result has a day (a poll whose options are dates) a stop with the result is added on that day; if it has an item it chose, that item joins the plan.

## Linking a task to a stop

Drag a stop, or any item, out of Planner by pressing its body (not its grip) and moving: drop it on a task in the To-do to link the task to it, and the stop shows the task under it. In the other direction, drop something from another module on an item and choose from what can be done with it, or drop it on a day to put it there.

## Decisions

The **Decisions** view lists what is linked to the trip and still open, grouped by the kind of thing it is, each with an **Open** button.

## When two people edit at once

Changes show up for everyone straight away. If someone changes an item while you have it open and you then save, the item shows "Someone changed this while you were editing" with **Use theirs** and **Keep mine**.

## The dashboard

The **Trips** card on the rooms page lists your rooms' trips that are on now or coming, soonest first, each with how far away it is; while a trip is on it lists today's items. Click a trip or an item to open it in its room.
