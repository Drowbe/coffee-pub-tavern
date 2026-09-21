# Places

**Audience:** a player or game master keeping a room's places with the Places module on a Coffee Pub Tavern server, and an admin setting it up.

The Places module keeps the places your room cares about: where you are staying, where to eat, what to see. Each has a name, a category, an address, an optional position, notes and the people it belongs to. It needs no map. Other modules link to a place (a trip stop, an event, a task), and a place with a position shows on the map when the Maps module is installed. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (admin)

1. On the Modules tab, choose **Install** beside Places under **Available with this Tavern**, then **Approve and enable**. It asks to link to other modules' items.
2. Tick **Available in every room**, or tick it per room on the room's own page.
3. **Search (optional).** Set the **Search address** in Places' settings to a Photon-compatible place search that you run or may use, over https; it must allow requests from this server's pages (its CORS setting). Leave it empty for no search.
4. On the Roles tab, under **Module: Places**, choose who can **See places** and who can **Add, change and remove places**. By default everyone can see them, users and moderators can edit, and guests can see but not edit.

## Add a place

- Type in the field at the bottom of the pane and press Enter or the plus button. A name opens the dialog with that name filled in. Coordinates ("38.7075, -9.1364") or a map link in what you type also fill in the position, so "Bar do Peixe 38.71, -9.14" gives a named place with a position.
- With a search address set, a name you type looks for the place: results appear over the foot of the pane, and **Save** (or Enter on a row) saves one with its name, address and position. Coordinates or a map link in what you type still open the dialog instead.
- Press the plus with nothing typed, or **Add a place** on an empty page, for the blank dialog.
- In the dialog, give the place a name and choose its category (things to do, food, stay, travel or other). Add an address if you have one. **Position** takes coordinates or a map link (a `geo:` link, or one with `?ll=`, `@lat,lng` or `#map=zoom/lat/lng`); it says "Coordinates found." when it could read them, and an empty field means no position. Tick the people it belongs to under **Whose is it**.

Another module can also add a place for you: a trip's stop can offer to save itself as a place.

## Mine and this room

At the top, **Mine** and **This room** switch between two lists. **This room** is what the room shares. **Mine** is your own places: only you can see them, not even an administrator, and they follow you into every room you are in. Guests have only the room's. A place's menu has **Share to this room** (in Mine) or **Save to mine** (in This room), which copies it to the other list and leaves the original where it is. Places you keep in Mine are not linked to trips, events or tasks, so their "used by" pills do not apply.

## Find and open a place

Places are listed by category, with a chip for each category and a filter box that matches the name, address and notes as you type. Each place shows whether it is **On the map** or has **No position yet**, who it belongs to, and the items in other modules that point at it. Click a place to open it. When a map module is installed and enabled, clicking a place that has a position shows it on the map instead (the map opens if it is not open); its menu's **Edit** or **View** opens the place itself, and so does a click on a place with no position. Its menu (the three dots) has **Edit**, **Open in my maps app** (which hands the place to the maps app on your device, and searches the address when there is no position), **Copy coordinates** and **Delete**. Someone who may not edit sees **View** and a read-only card.

## When two people edit at once

Changes show up for everyone straight away. If someone changes a place while you have it open, the dialog says so with **Use theirs** and **Keep mine**.

## For module authors

Places provides two actions through the actions conduit (see [the SDK guide](api-module-sdk.md)), and its items are pointers of kind `place`:

- `addPlace` takes `title` and, optionally, `lat` and `lng` (both or neither), `address`, `category` (`do`, `eat`, `stay`, `travel` or `other`), `notes` and `ref` (a pointer to the item the place is for). It creates the place and returns a pointer to it.
- `setPlacePoint` takes `place` (a pointer to a place) and `lat` and `lng`, and gives that place a position.
- A place's card carries its address as the subtitle and, when it has a position, a `place` (`{ lat, lng }`), which is how a map module finds it.
