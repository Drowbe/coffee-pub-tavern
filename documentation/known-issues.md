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

## Opening a dashboard item a second time doesn't open the item

On the spaces page, clicking an item on the dashboard (a task, an event, a poll) opens its module and the item
the first time. Clicking it a second time opens the module but not the item.
GitHub #20.

Workaround: find the item in the module itself.

## The Calendar shows an error after the whole app is popped out

After popping the whole app out into its own window with the Calendar open, the Calendar reports an error
(`isCompact`). GitHub #21.

Workaround: none known yet.

## Chat in its own window shows an error when it gets focus

With the chat opened in a window of its own, clicking into that window reports an error. GitHub #22.

Workaround: none known yet.

## The console's Maps tab is too wide on a phone

On the host console at phone width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.
