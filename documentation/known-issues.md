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

## The console's Maps tab is too wide on a phone

On the host console at phone width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.
