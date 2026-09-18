# Modules Architecture

**Audience:** developers changing how Coffee Pub Tavern installs and stores modules.

What an admin does with modules is [userguide-modules](../userguides/userguide-modules.md), and the
routes are [api-modules](../api/api-modules.md). This document is what you can only learn from
`server/modules.js`.

## Model

A module is front-end only. Nothing in a zip is ever run by the server: every file type is allowlisted,
and the zip is read entirely in memory against hard limits before a single byte is written. A module
will run in a sandboxed frame and reach Tavern only through a host API, so accepting a zip from someone
else is bounded by that sandbox and by the admin's approval, not by trust in the author.

## On disk

Under `DATA_DIR/modules`:

```
registry.json                     what is installed and its state
<id>/versions/<version>/...       the module's files, one folder per version
<id>/data/                        the module's own data, kept across upgrades
```

`registry.json` is written by writing a temporary file and renaming it. Each entry holds the active
`version`, the list of installed `versions`, `enabled`, `allRooms`, `rooms`, and `approved`, which is
the permissions and hooks the admin agreed to. The manifest is read from the version's own
`module.json` on demand, so the registry cannot drift from the files.

## Reading the zip

`readZip` in `server/modules.js` uses `yauzl` on the uploaded buffer and builds a map of file name to
bytes. It refuses, with a message the admin sees:

- an unsafe path (the library already rejects `..` and absolute paths), or control characters in a name;
- a symbolic link, detected from the entry's Unix mode bits;
- any extension not on the allowlist;
- more than 500 files, a file over 10 MB, or more than 40 MB in total.

Sizes are checked twice: from the entry header before reading, and again on the bytes actually
streamed, because a header can lie. A zip made from a folder, with everything inside one top-level
folder, has that folder stripped when `module.json` is found inside it.

## Manifest validation

`cleanManifest` builds a fresh object from only the fields it knows, so unknown fields cannot reach the
registry, and it checks that each surface entry exists in the zip. It returns the cleaned manifest or
throws a `ModuleError`, which is a `StoreError` and so is turned into a JSON error by the server's
error handler.

## Install, upgrade and rollback

Files are written to a staging folder next to the final location and moved into place with a single
rename, so a failure never leaves a half-installed version. A new module is created disabled. An
upgrade keeps `enabled`, `allRooms` and `rooms`, then compares what the new manifest asks for with
`approved`; anything new turns `enabled` off. Rollback changes only the active `version` and applies
the same check. After each install, only the newest three versions are kept, never removing the active
one.

## Approval

`pendingFor` returns the permissions and hooks in the active manifest that are not in `approved`.
Enabling copies the whole current set into `approved`. That is why an upgrade can quietly gain a
capability only if the admin approves it.

## Uninstall

Removes the `versions` folder and the registry entry. The `data` folder is removed only when asked, so
that reinstalling the same `id` finds its data again.
