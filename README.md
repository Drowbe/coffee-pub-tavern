# Coffee Pub Magpie

Voice and video for your tabletop game, on a server you run yourself. Each player signs in once, allows
camera and microphone, and is in the call, with nothing to install. Every player is also an OBS
Browser Source, so a recorded session shows their camera or a picture you chose.

## What it does

- Video and voice for the whole group in a browser, with grid, strip and spotlight layouts, chat with
  pictures, reactions, and a pop-out window.
- Spaces: a Lobby for everyone plus a space per game, with a launch link to each game's tabletop or wiki.
- Modules on the canvas beside the call, such as a calendar, a to-do list and polls, docked or floating.
- Step aside privately with one or more players, on or off the recording.
- Every player as their own transparent OBS source, with pictures for offline, online, talking and
  muted, on top of a Participant box and a Character box.
- Roles and permissions: admin, owner, moderator, member and guest, with a grid to decide what each can do.
- Guest links for someone dropping in once, with no account.
- Your own colors and icons, and add-on modules you can install from a zip.

## Requirements

- A machine that runs Docker, reachable from the internet, with a hostname for the app and one for the
  media server.
- HTTPS in front of both, because browsers only allow camera access over HTTPS.
- Ports for the media server forwarded to that machine.
- LiveKit 1.12 or newer, which the included `docker-compose.yml` pulls.
- Players need only a current browser. Chrome and Edge also offer the pop-out window.

## Install

Paste `docker-compose.yml` into Container Station on a QNAP, or run `docker compose up -d` anywhere
Docker runs, after replacing the `CHANGE_ME` values. The full walkthrough, including DNS, router and
proxy settings, is in the wiki's Getting Started guide.

## Where to read more

Documentation lives in the [wiki](https://github.com/Drowbe/coffee-pub-tavern/wiki): guides for running
a call and managing an environment, the OBS link reference for integrators, and the architecture.
It is the same material as the `documentation/` folder in this repository.

<!-- global:ai-assistance -->
## AI Assistance and the Illusion of Good Code

I started writing Foundry modules for use at my own table back in 2020. There were already a ton of amazing modules out there, but they either didn't quite do what I wanted or didn't deliver the kind of user experience I was looking for.

I've been a design leader for more than 20 years, but I spent the first half of my career as a developer, so building my own modules seemed like a fun way to kill some time. I'm a pretty good designer. I'm a decent developer. But, over time, my hand-written code and hacks got a little messy (and memory-leaky, and a little buggy. Feels good to say it out loud.).

Today, the Coffee Pub suite of modules is developed with AI assistance, primarily Claude and Cursor, for documentation, refactoring, debugging, and other development work. Every change is reviewed and committed by me, and nothing reaches a release that I haven't crawled and run at my own table. I can't seem to give up my IDE. The UX design, architecture, and ideas still come from my own fever dreams and chronic lack of sleep.

Testing and verifying a change means running it in Foundry so I can watch the console, break things, fix them, and hone the experience. The repositories carry a set of tools for testing the things that are difficult to catch through review and manual testing alone. They help ensure styles don't conflict, shared coding and documentation standards stay consistent, and the suite of modules continues to work well as a system without silently breaking.

Those checks are there because AI-assisted development can move very quickly, and without oversight, engagement, and planning, it can also go confidently off the rails and deliver the illusion of good code. The AI helps me build faster. It doesn't decide what gets built, its architecture, or how it should work. You can blame this human for that.

If the idea of AI-assisted development keeps you up at night or just isn't your jam, no worries at all. I get it. You do you.
<!-- /global:ai-assistance -->

## Licence and credits

Proprietary: Magpie is commercial software, not open source; all rights reserved (the license terms are coming, #72). It is built on [LiveKit](https://livekit.io) (Apache-2.0), Font Awesome Free (icons CC BY 4.0,
fonts SIL OFL 1.1, code MIT), MediaPipe through LiveKit's track processors, Express and Node.js. The
Manage page's About tab carries the full credits.
