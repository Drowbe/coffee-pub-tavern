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

## Open question

The Go-binary trade-off, above. Everything else here is design, not architecture.
