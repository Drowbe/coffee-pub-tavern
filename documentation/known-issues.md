# Known Issues

**Audience:** anyone running Coffee Pub Magpie who wants to know what is broken before reporting it
as new.

A defect is recorded here once it has been observed, with a workaround if one exists, and moves to
the CHANGELOG once fixed.

## A broken backup restores as an empty environment

On the host console, restoring a zip whose `app.json` is not valid JSON is not refused: the restore
succeeds and the environment opens empty, with none of its accounts, spaces or settings. This was so before
the newer-backup check, which only refuses a backup it can read. The rest of the zip's files are still in
the environment's folder.

Workaround: restore a good backup over it. Before restoring a zip you are unsure of, check that its
`app.json` is valid JSON.

## The console's Maps tab is too wide on a phone

On the host console at phone width, the Maps tab runs past the right edge of the screen.

Workaround: use a wider window or turn the phone sideways.

## Two buttons on a console card say "Restore"

An environment card on the host console has **Restore backup**, and, for a suspended environment, a button
labelled **Restore** that takes it out of suspension. They do different things: the second changes no data.
Whether to rename it (to **Resume**) is still to be decided.

