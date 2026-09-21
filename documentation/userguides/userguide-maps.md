# Maps

**Audience:** a player or game master using the Maps module on a Coffee Pub Tavern server, and an admin setting it up.

The Maps module shows a map of the places a room cares about: places added in Maps itself, and the places other modules' items carry (a trip stop, an event with a location). Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

**What you need:** the current Tavern (Maps and its map library ship inside it, so update the server the way you always do), and one map file. Nothing else is installed: no tile server, no database, no extra container, no account and no key.


1. **Get a map file.** Maps reads one PMTiles file: a region or the whole world. A city is a few megabytes, a country hundreds, the world about 107 GB. Regions can be cut from a world file with the `pmtiles extract` tool (a bounding box and a maximum zoom), and no tile server or database is needed.

   **Where to get one.** The world is published as a daily file (about 120 GB, zoom 0 to 15) at [maps.protomaps.com/builds](https://maps.protomaps.com/builds). You do not download all of it. Install the `pmtiles` tool ([releases](https://github.com/protomaps/go-pmtiles/releases); there is also a `protomaps/go-pmtiles` Docker image) and cut out your area, straight from the web address of the newest file on that page:

   ```
   pmtiles extract <address of the newest planet file> lisbon.pmtiles --bbox=-9.30,38.68,-9.05,38.82 --maxzoom=15
   ```

   `--bbox` is the area as west, south, east, north (longitude and latitude, in degrees); the example is Lisbon. Each extra zoom level roughly doubles the size, so a lower `--maxzoom` (13 or 14) makes a much smaller file. The map data is © OpenStreetMap contributors (the Open Database Licence), which Tavern credits on every map.
2. **Put it on the server.** Copy the file into the server's data folder, in `module-files/maps/`. Create the folder if it is not there. On a Docker or QNAP install the data folder is the volume mounted at `/app/data` in the container; in the sample `docker-compose.yml` that is `/share/appdata/tavern` on the NAS, so the file goes in `/share/appdata/tavern/module-files/maps/`.
3. On the Modules tab, choose **Install** beside Maps under **Available with this Tavern**, then **Approve and enable**. It asks to link to other modules' items and to ask other modules to do things.
4. Tick **Available in every room**, or tick it per room.
5. Under Maps' settings, pick the **Map file**. Until you do, Maps says so and shows only the list of places.
6. **Search (optional).** Set the **Search address** to a Photon-compatible place search that you run or may use, over https. The address must allow requests from this server's pages (its CORS setting). Leave it empty for a map without search: places are added by clicking, or by pasting coordinates or a map link.
7. On the Roles tab, under **Module: Maps**, choose who can **See the map** and who can **Add, change and remove places**. By default everyone can see it, users and moderators can edit, and guests can see but not edit.

Nothing is sent to any service you did not choose: the map comes from your file, and the only outside request is to the search address, if you set one. The credit "© OpenStreetMap contributors" is always on the map.

## Use the map

- **Add a place.** Choose **Add place**, then click the map; or paste coordinates ("38.7075, -9.1364") or a map link into the field at the bottom; or search, and pick a result. Give it a name and notes and save.
- **Look at a place.** Click a pin or a row in the list. **Open in my maps app** hands the place to the maps app on your device, which is where directions come from. **Copy coordinates** copies its position.
- **Move a place.** Select it, then drag its pin.
- **Places from other modules.** Items other modules share with a position show in the list under **From other modules**, with that module's icon; **Open** takes you to the item. Change them where they live. Drop an item from another module on the map to start a place linked to it.
- **Many places close together** show as one pin with a count; click it to zoom in.
- **On a phone** the list is a sheet at the bottom: pull it up or press its handle.

## When there is no map

Without a map file, an admin sees where to set one and everyone else sees the list of places. A device that cannot draw the map (no WebGL) shows the same list, each place opening in your maps app.
