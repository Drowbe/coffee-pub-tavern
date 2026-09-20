# Modules

**Audience:** an admin adding, approving and removing add-on modules on a Coffee Pub Tavern server, and the people who use them.

A module is a zip file that adds a feature to Tavern, such as the [Calendar](userguide-calendar.md). The **Modules** tab on the Manage page installs them. Modules that come with Tavern run in the page. A module you upload runs in a sandbox, so it can only reach Tavern through what it asks for; it never runs code on your server. Each card says "In the page" or "Sandboxed". You can switch an uploaded module to run in the page, which lets it work with drag and drop between modules, but such a module can read and change everything on the page and act as you, so do it only for a module you trust. The tab also lists recent activity. If you are writing one, read [api-module-sdk](../api/api-module-sdk.md).

Chat and Conference are listed first on the Modules tab as built-in modules. They are always on and cannot be removed; their permissions are the ones already on the Roles tab.

## Modules that come with Tavern

The Calendar, To-do and Polls modules ship with the server, so there is no zip to upload. The Modules tab lists the ones you have not installed under **Available with this Tavern**, each with an **Install** button. When you update the server and a module it carries has a newer version than the one you have installed, the module's card shows **Update available** with an **Update to** button, the Modules tab itself says how many updates are waiting, and the settings gear in the header shows the same count as a small badge on every page (admins only), so you see it without opening Manage. The badge goes away once the updates are applied. The update keeps the module's data, keeps the old version so you can switch back, and, if it asks for anything new (a permission, a hook, a link to another module), stays off until you approve it. A module you upload yourself is updated by uploading a newer zip.

## Install a module

1. On the Modules tab, choose the zip file and click **Install**.
2. Read the card that appears. It lists what the module asks for: permissions that will appear on the Roles tab, and whether it wants to run things on a schedule or send notifications.
3. Click **Enable** (or **Approve and enable**), which records that you approved exactly what is listed. A new module always starts disabled.

The zip can be up to 10 MB. Tavern refuses a zip that holds files it does not allow, links, unsafe paths, too many or too large files, or a missing or invalid `module.json`, and says which. (The modules that ship with Tavern can also be built into a zip with `node tools/build-module.mjs modules/<name>`, which writes it to `modules/dist/`.) The Calendar zip, if you build it, is at `modules/dist/calendar-1.5.0.zip`.

## Where a module shows up

- **In the header.** A module with its own page adds an item to the header for everyone who may see it, such as Calendar. Opened from inside a call it appears over the call, so the call keeps running.
- **In a call.** A module with a room panel adds a **Modules** button to the call toolbar (the puzzle piece). Its menu opens just above the button and lists Chat and the modules on for that room, and it is the one place to show or hide them; the button shows an unread count for the chat and for module notifications. Choose one and it opens as a column beside the video and the chat when the module supports that (video, chat, then the module), or as a floating panel over the call. Drag a docked column's left edge to change its width. The buttons in a pane's header switch it between docked and floating, open it in a window of its own, or close it. Several can be open at once, and each remembers how you had it. On a narrow window a module opens floating. If you pop the whole call out into its own window, the panes come with it.
- **Notifications.** A module can notify you, for example a reminder. It appears as a toast, and as a number on the module's header item and the Modules button until you open the module.

## Turn a module on in rooms

A module with a room panel is off in every room until you turn it on. Either tick **Available in every room** on its card here, or open a room's own page from the Rooms tab and tick the module under **Modules**. The Modules section of a room only lists modules that are enabled.

## Who can use it

An enabled module adds its permissions to the **Roles** tab, in a group named for the module. Untick one to take that ability from a role. Admins can always do everything, and a member marked Moderator in a room gets the Moderator role's permissions for a room module there. A module's data is stored per server or per room, and a person only sees a room's module data if they are in that room.

## Upgrade and roll back

Upload a newer version of the same module and it replaces the active one. Tavern keeps the newest three versions. The card has a version picker with the running one selected; choose another and **Switch to this version** goes back, or forward again. The module's saved data stays as it is either way. An upgrade or switch that asks for something you have not yet approved comes back disabled, and shows **Approve and enable**.

## Disable and uninstall

**Disable** hides a module without losing anything, and takes its permissions off the Roles tab. **Uninstall** removes it and asks whether to keep its saved data, so a later reinstall picks up where it left off. Choosing to delete the data also removes its schedules and notifications.
