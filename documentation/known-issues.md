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

## A link that no longer works never shows the environment's name

The page shown for a personal link that no longer works (turned off or regenerated) is meant to name the
environment, but it never does: the script that fills the name in is blocked by the page's own security policy.
The page still says the link doesn't work. GitHub #18.

Workaround: none needed; ask the environment's owner for a new link.

## The Calendar doesn't open an event from a link to it

A link to a Calendar event (an item's address ending in `#ref=...`, such as one another module or a person
shared) opens the Calendar but not the event, when the Calendar is loaded for the first time by that link or
is on a space's page. GitHub #19.

Workaround: find the event on its day in the Calendar.

## Opening a dashboard item a second time doesn't open the item

On the spaces page, clicking an item on the dashboard (a task, an event, a poll) opens its module and the item
the first time. Clicking it a second time opens the module but not the item.
GitHub #20.

Workaround: find the item in the module itself.

## A module's own descriptions and setting labels use the default words

When an owner sets the environment's own words (Manage > Environment > **Words**), everything people read follows,
except the text in a module's `module.json`: its description, and its settings' labels and help. Those still say
"space", "member" and the other default words. The next step of the environment templates plan changes this.

Workaround: none.

## The console's Maps tab is too wide on a phone

On the host console at phone width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.
