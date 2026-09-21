# Maps

**Audience:** a player or game master using the Maps module on a Coffee Pub Tavern server, and an admin setting it up.

The Maps module shows a map of every place your room has: the places saved in [Places](userguide-places.md), and the items other modules give a position (a trip stop, an event with a location). Maps keeps nothing of its own and needs [Places](userguide-places.md), which is also the list of places. Install and enable Places first, then Maps; see [Modules](userguide-modules.md).

## Set it up (admin)

**What you need:** the current Tavern (Maps and its map library ship inside it, so update the server the way you always do), and one map file. Nothing else is installed: no tile server, no database, no extra container, no account and no key.


1. **Get a map file.** Maps reads one PMTiles file: a region or the whole world. A city is a few megabytes, a country hundreds, the world well over 100 GB. Regions can be cut from a world file with the `pmtiles extract` tool (a bounding box and a maximum zoom), and no tile server or database is needed.

   **Where to get one.** The world is published as a daily file (about 138 GB when I last checked, zoom 0 to 15) at [maps.protomaps.com/builds](https://maps.protomaps.com/builds). You do not download all of it. Install the `pmtiles` tool ([releases](https://github.com/protomaps/go-pmtiles/releases); there is also a `protomaps/go-pmtiles` Docker image) and cut out your area, straight from the web address of the newest file on that page:

   ```
   pmtiles extract <address of the newest planet file> lisbon.pmtiles --bbox=-9.30,38.68,-9.05,38.82 --maxzoom=15
   ```

   `--bbox` is the area as west, south, east, north (longitude and latitude, in degrees); the example is Lisbon. Each extra zoom level roughly doubles the size, so a lower `--maxzoom` (13 or 14) makes a much smaller file. As a guide, all of Italy (`--bbox=6.6,35.4,18.8,47.1`) at `--maxzoom=13` was 1.2 GB and took about two minutes to cut. The map data is © OpenStreetMap contributors (the Open Database Licence), which Tavern credits on every map.
2. **Put it on the server.** Copy the file into the `map-tiles` folder inside Maps' own folder in the server's data folder, `modules/maps/map-tiles/`. Create the folder if it is not there. The file's name may use letters, digits, dot, dash and underscore, so rename "italy (1).pmtiles" to "italy.pmtiles". A link to a file works. If the picker in the settings is empty, it says which folder Tavern looked in and lists anything it ignored with the reason; the server's log says the same when it starts. On a Docker or QNAP install the data folder is the volume mounted at `/app/data` in the container; in the sample `docker-compose.yml` that is `/share/appdata/tavern` on the NAS, so the file goes in `/share/appdata/tavern/modules/maps/map-tiles/`. Updating or uninstalling Maps never deletes what you put there, even if you also choose to delete its saved data.
3. On the Modules tab, choose **Install** beside Maps under **Available with this Tavern**, then **Approve and enable**. It asks to link to other modules' items and to ask other modules to do things.
4. Tick **Available in every room**, or tick it per room.
5. Under Maps' settings (**Module Configuration** on its card), **Map source** says where the map comes from: **A map file on this server** (the default, described here) or **A map file at a web address** (see below). For a file on this server, the **Map files** table lists every file in that folder with its size and a tick. Tick the ones to use: Maps draws all the ticked files together, so two regions that sit side by side (Italy and Portugal, say) become one map. Untick a file to stop using it. Until one is ticked, Maps says so.
6. **Search (optional).** The search belongs to Places: choose its **Place search** in Places' settings (see [Places](userguide-places.md)). With a search chosen, the field at the bottom of the map searches: type a place and press Enter, and what Places finds is listed over the map and shown as pins. Without one (the default) the field says search is not configured, and still takes pasted coordinates or a map link.
7. On the Roles tab, under **Module: Maps**, choose who can **See the map** and who can **Save places from the map**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.

**A map file at a web address.** Choose it and give the **Map file address**: an https link to a `.pmtiles` file hosted elsewhere (your own cloud storage or a content delivery network, for example). The map is then read from that host in pieces, so it need not be stored on this server. The cost is privacy: every person's browser contacts that host directly, and the host can see their internet address and roughly which area they are looking at, so choose a host you trust and tell the people who use this server. The host must allow requests from this server's pages (CORS) and support range requests, as static hosting and most content delivery networks do; its terms, cost and reliability are yours to check. Only https addresses work, and an address with a user name or password is refused. If the address does not answer, Maps shows "The map could not load" with Try again. The credit "© OpenStreetMap contributors" stays on the map either way.

Nothing is sent to any service you did not choose: the map comes from your file, and the only outside request is Places' search, if you choose one. The credit "© OpenStreetMap contributors" is always on the map.

## Use the map

- **Save a place.** Choose the **+** button beside the field at the bottom, then click the map; or paste coordinates ("38.7075, -9.1364") or a map link into the field; or search there: results show as dashed pins, and clicking one starts a place there. Places opens its own dialog (its pane opens if it was not) with the spot filled in, and you finish and save it there; the new place then appears on the map.
- **Look at a place.** Click a pin to open its callout over the map: its name, where it is and where it comes from. **Open in my maps app** hands the place to the maps app on your device, which is where directions come from. **Copy coordinates** copies its position. **Open** takes you to the place or item in its own module, where you change it; the map itself changes nothing. Your own places (from **Mine** in Places) are drawn too, with a small person mark, and only you see them. To browse the list of places, use Places, which also shows a place on the map when you click it.
- **Put an item on the map.** Drop an item from another module on the map: if it already has a position it is shown, and if its module can give it one (Places can, for a place with only an address) it is placed where you dropped it.
- **Many places close together** show as one pin with a count; click it to zoom in.

## When there is no map

Without a map file, an admin sees where to set one and everyone else is told Maps is not set up. A device that cannot draw the map (no WebGL) says so; your places are still in Places, each opening in your maps app.
