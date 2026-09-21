# Maps Plan

**Audience:** the author deciding whether and how Tavern gets maps, and whoever builds it afterwards.

**Status:** Places (a module that owns the places) now exists beside Maps, and Maps 0.2.0 is a view of every card that has a `place` that saves new places through the `addPlace` action. Earlier status: Direction agreed by the author (see Decisions). Phases 1 to 5 are built (Maps 0.1.0): the core pieces, the module, places on other modules' items, and search. Phase 6 (a helper to cut a region) is not built. Glyphs: Noto Sans Regular and Medium, Latin, Latin Extended and general punctuation, from the Protomaps assets repository (SIL OFL 1.1, licence file shipped beside them), served from `public/maps-glyphs/`.

## What it is for

Places belong to things people already plan in Tavern: a trip's stops and stays, a calendar event's location, a task that has to be done somewhere. A map lets a group see where the things are and how far apart, pick a place by clicking instead of typing an address, and open a place in their own maps app. It must work for an operator who runs Tavern on one small machine (a NAS, a mini PC) with no account with anyone, and it must not send a group's places to a service the operator did not choose.

## Decisions

- **Scope:** self-hosted Tavern now, with a hosted edition designed in: every map setting is a value on the server, so a hosted edition sets the same values to services it runs. Nothing else in the design assumes a hosted edition.
- **Maps are their own module.** A bundled Maps module, not a core pane and not part of Travel. It owns the map, the places and its settings, and reaches other modules only through the generic conduits (a place on a card, actions, links, the drop menu), so Tavern and the other modules name no one.
- **Tiles:** the admin supplies one map file (a PMTiles archive, a region or the world) and picks it in the Maps module's server settings. Tavern serves it and the map reads it with range requests; there is no tile server.
- **Search yes, directions no.** Place search is an optional endpoint the admin sets; directions and routing are not built (a place opens in the person's own maps app for directions).

## What the proposed stack gets right, and where Tavern differs

The proposal read: MapLibre GL JS for the map, Martin serving locally stored tiles, Valhalla for directions, Photon for search, PostgreSQL for the data, and a WebSocket for live edits, with a shared worldwide service for a hosted edition and a regional or worldwide edition for self-hosting. It is a sound design for a hosted platform. Tavern is a different shape: one Node container, files on a volume, no database server, live changes already delivered by the module store. So:

| Piece | For Tavern |
|---|---|
| MapLibre GL JS (BSD 3-clause) | **Yes.** The map in the browser. Ship it, its style, fonts and icons from Tavern's own server. |
| Martin tile server | **Not needed.** Serve one PMTiles file: a single static archive the browser reads with HTTP range requests, so there is no tile server, database or key. Tavern's static server already handles range requests. |
| Worldwide tiles | **Possible but the operator's choice.** The world is one file of about 107 GB. An extract of a region is far smaller (a city can be a few MB), cut with the `pmtiles extract` command from a bounding box. |
| Photon (search) | **Optional endpoint, not shipped.** The Maps module's server setting takes the address of a Photon-compatible search service the operator runs or is licensed to use. A planet index is about 95 GB of disk and 64 GB of RAM is recommended, which is not a NAS; a regional index is much smaller. |
| Valhalla (directions) | **Not part of this plan.** Directions are a link out to the person's maps app. It can be added later behind another optional endpoint. |
| PostgreSQL | **No.** Places live on the items in the module store, with its versions and live changes. |
| Hosted shared infrastructure | Out of scope for this repository. If a hosted edition ever exists, it sets the same three settings below to its own services. |

## Licences: free for commercial use, like LiveKit

Everything Tavern ships or depends on must be free for commercial use and redistribution under a permissive licence (MIT, BSD, Apache 2.0, ISC, CC0, CC BY, SIL OFL), as LiveKit (Apache 2.0) and Font Awesome Free already are. Checked against the proposal:

| Piece | Licence | Verdict |
|---|---|---|
| MapLibre GL JS | BSD 3-clause | Ship. |
| PMTiles reader and the `pmtiles` tool | BSD 3-clause | Ship the reader; the operator runs the tool. |
| Protomaps basemap styles and build code | BSD 3-clause (the map design itself is CC0) | Use as the base of Tavern's own themed style. If Tavern distributes a modified fork of the styles or tiles it must not be named "Protomaps". |
| Map data (OpenStreetMap) and the tiles built from it | ODbL | Free for commercial use. Visible attribution "© OpenStreetMap contributors" is required on every map. Share-alike applies to a *database* made by adding to OpenStreetMap data and distributing it; a map drawn from it is a produced work and only needs the attribution. Tavern adds no data to it. |
| Glyph fonts (Noto Sans) | SIL Open Font License | Free to redistribute and use commercially; confirm the exact files when the style is chosen. |
| Photon (search) | Apache 2.0 | An optional endpoint the operator runs; permissive. |
| Valhalla (directions) | MIT | Same. OSRM (BSD 2-clause) is an equal alternative. |
| Nominatim (search) | GPL 2 and later | **Not shipped and not linked.** Tavern may speak its query format to an endpoint the operator runs, which is a protocol, not code. |

**Ruled out** because they are not free for commercial use or not free at all: Mapbox GL JS from version 2 (proprietary; MapLibre is its open fork), Google, Apple and other proprietary map, geocoding or routing services, hosted tile services with paid or per-request terms, satellite and aerial imagery (proprietary), and the public OpenStreetMap tile servers as an application default (their usage policy forbids it). The operator may point Tavern at any service they hold the right to use; Tavern ships none of them.

The About page lists every one of these under "Built on", with its licence, as it does for LiveKit.

## Design

**The experience**

- **For a group:** a Maps view opens like any other module, from the room bar as a pane beside the call (a tab on a phone) or as a page of its own. It shows a map with a pin for every place the room has: places added in Maps itself, and places that other modules' items carry (a trip stop, a stay, a calendar event with a location), each pin showing the item's card and its open action. Clicking the map adds a place (a name, notes, who it is for). If the admin set up search, a search box finds a place by name and drops a pin; if not, clicking, or pasting a coordinate or a map link, does the same. A place has an "Open in my maps app" action for directions.
- **For other modules:** a card may carry an optional `place` (`{ lat, lng, name }`) next to `when`; the Maps module shows every item whose card has one. Dropping an item on the map, or a Maps action ("Put this on the map", asked through the actions conduit), gives an item a place. Travel and the Calendar decide for themselves whether to offer it; nothing in Tavern names Maps.
- **For the admin:** Manage > Modules > Maps > server settings (the module-settings mechanism): the map file, and optionally a search address. Both empty means Maps says so and shows nothing to configure for the group. Attribution "© OpenStreetMap contributors" is on every map and cannot be turned off.
- **For the operator's disk and RAM:** a regional file is megabytes to a few gigabytes; the worldwide file is about 107 GB of disk and no extra RAM, read by range. No tile server, database or extra process.

**Parts, and who builds them**

1. **Tavern core (server):** a generic way to serve a file an admin placed in the data folder, with range requests, to modules (the map file), and a place for a module's own large assets. Not Maps-specific.
2. **The Maps module (front-end, bundled):** MapLibre GL JS and the PMTiles reader inlined in its page, a style themed with the theme tokens (light and dark), the pins, the place list, the add and edit forms, the search box. Its data (places) is in the module store like any other module's.
3. **The conduits:** the optional `place` on a card (the cards contract), and the Maps module's actions. Both generic.
4. **The look:** the interface side designs the map page, the pins, the place cards and the phone layout, with a static mock and a short contract first, as for Travel.

## Constraints found in this repository

- The map's worker needs `worker-src blob:`. A bundled module runs inside the page and shares its policy, so the room page and the module page allow blob workers for every module rather than for Maps alone; same-origin reads were already allowed.
- A bundled module runs in the page and its build inlines its script and CSS into one file; MapLibre is large (several hundred kilobytes), so the Maps page is heavier than the others and loads only when Maps is opened.
- The style's fonts (glyph files) are many small files and the largest part of what would ship; a Latin-only set keeps the image small, more scripts can be an optional add-on.
- The style is Tavern's own and follows the theme tokens, so a light theme gets a light map.
- Map libraries need WebGL. A device without it gets a plain list of places with the open-in-maps-app action.

## Phases

1. **Core:** serve an admin-placed file with range requests for modules; the CSP for the Maps page; the module-settings fields for a file and an address.
2. **Design:** the interface side's contract and static mock (map page, pin, place card, list fallback, phone).
3. **Maps 0.1:** the map from the admin's file, attribution, places added by clicking and by pasting, the place list, open in my maps app, themed style, the phone layout.
4. **Places on other modules' items:** the `place` on cards, showing them on the map, the drop and action to give an item a place; Travel and the Calendar offer it.
5. **Search:** the optional endpoint and the search box.
6. **A helper to cut a region**, if asked for. Directions are out of scope for now.

## Facts checked

- MapLibre GL JS is licensed under the 3-clause BSD licence ([source](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)).
- A worldwide PMTiles basemap is about 107 GB; a bounding-box extract can be a couple of MB; readers use HTTP range requests, so no tile server is needed ([Protomaps docs](https://docs.protomaps.com/pmtiles/), [PMTiles guide](https://guide.cloudnativegeo.org/pmtiles/intro.html)).
- Photon planet: about 95 GB disk, 64 GB RAM recommended ([Photon README](https://github.com/komoot/photon/blob/master/README.md), [self-hosting notes](https://chibigeo.com/docs/photon/self-hosting-photon/)).
- Valhalla planet: 70 to 140 GB of tiles, at least 32 GB RAM for the planet and about 16 GB for Europe ([discussion](https://github.com/valhalla/valhalla/discussions/5919), [tile packs](https://www.interline.io/valhalla/tilepacks/)).
- Licences: Photon is Apache 2.0 ([Photon licence](https://github.com/komoot/photon/blob/master/LICENSE)), Valhalla is MIT ([licence](https://github.com/valhalla/valhalla/blob/master/LICENSE.md)), Nominatim is GPL ([copying](https://github.com/osm-search/Nominatim/blob/master/COPYING)), OSRM is BSD 2-clause; the Protomaps basemap software is BSD 3-clause and its design CC0, with the tiles a produced work of OpenStreetMap needing attribution ([data licence note](https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md)).
- OpenStreetMap data is under the ODbL and needs attribution; a tile service built from it is a produced work ([licence FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ), [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)); the public tile servers may not be the default of an application ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).

## Questions

None open. Two things to confirm later, not now: the exact glyph font files and their licence when the style is chosen, and the wording of the attribution when a specific tile builder is chosen.
