# Templates

**Audience:** the host admin making environments, a server operator starting a single environment, and an owner
whose environment uses a template or could.

A **template** sets an environment up for one use when it is made: what things are called, which modules are
on, how the Lobby reads, how new spaces start, and, if it has them, its reactions, a theme and a set of icons. It is picked when the environment is made, and an owner or the
host admin can switch it later. An environment without one reads exactly as Magpie always has.

## The Travel template

The Travel template sets an environment up for planning trips together:

- Spaces are called **trips** everywhere people read them.
- The Lobby is called **Home base**, "Everyone on every trip."
- The Planner is shown as **Itinerary**.
- The Itinerary (Planner), Places, Maps, Research and the Calendar are turned on, with the chat and the call, in
  every trip. Home base keeps only the chat, the call and the Calendar, as the Lobby always does.
- The home icon is a rolling suitcase.
- A new trip starts with the **Participants** picture profile. The Lobby keeps its own profile.

More bundled templates may come later, and the host admin can make their own (below).

## Choose a template

**On a server with environments,** the host admin picks it on the host console:

1. On the **Environments** tab, click **New environment**.
2. Fill in the slug, the name and the first owner as usual.
3. Under **Template**, choose one ("None" is first, for an environment made without one).
4. Under **Plan**, choose the plan, or leave "No caps, every module".
5. Click **Create**.

When the host has templates, the product page's sign-up form offers the same choice to someone making their
own environment.

**On a single server,** set `TEMPLATE` in the compose file (for example `TEMPLATE: "travel"`) before the first
start, on a fresh data folder. It is used only when the environment is made: on a data folder that already has
an environment, or on a server with environments, it is ignored and the log says so. A `TEMPLATE` naming a
template the server doesn't have stops the start, and the log lists the ones it has.

## What a template does, and what stays yours

Some of it is applied once, when the environment is made: its settings, its modules, the Lobby, how new spaces
start, its reactions, its icons (added to the icon list) and its theme (added and made the one in use). After that they are the owner's, like anything else in Manage. A template's modules go on in every space
except the Lobby, which keeps only the chat, the call and the modules made for it.

Its words, its home icon and the names and icons it gives modules keep following the template. Anything an owner
changes wins, and **Reset** goes back to the template's, not the default. Manage shows which is which:

- **Words**: a word the template set is marked "From the template", and a word the owner changed shows "The
  template's: <word>" beside it.
- **Home icon**: the template's is marked "Template's own".
- **Shown as**, on a module's card: "From the template"; **Reset** reads "Back to the template's name and icon".

Manage's **Template** tab says which one the environment uses and its version ("Uses the Travel template.
Version 1").

## Switch a template

An owner can switch the environment to another template, or to none, on Manage's **Template** tab:

1. Under **Template**, choose one in **Switch to** ("No template" is first). Its description shows below.
2. Click **Switch**, and confirm. Words, icons and module names change at once; anything you set yourself still
   wins. Nothing is turned off or removed.
3. The tab then shows **What the <name> template can add**:
   - **Turn on**: the template's modules that aren't on in every space yet, ticked. One your plan doesn't include
     is shown unticked, with why. Each goes on in every space except the Lobby.
   - **Also**, unticked: the template's name and description for the Lobby, the picture profile new spaces
     start with, **Use its reactions** (this replaces the reactions you have), **Add and use the <name> theme**, and
     **Add its icons to the icon list**. Each shows only when the template has it and it isn't already yours.
4. Untick anything you don't want, then click **Apply** (**Done** when there is nothing to add). Only what is
   ticked is applied, and the offer closes even with nothing ticked.

**Not now** puts the offer away; a line saying "The <name> template can turn on more." and a **Review** button
bring it back, and the tab keeps a badge until you apply it. A template's settings (language, clock, currency and
the rest) are not offered: they are yours by now. Switching to **No template** puts the default words and icons
back (or your own) and changes nothing else. A switched template is never applied on its own; only what you
confirm is.

