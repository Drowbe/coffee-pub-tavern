# Maps Plan

**Audience:** the author deciding whether and how Tavern gets maps, and whoever builds it afterwards.

**Status:** Proposed. Nothing is built. The recommendation below needs the author's answers to the questions at the end.

## What it is for

Places belong to things people already plan in Tavern: a trip's stops and stays, a calendar event's location, a task that has to be done somewhere. A map lets a group see where the things are and how far apart, pick a place by clicking instead of typing an address, and open a place in their own maps app. It must work for an operator who runs Tavern on one small machine (a NAS, a mini PC) with no account with anyone, and it must not send a group's places to a service the operator did not choose.

## What the proposed stack gets right, and where Tavern differs

The proposal read: MapLibre GL JS for the map, Martin serving locally stored tiles, Valhalla for directions, Photon for search, PostgreSQL for the data, and a WebSocket for live edits, with a shared worldwide service for a hosted edition and a regional or worldwide edition for self-hosting. It is a sound design for a hosted platform. Tavern is a different shape: one Node container, files on a volume, no database server, live changes already delivered by the module store. So:

| Piece | For Tavern |
|---|---|
| MapLibre GL JS (BSD 3-clause) | **Yes.** The map in the browser. Ship it, its style, fonts and icons from Tavern's own server. |
| Martin tile server | **Not needed.** Serve one PMTiles file: a single static archive the browser reads with HTTP range requests, so there is no tile server, database or key. Tavern's static server already handles range requests. |
| Worldwide tiles | **Possible but the operator's choice.** The world is one file of about 107 GB. An extract of a region is far smaller (a city can be a few MB), cut with the `pmtiles extract` command from a bounding box. |
| Photon (search) | **Optional endpoint, not shipped.** A planet index is about 95 GB on disk and 64 GB of RAM is recommended. That is not a NAS. |
| Valhalla (directions) | **Optional endpoint, not shipped.** A planet graph is 70 to 140 GB and wants 32 GB of RAM; Europe alone about 16 GB. |
| PostgreSQL | **No.** Places live on the items in the module store, with its versions and live changes. |
| Hosted shared infrastructure | Out of scope for this repository. If a hosted edition ever exists, it sets the same three settings below to its own services. |

## Design

- **A generic conduit, not a Travel feature.** A map is a shared tool, so it belongs in the core SDK: a map surface any module can use to show places and to let a person pick one, and a place on a card as an optional field (`place: { lat, lng, name }`) next to `when`, so any module's items can appear on it. Tavern names no module: the map shows every item whose card has a place.
- **A Map pane at the table.** Like the chat, a room pane that docks beside the call: pins from the room's items, tap a pin for the card and its open action, click the map to add a place (which asks the module that owns the target, through the existing actions and drop menu). On a phone it is one of the views in the tab bar.
- **Three settings on the server page (Manage > Server > Maps), all off by default:**
  1. **Tiles:** none, a PMTiles file the operator put on the server's volume, or a URL to one. With none, places are addresses that open in the person's own maps app, exactly as today.
  2. **Search:** an optional endpoint that speaks the Photon or the Nominatim query format. Off: no search box, click or paste coordinates.
  3. **Directions:** an optional endpoint that speaks the Valhalla or OSRM format. Off: straight-line distance and a link out for directions.
- **Nothing calls home.** No default remote tiles (the OpenStreetMap public tile servers forbid default use by an application), no analytics, no key. Dataset downloads and updates are something the operator does on purpose; Tavern documents the command and, later, may offer a button.
- **Attribution is built in.** The map always shows "© OpenStreetMap contributors" (and the tile builder's own credit when the style requires it), because the OpenStreetMap data licence (ODbL) requires attribution wherever a map made from it is shown. The setting cannot hide it.
- **Two sizes for the operator:** Regional (a PMTiles extract of the area the group cares about, hundreds of MB to a few GB, a search and directions endpoint only if they run one) and Worldwide (the whole file, about 107 GB of disk and no extra RAM, because it is read by range, with search and directions still optional).

## Constraints found in this repository

- The table page's content security policy has `worker-src 'self'`; the map library runs its rendering in a worker built from a blob, so the policy needs `blob:` added for it, and only on the pages that show a map.
- A module in a sandboxed frame cannot load a map library or tiles itself. Bundled modules run in the page, but an uploaded module must reach the map only through the SDK, which is one more reason for the map to be a host-drawn surface.
- The fonts (glyph files) for a vector style are many small files and the largest part of what Tavern would ship; a Latin-only set keeps the image small, more scripts can be an optional download.
- The map's style must be one Tavern ships and themes with the theme tokens, so a light theme gets a light map.

## Phases

1. **Decide** (this plan's questions).
2. **The map surface:** MapLibre and the PMTiles reader shipped from Tavern, the tiles setting, attribution, a themed style, the SDK call to show pins and to pick a place.
3. **Places on items:** the `place` field on cards; Travel, the Calendar and the To-do give their items places; the Map pane at the table and on a phone.
4. **Search:** the optional endpoint, with a search box in the picker.
5. **Directions:** the optional endpoint; gaps between stops become real travel times.
6. **A helper to cut a region** from the operator's chosen area, if asked for.

## Facts checked

- MapLibre GL JS is licensed under the 3-clause BSD licence ([source](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)).
- A worldwide PMTiles basemap is about 107 GB; a bounding-box extract can be a couple of MB; readers use HTTP range requests, so no tile server is needed ([Protomaps docs](https://docs.protomaps.com/pmtiles/), [PMTiles guide](https://guide.cloudnativegeo.org/pmtiles/intro.html)).
- Photon planet: about 95 GB disk, 64 GB RAM recommended ([Photon README](https://github.com/komoot/photon/blob/master/README.md), [self-hosting notes](https://chibigeo.com/docs/photon/self-hosting-photon/)).
- Valhalla planet: 70 to 140 GB of tiles, at least 32 GB RAM for the planet and about 16 GB for Europe ([discussion](https://github.com/valhalla/valhalla/discussions/5919), [tile packs](https://www.interline.io/valhalla/tilepacks/)).
- OpenStreetMap data is under the ODbL and needs attribution; a tile service built from it is a produced work ([licence FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ), [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)); the public tile servers may not be the default of an application ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).

## Questions

- **Is the hosted edition in scope?** The proposal assumed one. This plan is for the self-hosted Tavern only, with the three settings letting a hosted edition point at its own services later.
- **Search and directions as optional endpoints, not shipped:** acceptable? The alternative is to ship them and require a server of 16 to 64 GB of RAM.
- **Who supplies the tiles at first:** the operator downloads or cuts a file and points Tavern at it (this plan), or Tavern offers a region picker that fetches it?
- **A Map pane at the table, or only a map inside the Travel module first?** The pane costs more but serves every module; Travel-only is quicker but would have to be redone.
