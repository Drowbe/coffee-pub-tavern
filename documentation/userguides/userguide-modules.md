# Modules

**Audience:** an admin adding, approving and removing add-on modules on a Coffee Pub Magpie server, and the people who use them.

A module is a zip file that adds a feature to Magpie, such as the [Calendar](userguide-calendar.md). The **Modules** tab on the Manage page installs them. Modules that come with Magpie run in the page. A module you upload runs in a sandbox, so it can only reach Magpie through what it asks for; it never runs code on your server. Each card says "In the page" or "Sandboxed". You can switch an uploaded module to run in the page, which lets it work with drag and drop between modules, but such a module can read and change everything on the page and act as you, so do it only for a module you trust. The tab also lists recent activity, which is kept when the server restarts, and shows when a module was slowed for doing something too often (the limits are generous; only a module that loops or floods reaches them). If you are writing one, read [api-module-sdk](../api/api-module-sdk.md).

Chat and Conference are listed first on the Modules tab as built-in modules; they cannot be removed, and their permissions are the ones already on the Roles tab. Chat is always on. Conference has a switch: **Disable** stops video and audio for everyone in every room (chat, presence and modules keep working), and **Approve and enable** turns it back on. It needs a LiveKit server while it is on. Turned off, nobody has the "See and join the conference" permission, whatever the Roles tab says, and the Roles tab keeps their ticks for when it is turned on again.

## Modules that come with Magpie

A module can need another: Maps needs Places. Its card says what it needs and its Enable button waits until that is installed and on; turning off a module others need asks first and turns them off too, and uninstalling one turns them off as well.

The Calendar, To-do, Polls, Planner, Places, Maps, Research, Assistant and Stream modules ship with the server, so there is no zip to upload. Stream (the browser sources for a streaming program, see [Magpie in OBS](userguide-obs.md)) is installed and turned on by itself the first time a server starts with it, so no stream goes dark on an update; the others wait for you. The Modules tab lists the ones you have not installed under **Available with this server**, each with an **Install** button. When you update the server and a module it carries has a newer version than the one you have installed, the module's card shows **Update available** with an **Update to** button, the Modules tab itself shows the count in a small bubble, and the settings gear in the header shows the same count as a small badge on every page (admins only), so you see it without opening Manage. The badge goes away once the updates are applied. The update keeps the module's data, keeps the old version so you can switch back, and, if it asks for anything new (a permission, a hook, a link to another module), stays off until you approve it. A module you upload yourself is updated by uploading a newer zip.

## Install a module

1. On the Modules tab, choose the zip file and click **Install**.
2. Read the card that appears. It lists what the module asks for: permissions that will appear on the Roles tab, and whether it wants to run things on a schedule or send notifications.
3. Click **Enable** (or **Approve and enable**), which records that you approved exactly what is listed. A new module always starts disabled.

The zip can be up to 10 MB. Magpie refuses a zip that holds files it does not allow, links, unsafe paths, too many or too large files, or a missing or invalid `module.json`, and says which. (The modules that ship with Magpie can also be built into a zip with `node tools/build-module.mjs modules/<name>`, which writes it to `modules/dist/`.) The Calendar zip, if you build it, is at `modules/dist/calendar-1.5.0.zip`.

## Where a module shows up

- **On the dashboard.** A module with a widget adds a card to the dashboard on the rooms page, and its heading opens the module's own page. A module with its own page and no widget adds an item to the header instead, for everyone who may see it. Opened from inside a call a page appears over the call, so the call keeps running.
- **In a call.** A module with a room panel adds a **Modules** button to the call toolbar (the puzzle piece). Its menu opens just above the button and lists Chat and the modules on for that room, and it is the one place to show or hide them; the button shows an unread count for the chat and for module notifications. Choose one and it opens as a column beside the video and the chat when the module supports that (video, chat, then the module), or as a floating panel over the call. Drag a docked column's left edge to change its width. The buttons in a pane's header switch it between docked and floating, open it in a window of its own, or close it; a floating pane's **Snap to a grid** button makes it tile into a grid over the call instead of floating freely (see the table guide). Several can be open at once, and each remembers how you had it. On a narrow window a module opens floating. If you pop the whole call out into its own window, the panes come with it.
- **Notifications.** A module can notify you, for example a reminder. It appears as a toast, and as a number on the module's dashboard card heading (or its header item, for a module without a widget) and on the Modules button until you open the module.

## Turn a module on in rooms

A module with a room panel is off in every room until you turn it on. Either tick **Available in every room** on its card here, or open a room's own page from the Rooms tab, go to its **Modules** tab (it appears when there are modules to set) and tick the module. The Modules section of a room only lists modules that are enabled.

## Settings

