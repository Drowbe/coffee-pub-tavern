# Map Region Download Plan

**Audience:** the author deciding whether to automate cutting a map region, and whoever builds it.

**Status:** Proposed. Nothing built. Answers the author's question ("type a location, have it created, downloaded and added") with what is actually possible.

## Today

An admin gets a map by hand: install the `pmtiles` command-line tool, run `pmtiles extract <the world file's address> region.pmtiles --bbox=... --maxzoom=...`, then copy the result into `modules/maps/map-tiles/`. Documented in the Maps guide. It works because that tool reads the world file over the network in pieces — nobody downloads 100+ GB.

## What the author wants

Type "Mexico" in Maps' Module Configuration, and have Tavern find it, cut it, and add it to the Map files list, with a progress bar.

## Is it doable? Yes, in two parts, one clean and one with a real trade-off

**1. Name to a box on the map: yes, cleanly.** A place's bounding box (its rectangle of latitude and longitude) comes from the same kind of service Places already uses for search — a Photon-compatible endpoint, or Nominatim's own (Nominatim's answers include a `boundingbox`; [Nominatim's own docs](https://nominatim.org/release-docs/latest/api/Output/)). Nothing new to add architecturally: Places' search-provider setting already exists for exactly this shape of lookup, and Maps could ask it (through the same generic conduit Maps already uses to reach Places' search) for "Mexico" and get back a box, not just a point.

**2. Cutting the region from the world file: the one tool that does it is not JavaScript.** I looked for a pure-JS way to do what `pmtiles extract` does (read a remote PMTiles archive over HTTP ranges and write out a smaller one for a box) and found none — only the [Go `pmtiles` CLI](https://docs.protomaps.com/pmtiles/) does this. The PMTiles JavaScript library that Maps already ships is a *reader* (for drawing a map in the browser), not a writer. There's a Python package too, but not a Node one.

This runs into the choice the server was built around: every dependency is pure JavaScript so one Docker build serves both Intel and Arm machines (running `npm` under emulation for a native package crashed before). A Go binary is a different kind of thing from a native npm addon, though: Go cross-compiles cleanly for both architectures with no emulation needed, so vendoring the small `pmtiles` binary (one per architecture, built once) is a much smaller risk than the native-npm problem that rule was written to avoid. I think it's a reasonable exception, but it does add a second compiled thing to the image, and that's a call for the author and Server Development together, not mine to make alone.

## The design, if it goes ahead

1. **Module Configuration (Maps), a new field beside the file list:** "Add a region" — a text box ("Mexico", "Lisbon", "the Algarve") and a **Find it** button.
2. **Confirm before anything downloads.** A found box shows the place's name and roughly how big the cut will be (estimated from its area and the chosen zoom), with **Cut and add** to confirm. Nothing is fetched on a keystroke.
3. **Progress**, since a country-sized cut can take a while: a bar with a state line ("Reading the world file...", "Writing italy.pmtiles..."), delivered the way Tavern already streams other long-running things (server-sent events), not by polling.
4. **On success**, the new file appears in Map files, ticked, ready to use; on failure, a plain reason (the source was unreachable, the box was too large, disk was short) and nothing half-written is left behind.
5. **A source setting**, since "the world file" has to come from somewhere: default to the Protomaps daily build's address (documented today), with the address itself as a setting an admin could point elsewhere.
6. **A sane top end.** A box the size of a small country at a modest zoom is fine; the whole world, or continent-sized boxes at a high zoom, should be refused or clearly warned about, since the point is to avoid exactly that.

## Order of work

1. Server Development settles the Go-binary question with the author, and if yes, adds it to the Docker build (one binary per architecture).
2. The cut runs as a background job: given a box and a maximum zoom, run the tool against the source address, report progress over SSE, write the result into the module's own folder, and refresh the Map files list.
3. The name-to-box lookup, through Places' existing search setting.
4. The Module Configuration UI: the field, the confirm step, the progress bar. (Mine, once 1–3 exist to build against.)

## Decided

The author said yes to the Go binary (2026-09-22): vendor the `pmtiles` CLI into the Docker image, one binary per
architecture, cross-compiled (no emulation).

## Progress

**Step 1 of "Order of work" is done: the binary is in the image.** The Dockerfile downloads the official
[protomaps/go-pmtiles](https://github.com/protomaps/go-pmtiles) release (a static Go binary, no compiling), one
per target platform, checked against a sha256 pinned in the Dockerfile itself (the release carries no checksums
file, so it was computed once from the downloaded asset). Verified by the real thing, not a local guess: pushed to
`main` and watched the `Publish container image` GitHub Action build both `linux/amd64` and `linux/arm64` (no
local Docker used or needed) -- both checksums passed (`pmtiles.tar.gz: OK`) and the image published in 46
seconds.

**Step 2 is done: the cut runs as a background job.** `server/region-cut.js` wraps the CLI: a module opts in with
`regionSource` in its manifest (see [api-modules](../api/api-modules.md)); a dry run (`--dry-run`) gives the tile
count and estimated size before anything downloads, refusing one over a size ceiling; the real cut writes to a
temp file and only renames it into the module's file folder on success, so a failure leaves nothing behind; only
one cut runs per module at a time; progress streams over server-sent events. Maps is the first module wired up
(`regionSource` pointing at a new `worldSource` url setting). Verified two ways: `tools/check-region-cut.mjs`
against a stand-in "pmtiles" script (no network), and, once that caught and fixed a real mistake (the CLI's log
lines and progress bar are both on stdout, not stderr, once it is not talking to a terminal -- found only by
running the actual binary locally, installed from its own GitHub release), a live run against a running server and
the *real* Protomaps daily build: `estimate` and the full cut both matched the CLI's own numbers exactly (13
tiles, 844 kB), the file landed in `map-tiles/`, a second request for the same name was refused, and a second cut
while one was running was refused too.

**Step 3 is done: the name-to-box lookup.** `GET /api/modules/:id/region-cut/find?q=` asks whichever enabled
module has a place search configured (the same generic conduit `geocoder` already is -- not hardcoded to Places,
found the same way a module's AI or upload dependency is), and reads the rough rectangle a Photon-compatible
service already returns for an administrative or area result (its `extent`, a field `server/geocode.js` was not
reading before now) -- absent for a point or POI result, so those are skipped in favour of the next result that
carries one. Verified live against the real server and the real Photon service: "Mexico" and "Eiffel Tower" (a
building with a footprint, not the point result of the same name) both came back with a real box; a query with no
match, a server with no search configured, and a module with no world file set up were each refused with a plain
reason.

Left: step 4 (the Module Configuration UI -- the interface side).
