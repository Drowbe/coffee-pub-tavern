# Maps

**Audience:** a player or game master using the Maps module on a Coffee Pub Tavern server, and an admin setting it up.

The Maps module shows a map of the places a room cares about: places added in Maps itself, and the places other modules' items carry (a trip stop, an event with a location). Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. **Get a map file.** Maps reads one PMTiles file: a region or the whole world. A city is a few megabytes, a country hundreds, the world about 107 GB. Regions can be cut from a world file with the `pmtiles extract` tool (a bounding box and a maximum zoom), and no tile server or database is needed.
2. **Put it on the server.** Copy the file into the server's data folder, in `module-files/maps/`. Create the folder if it is not there.
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