A module can offer settings. There are three kinds. **Server** settings, for everyone, are chosen by an admin on the module's own page: choose **Module Configuration** on its card on the Modules tab. A module with no server settings shows the button greyed out, with "No settings" beside it. **Room** settings, for one room, are chosen by an admin (on the **Modules** tab of the room's own page, under the module list) or by a member ticked as a moderator in that room (from the sliders-with-gears button on the room's card on the rooms page). **Your own** settings, how a module behaves for you, are on your profile page under Module settings. Every setting has a default, so nothing needs setting. A change to the server's or a room's settings shows in the Modules tab's recent activity.

## Who can use it

An enabled module adds its permissions to the **Roles** tab, in a group named for the module. Untick one to take that ability from a role. Admins can always do everything, and a member marked Moderator in a room gets the Moderator role's permissions for a room module there. A module's data is stored per server or per room, and a person only sees a room's module data if they are in that room.

## Upgrade and roll back

Upload a newer version of the same module and it replaces the active one. Magpie keeps the newest three versions. The card has a version picker with the running one selected; choose another and **Switch to this version** goes back, or forward again. The module's saved data stays as it is either way. An upgrade or switch that asks for something you have not yet approved comes back disabled, and shows **Approve and enable**.

## Disable and uninstall

**Disable** hides a module without losing anything, and takes its permissions off the Roles tab. **Uninstall** removes it and asks whether to keep its saved data, so a later reinstall picks up where it left off. Choosing to delete the data also removes its schedules and notifications.

## Filters

At the top of the Modules tab, **All**, **Updates available** and **Configurable** choose which modules are listed. Updates available shows only the modules with a newer version waiting; Configurable shows only the modules that have settings you can choose for the server (the ones with an enabled **Module Configuration** button). Each chip shows how many modules it holds.

## Recent activity

Under the filters, **Recent activity** lists what modules have done lately, newest first, in a box that scrolls: the time, the module, what it did and who for. A line about something Magpie refused or slowed is tinted and has a warning mark.

## The AI service

Some modules can ask an AI to summarise, answer a question, or write a card from what a person selects. The **AI service** card on the Modules tab shows whether it is on, which service and model, and this month's use. Its **AI Configuration** button opens the page where you set it up, once for the whole environment. Nothing works until you do, and Magpie ships no model and no key.

- **Source:** one **Managed** entry per company the host offers (its own key, a model chosen for it), or **Custom**, a service and key of this environment's own with the fields below. The host offers a company when its key is there: on the host console's Managed AI panel, or from the server's `AI_OPENAI_KEY` and `AI_ANTHROPIC_KEY` environment variables (the only way on a single server, where the operator is the admin); nothing else needs setting, and the model can be changed on the console. Changing the source or the company switches AI off until you enable it again, since a different company would receive what people select. The monthly allowance and this month's use are this environment's own either way.
- **Service** (custom): None (the default), **OpenAI**, **Anthropic**, or **Other (OpenAI-compatible)**. For OpenAI and Anthropic you only choose the company: Magpie knows where to send the request. Other is for a model you run yourself (Ollama, LM Studio, llama.cpp, vLLM) or another company's service that speaks the OpenAI interface, and asks for its address. Each choice says under it what is sent and to whom: with a hosted service, the items a person selects and their question go to that company under its terms; with your own model, nothing leaves your network. Only what a person selects is sent, never another room.
- **Workspace id** (Anthropic only): needed for a key made at the organisation level in the Anthropic console, which Anthropic then asks to name a workspace; a key made inside a workspace needs nothing here. The host sets the same for its managed Anthropic service (`AI_ANTHROPIC_WORKSPACE`, or the console's AI tab).
- **Model:** chosen from a list, not typed. Once the key is set (or the address, for Other), the panel asks the company which models it offers and lists them; **Refresh** asks again. If the list can't be loaded, the panel says why and offers **Type a model name instead**.
- **Enable:** setting a service up does not turn the AI on. On the **AI service** card of the Modules tab (as on any module), **Approve and enable** turns it on for every module that uses it, after saying what will be sent and to whom; **Disable** turns it off again and keeps your setup. The card on the Modules tab says On, Not enabled or Off.
- **Key** (custom): kept on the server and never shown again. The panel says only whether one is set. **Set a key** or **Replace the key** takes a new one; **Remove the key** deletes it. The host's own keys, for the managed services, are on the host console, where a row says so if its key comes from the server's environment (`AI_OPENAI_KEY`, `AI_ANTHROPIC_KEY`).
- **Monthly allowance:** a number of tokens for the month, or 0 for no limit. The panel shows how many were used this month, in how many calls and for which tasks.
- **Who may use it:** the Roles tab has **Use AI in modules** under AI. It is off for every role until you tick it, admins always may, and guests never can (the tick is greyed out for them).
- **Per room:** on a room's settings, in its **Modules** tab under **AI**, **Turn AI off in this room** stops it there whatever the roles say.
