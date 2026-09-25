# Known Issues

**Audience:** anyone running Coffee Pub Magpie who wants to know what is broken before reporting it
as new.

A defect is recorded here once it has been observed, with a workaround if one exists, and moves to
the CHANGELOG once fixed.

## A call page left open across an update must be reloaded

After the server is updated to the version that renamed "the table" (step 3 of the Names plan), a call page
that was already open still listens for the old messages and asks the old addresses. Until it is reloaded, it
does not follow a pull aside, a recall or a return, and does not show who is online.

Workaround: reload the page once after the update.

## A refused module update can still apply part of it

On the Modules tab, when one request changes a module in two ways and the second part is refused (for
example, turning a module off with force together with a run mode the server doesn't accept), the first part
is still applied, even though the page shows the error. GitHub #17.

Workaround: make one change at a time, and reload the Modules tab after an error to see the module's real
state.

## A Planner journey can't be longer than 24 hours

In the Planner, a journey's length is at most 24 hours, so a longer trip, such as a long flight with a
stop, is cut to 24 h, and its arrival time is worked out from that.

Workaround: enter it as two journeys, one for each part, or put the real arrival in the notes.

## The Planner's Bookings view shows 24-hour times on a 12-hour install

On an install set to the 12-hour clock, the Planner's **Bookings** view still shows times as 24-hour
(16:40).

Workaround: none; read the time from the item's card in the day.

## The console's Maps tab is too wide on a phone

On the host console at phone width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.
