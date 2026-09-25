# Templates

**Audience:** the host admin making environments, a server operator starting a single environment, and an owner
whose environment uses a template or could.

A **template** sets an environment up for one use when it is made: what things are called, which modules are
on, how the Lobby reads, and how new spaces start. It is picked when the environment is made, and an owner or the
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

More templates may come later.

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

Some of it is applied once, when the environment is made: its settings, its modules, the Lobby and how new spaces
start. After that they are the owner's, like anything else in Manage. A template's modules go on in every space
except the Lobby, which keeps only the chat, the call and the modules made for it.

Its words, its home icon and the names and icons it gives modules keep following the template. Anything an owner
changes wins, and **Reset** goes back to the template's, not the default. Manage shows which is which:

- **Words**: a word the template set is marked "From the template", and a word the owner changed shows "The
  template's: <word>" beside it.
- **Home icon**: the template's is marked "Template's own".
- **Shown as**, on a module's card: "From the template"; **Reset** reads "Back to the template's name and icon".

Manage's **Template** tab says which one the environment uses ("Uses the Travel template.").

## Switch a template

An owner can switch the environment to another template, or to none, on Manage's **Template** tab:

1. Under **Template**, choose one in **Switch to** ("No template" is first). Its description shows below.
2. Click **Switch**, and confirm. Words, icons and module names change at once; anything you set yourself still
   wins. Nothing is turned off or removed.
3. The tab then shows **What the <name> template can add**:
   - **Turn on**: the template's modules that aren't on in every space yet, ticked. One your plan doesn't include
     is shown unticked, with why. Each goes on in every space except the Lobby.
   - **Also**, unticked: the template's name and description for the Lobby, and the picture profile new spaces
     start with.
4. Untick anything you don't want, then click **Apply** (**Done** when there is nothing to add). Only what is
   ticked is applied, and the offer closes even with nothing ticked.

**Not now** puts the offer away; a line saying "The <name> template can turn on more." and a **Review** button
bring it back, and the tab keeps a badge until you apply it. A template's settings (language, clock, currency and
the rest) are not offered: they are yours by now. Switching to **No template** puts the default words and icons
back (or your own) and changes nothing else. A switched template is never applied on its own; only what you
confirm is.

**The host admin** can do the same from the host console: on the **Environments** tab, each environment's card has
a **Template** choice and **Switch**, then the same offer, with **Review** to bring it back later.

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
