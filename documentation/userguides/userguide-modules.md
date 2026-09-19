# Modules

**Audience:** an admin adding, approving and removing add-on modules on a Coffee Pub Tavern server, and the people who use them.

A module is a zip file that adds a feature to Tavern, such as the [Calendar](userguide-calendar.md). The **Modules** tab on the Manage page installs them. A module runs in your browser inside a sandbox, so it can only reach Tavern through what it asks for, and it never runs code on your server. If you are writing one, read [api-module-sdk](../api/api-module-sdk.md).

## Install a module

1. On the Modules tab, choose the zip file and click **Install**.
2. Read the card that appears. It lists what the module asks for: permissions that will appear on the Roles tab, and whether it wants to run things on a schedule or send notifications.
3. Click **Enable** (or **Approve and enable**), which records that you approved exactly what is listed. A new module always starts disabled.

The zip can be up to 10 MB. Tavern refuses a zip that holds files it does not allow, links, unsafe paths, too many or too large files, or a missing or invalid `module.json`, and says which. The Calendar zip is built into the repository at `modules/dist/calendar-1.2.0.zip`.

## Where a module shows up

- **In the header.** A module with its own page adds an item to the header for everyone who may see it, such as Calendar. Opened from inside a call it appears over the call, so the call keeps running.
- **In a call.** A module with a room panel adds a **Modules** button to the call toolbar (the puzzle piece), which lists the modules on for that room. Choose one and it opens as a column beside the video and the chat when the module supports that (video, chat, then the module), or as a floating panel over the call. Drag a docked column's left edge to change its width. The buttons in a pane's header switch it between docked and floating, open it in a window of its own, or close it. Several can be open at once, and each remembers how you had it. On a narrow window a module opens floating. If you pop the whole call out into its own window, docked modules float over the main window until it comes back.
- **Notifications.** A module can notify you, for example a reminder. It appears as a toast, and as a number on the module's header item and the Modules button until you open the module.

## Turn a module on in rooms

A module with a room panel is off in every room until you turn it on. Either tick **Available in every room** on its card here, or open a room's own page from the Rooms tab and tick the module under **Modules**. The Modules section of a room only lists modules that are enabled.

## Who can use it

An enabled module adds its permissions to the **Roles** tab, in a group named for the module. Untick one to take that ability from a role. Admins can always do everything, and a member marked Moderator in a room gets the Moderator role's permissions for a room module there. A module's data is stored per server or per room, and a person only sees a room's module data if they are in that room.

## Upgrade and roll back

Upload a newer version of the same module and it replaces the active one. Tavern keeps the newest three versions, so the card offers **Switch to this version** to go back, or forward again. The module's saved data stays as it is either way. An upgrade or switch that asks for something you have not yet approved comes back disabled, and shows **Approve and enable**.

## Disable and uninstall

**Disable** hides a module without losing anything, and takes its permissions off the Roles tab. **Uninstall** removes it and asks whether to keep its saved data, so a later reinstall picks up where it left off. Choosing to delete the data also removes its schedules and notifications.