**The host admin** can do the same from the host console: on the **Environments** tab, each environment's card has
a **Template** choice and **Switch**, then the same offer, with **Review** to bring it back later.

## When a template is updated

The host admin can edit a template, and a new release can bring a new version of a bundled one. Its words, home
icon and module names and icons change at once in every environment using it; anything an owner set still wins.
The rest is offered, never forced:

1. Manage's **Template** tab reads "Version <N>, updated: review what's new", with a badge on the tab.
2. Click **Review**. The offer lists only what the template changed since you last applied or passed over it: a
   new module, new reactions, a new theme, new icons, a new Lobby or new-space profile.
3. Tick what you want and click **Apply**. Nothing is turned off or removed, and a part you turned down is not
   offered again until the template changes it.

## Make your own templates

On a server with environments, the host admin makes templates on the host console's **Templates** tab. It lists
every template with where it comes from (**Bundled**, **Yours** or **Imported**), its version, how many environments
use it, and whether it is hidden. Bundled templates come with Magpie and can't be edited or deleted.

**Make one:**

1. Click **New template**.
2. Give it an **Id** (lowercase letters, digits and dashes; it can't be changed later), a **Name** and a
   **Description**.
3. Fill in what it should set: **Words** (blank keeps the default; give the singular and the plural), the **Home
   icon**, the **Modules** and, under **Module names and icons**, what to show them as, and under **New
   environments** the **Lobby name**, **Lobby description** and what **New spaces use**.
4. If it should, tick **Give reactions** and add them, click **Choose a theme file…** to give it a theme (a
   `.magpie-theme.json` file, see [userguide-themes](userguide-themes.md)), and list **Icons** by their Font Awesome
   names, separated by spaces.
5. Click **Save**. It is version 1, and offered on the create form straight away.

**Edit one:** click **Edit** on its row, change what you need, and click **Save**. Each save is a new version.
Every environment using it gets the words, home icon and module names and icons at once, and is offered the rest
(see "When a template is updated").

**Hide one:** tick **Hidden** on its row. It is no longer offered for new environments, on sign-up or for a
switch; the environments using it keep it. Untick it to offer it again.

**Delete one:** click **Delete** and confirm. A template an environment uses can't be deleted ("In use by <environments>.
Hide it instead."): hide it, or switch those environments to another first.

**Import a file:** click **Import…** and choose a `.magpie-template.json` file. If a template already has its id,
you are asked for another. Anything in the file Magpie doesn't know is left out and listed. It keeps the file's
version.

**Export one:** click **Export** on any row, a bundled one included. To start your own from a bundled template,
export it, change its `id` and `name` in the file (or give a new id when asked), and import it.

## Template files

A template can travel as a file, `<name>.magpie-template.json`, of at most 64 KB. Its theme travels inside it.
Magpie refuses a file it can't read ("That isn't a Magpie template file.") and one from a newer Magpie ("This
template was made by a newer version of Magpie.").

**The owner of a single server** has **Template files** on Manage's **Template** tab:

1. **Export** saves the template the environment uses.
2. **Import…** adds a template from a file; you are asked for a new id if its id is taken. It is then among the
   choices under **Switch to**; switch to it to use it.
3. Each imported template is listed with its version, its own **Export**, and **Delete**. The one in use can't be
   deleted: switch to another first.

**An owner on a server with environments** has only **Export**, for the template their environment uses, for
example to take it to a single server. The host admin manages the templates there.

## Modules a template couldn't turn on

A template may list a module the environment can't have yet. It leaves it off and says why:

- **Not in the plan**: the environment's plan doesn't include it. The host can change the plan.
- **Needs** another module that was left off: turn that one on first.
- **Not on yet**: Research needs the AI service, so it waits until the service is set up and turned on.

The environment's card on the host console and Manage's **Template** tab list each one with how to fix it.
Turning it on later, once that is fixed, is the same as turning on any module.

## Backups

A backup carries the record of the template the environment uses, and a restore brings it back. The host
console reads the template from the environment itself.
