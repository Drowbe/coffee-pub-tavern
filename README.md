# Coffee Pub Tavern

Self-hosted voice and video for the table. One personal link per player, nothing to install, no
accounts. Every player is available to OBS as a separate Browser Source that the streamer lays out
freely. Built for recording Foundry VTT sessions alongside
[Coffee Pub Browser](https://github.com/Drowbe/coffee-pub-browser).

Status: design stage. See [DESIGN.md](DESIGN.md) for the plan, the pieces and the build stages.

## Pieces

- **LiveKit** media server (one container) with a built-in TURN relay.
- **Tavern** web app (Node, one container): the table page players use, a per-player view page for
  OBS, and an admin page for tables, players and links.
- A section in Coffee Pub Browser that creates the OBS sources in one click.
