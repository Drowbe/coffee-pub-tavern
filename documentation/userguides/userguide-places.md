# Places

**Audience:** a player or game master keeping a space's places with the Places module on a Collaborator server, and an owner setting it up.

The Places module keeps the places your space cares about: where you are staying, where to eat, what to see. Each has a name, a category, an address, an optional position, notes and the people it belongs to. It needs no map. Other modules link to a place (a trip stop, an event, a task), and a place with a position shows on the map when the Maps module is installed. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Places under **Available with this server**, then **Approve and enable**. It asks to link to other modules' objects.
2. Tick **Available in every space**, or tick it per space on the space's own page.
3. **Search (optional).** Under Places' settings (**Module Configuration** on its card), **Place search** chooses where a search for a place by name is asked, and Magpie sends nothing out unless you choose one:
   - **None** (the default): no search.
   - **Photon, the public service**: searches the server cannot answer from its own saved places are sent to the public Photon service at photon.komoot.io. Its terms are "reasonable limits": extensive use may be throttled or banned, and there is no availability guarantee. Results come from OpenStreetMap data, so "© OpenStreetMap contributors" applies (Magpie already shows that credit on the map, and the results say "Search by Photon").
   - **My own address**: a Photon-compatible service you run or may use, over https, whose address you enter. A server that already had a search address before this choice existed keeps working, as "My own address".
   - **Save places in this environment** (shown once a search is chosen, off until you turn it on): the server keeps every place a search returns (its OpenStreetMap type and number, name, address, position, category, when it was first and last returned, how often, and whether anyone picked it), and answers later searches from those first, asking the outside service only when fewer than five saved places match. What was searched for, and by whom, is never kept. Each result says whether it came from the server's saved places or from the service. The saved places are OpenStreetMap data: keep them for this server's own use, keep the credit, and check the terms of the service you use before you keep or share what it returns. Turn the setting off and nothing new is kept.
   - **Saved search results** (on the same page): how many places are saved, picked and unpicked, and when the oldest was first seen, with buttons to remove the unpicked ones, the unpicked ones older than a number of days, or everything. Each button asks twice. A place someone picked is kept unless you remove everything.
4. On the Roles tab, under **Module: Places**, choose who can **See places** and who can **Add, change and remove places**. By default everyone can see them, members and moderators can edit, and guests can see but not edit.

## Add a place

- Type in the field at the bottom of the module and press Enter or the plus button. A name opens the dialog with that name filled in. Coordinates ("38.7075, -9.1364") or a map link in what you type also fill in the position, so "Bar do Peixe 38.71, -9.14" gives a named place with a position.
- With a search chosen, a name you type looks for the place: results appear over the foot of the module, and **Save** (or Enter on a row) saves one with its name, address and position. Coordinates or a map link in what you type still open the dialog instead.
- Press the plus with nothing typed, or **Add a place** on an empty page, for the blank dialog.
- In the dialog, give the place a name and choose its category (things to do, food, stay, travel or other). Add an address if you have one. **Position** takes coordinates or a map link (a `geo:` link, or one with `?ll=`, `@lat,lng` or `#map=zoom/lat/lng`); it says "Coordinates found." when it could read them, and an empty field means no position. Tick the people it belongs to under **Whose is it**.

Another module can also add a place for you: a trip's stop can offer to save itself as a place.

## Mine, this space and everyone

At the top, **Mine**, **This space** and **Everyone** switch between three lists. **Everyone** is the places for the whole environment (an office, a regular haunt): everyone in the environment sees them, and anyone who may edit places can add, change and delete there, the same right as in a space. Guests see only the space's. **This space** is what the space shares. **Mine** is your own places: only you can see them, not even an administrator, and they follow you into every space you are in. Guests have only the space's. A place's menu has **Share to this space** (in Mine) or **Save to mine** (in This space), which copies it to the other list and leaves the original where it is. Places you keep in Mine are not linked to trips, events or tasks, so their "used by" pills do not apply. Places also has a page of its own (from the header) that shows Mine and Everyone outside any space.

## Find and open a place

Places are listed by category, with a chip for each category and a filter box that matches the name, address and notes as you type. Each place shows whether it is **On the map** or has **No position yet**, who it belongs to, and the objects in other modules that point at it. Click a place to open it. When a map module is installed and enabled, clicking a place that has a position shows it on the map instead (the map opens if it is not open); its menu's **Edit** or **View** opens the place itself, and so does a click on a place with no position. Its menu (the three dots) has **Edit**, **Open in my maps app** (which hands the place to the maps app on your device, and searches the address when there is no position), **Copy coordinates** and **Delete**. Someone who may not edit sees **View** and a read-only card.

## When two people edit at once

Changes show up for everyone straight away. If someone changes a place while you have it open, the dialog says so with **Use theirs** and **Keep mine**.

## For module authors

Places provides two actions through the actions conduit (see [the SDK guide](api-module-sdk.md)), and its objects are pointers of kind `place`:

- `addPlace` takes `title` and, optionally, `lat` and `lng` (both or neither), `address`, `category` (`do`, `eat`, `stay`, `travel` or `other`), `notes` and `ref` (a pointer to the object the place is for). It creates the place and returns a pointer to it.
- `setPlacePoint` takes `place` (a pointer to a place) and `lat` and `lng`, and gives that place a position.
- A place's card carries its address as the subtitle and, when it has a position, a `place` (`{ lat, lng }`), which is how a map module finds it.
