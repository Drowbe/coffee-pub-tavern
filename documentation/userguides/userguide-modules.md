# Modules

**Audience:** an admin adding, approving and removing add-on modules on a Coffee Pub Tavern server.

A module is a zip file that adds a feature to Tavern. The **Modules** tab on the Manage page installs
them. A module runs in your browser inside a sandbox, so it can only reach Tavern through what it asks
for, and it never runs code on your server.

Installing a module puts it on the server but does not show it to anyone yet; how a module appears at
the table, and where its own page or panel shows up, is not built yet.

## Install a module

1. On the Modules tab, choose the zip file and click **Install**.
2. Read the card that appears. It lists what the module asks for: permissions that will appear on the
   Roles tab, and whether it wants to run things on a schedule or send notifications.
3. Click **Enable** (or **Approve and enable**), which records that you approved exactly what is
   listed. A new module always starts disabled.

The zip can be up to 10 MB. Tavern refuses a zip that holds files it does not allow, links, unsafe
paths, too many or too large files, or a missing or invalid `module.json`, and says which.

## Turn it on in rooms

A module that has a room panel shows **Available in every room**. Choosing a single room is not built
yet.

## Upgrade and roll back

Upload a newer version of the same module and it replaces the active one. Tavern keeps the newest three
versions, so the card offers **Switch to this version** to go back, or forward again. The module's saved
data stays as it is either way. An upgrade or switch that asks for something you have not yet approved
comes back disabled, and shows **Approve and enable**.

## Disable and uninstall

**Disable** hides a module without losing anything. **Uninstall** removes it and asks whether to keep
its saved data, so a later reinstall picks up where it left off.
