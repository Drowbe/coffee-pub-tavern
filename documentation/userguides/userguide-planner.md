# Planner

**Audience:** a player or game master planning a trip with the Planner module on a Coffee Pub Magpie server, and an admin setting it up.

The Planner module plans one trip for a room, day by day. The room's Calendar events, to-dos and polls that fall on the trip's days join the plan, and the module adds what a trip needs on top: stops, stays, journeys and notes. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Planner under **Available with this Magpie**, then **Approve and enable**. It asks to add two permissions to the Roles tab, to link to other modules' items and to ask other modules to do things.
2. Tick **Available in every room** on its card, or tick it per room on the room's own page.
3. On the Roles tab, under **Module: Planner**, choose who can **See the trip** and who can **Plan the trip**. By default everyone can see it, users and moderators can plan, and guests can see but not plan.

## Start a trip

Open the Planner pane in a room. With no trip yet it offers **Start planning**: give the trip a name, where it is, and its first and last day. The days appear as one list from top to bottom, however long the trip, with a strip of days at the top to jump to one and each day's heading staying in view as you scroll. **Edit trip** changes the name or the dates.

## Add to a day

- Type in the field at the bottom of the pane (with the plus button) and press Enter to add a stop to the day in view: "lunch at the pier at 1pm" adds "lunch at the pier" at 13:00, and a day of the trip in what you type ("museum oct 3 at 2pm") puts it on that day instead. Press the plus with nothing typed for the full form. When the pane has no bottom bar, each day has its own add row.
- In the form, first choose what it is, from the tiles: for getting there, a **flight**, **train**, **ferry**, **bus** or **car**; a **stay**; for eating and drinking, a **restaurant**, **café** or **bar**; for seeing and doing, a **sight**, **museum**, **tour** or **show**; or a **note**. The fields you need then appear: a flight has its airline, number, airport codes, terminal, gate, seat and class; a train its operator, number, platform, coach and seat; a stay its address, room, guests, check-out day and check-out time (its own day and time also serve as check-in); a meal its party size and the name it is booked under; a sight, museum, tour or show its number of tickets (and a show its entry). Every kind takes a day, a time and a length where they make sense, a booking reference, a cost and who paid, notes and the people it belongs to. Each kind has its own card in the day, in its own colour, so you can tell a flight from a dinner at a glance.
- **Getting to a stop.** Under **Getting to this stop**, choose how you get there (walk, drive, transit, bike or taxi) and how many minutes it takes from the stop before. A line between the two cards then shows the mode and the time, and the day's heading adds up the time spent getting around.
- **The line.** Not everything has a day yet. Anything can sit on the plan's line *between* two days instead of in one: an idea near the first day, a few more near the tenth, a poll between two days to decide where to go. Items before the first day are the ideas with no place yet. Drop anything on a joint (the line between two days opens up while you drag), choose a joint under **Move to** in an item's menu ("Before the first day", "Between Oct 1 and Oct 2", "After the last day"), pick one in the editor's **Where**, or add straight to a joint with its **+**. **Back to the line** in an item's menu takes it off its day. On the line an item keeps its order by hand and shows no time; on a day it goes by time.

Items with no time come first in a day, in the order you put them; items with a time follow, by time. An item from another module takes the time that item has (a Calendar event's start), so it sorts among the timed ones. Between two timed items a small line shows the gap, such as "45 min".

## Markers, extra days and empty days

- **Markers** are drawn for you, not items, and sit on the main timeline between the days: **Planning starts** above the first day and **Planning ends** below the last, and **Trip starts** above the day of the first booked item and **Trip ends** below the day of the last one. The days the trip covers have their own colour. Booked means a journey, a stay, or anything with a booking reference; with none of those, the first and last item with a time. With no items there are no trip markers. Markers cannot be edited, moved or removed, and do not count as something planned.
- **Time blocks** are the other kind of marker: things that happen inside a day and have no place, such as free time, rest, a buffer, a meet-up or a leave-by time. Add one from the editor's **Time** group of tiles (a label is optional; the type names it), with a time, a length (not for a meet-up or leave-by) and a note. They are drawn as the same coloured pill, sit among the day's items in time order, and are edited, moved and removed like any item. They are not stops and do not count in the day's summary. A marker with **no time** marks the whole day instead -- **Travel day** and **Free day** are two more types made for that -- and shows as a tag in the day's header; the day's "..." has a **Mark the day** group that adds one in a click, and clicking the tag opens its menu.
- **More on a card.** What a card's face has no room for -- the note, who is going, the booking reference, the terminal or platform, the room, the cost and who paid -- folds under it behind a **More** line. Open it and it stays open while you work.
- **Markers between the days** are markers that live only on the line ("lunch break", "travel day"). Add one with the small **+** that appears on the line where two days meet, before the first day and after the last, or from a hidden-days badge; the same + adds anything else there too. It has a type, an optional label and a note, and no time. Its menu (the three dots) can change its type, move it earlier or later along the line, move it to another joint and remove it; you can also drag it by its pill. They are not in any day, so they do not count as something planned.
- **Marker types** (their label, icon and colour) are a list in the Planner's Module Configuration on the Modules tab. The four automatic ones can be changed but not removed; time-block types can be added, changed, reordered and removed.
- **Add days before** (above the first day) and **Add days after** (below the last) move the plan's first or last date by 1 to 30 days, the same as changing the dates under Edit trip. A plan can be at most 60 days long, and the page says so when you ask for more. Items and trip markers stay where they were; the planning markers move with the new ends.
- The eye button in the toolbar hides days with nothing on them (a stay that covers the night counts), with a small badge on the line where a run of them was: it shows how many days are hidden, and its + adds a time block on the first of them or shows the days again. It is remembered for you in this browser and is off by default. If every day is empty, nothing is hidden.

## Move things

- On a computer, drag an item by the line beside its card, or by the card itself, to another place in its day or to another day. An item with no time goes where you drop it among the day's untimed items. An item with a time keeps it when it moves to another day, and dropped between two others on the same day it takes the end of the item before it as its time (nothing changes if that one has no time).
- Anywhere, including a phone, open the item's menu (the three dots): **Edit**, **Earlier**, **Later** (an item with no time swaps places with its neighbour; an item with a time moves half an hour), **Move to** another day or a joint on the line, **Back to the line**, and **Delete**.

## What other modules bring

- Something from the Calendar, To-do or Polls that is dated on a trip day appears under that day as a suggestion, with an **Add** button that puts it on the plan. An added item shows where it comes from and has an **Open** button that takes you to it. It is read only here: change it where it lives.
- Drag an item from another module onto a day to put it on that day.
- Another module can ask Planner to add something: a closed poll's winner can go onto the plan as a stop.
- A card Assistant's AI writes and marks as a flight, a train, a bus, a ferry, a car, a hotel, a restaurant, a cafe, a bar, a sight, a museum, a tour or a show is kept here as that proper kind of item, on the day it names, not just a plain note.
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
