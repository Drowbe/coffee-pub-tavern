# Coffee Pub Magpie

Self-hosted voice and video for a tabletop game, with tools beside the call (modules) and every
player as an OBS source. The repository is `coffee-pub-tavern`; the product is **Coffee Pub Magpie**.
Thomas owns the design, the architecture and what gets built. Claude helps build it; it doesn't
decide those.

## Stack and layout

- Node 22 and Express 5, LiveKit for media. No database, no front-end framework, no build step for
  the pages: plain HTML, CSS and JavaScript served as they are.
- `server/`: the app, the API, module hosting, storage, tenants and auth. Data is JSON in `DATA_DIR`.
- `public/`: the pages and their scripts; `public/sdk/` is the SDK modules use (`host.*`).
- `modules/<id>/`: bundled modules (`module.json` + `src/`), versions tracked in
  `tools/module-versions.json`. `node tools/build-module.mjs modules/<id>` builds a zip.
- `tools/check-*.mjs`: the checks. `documentation/`: architecture, api, designsystem, userguides,
  plans, TODO.md, known-issues.md, published to the GitHub wiki.

## Commands

- `npm run check`: every check. Run it before calling anything done.
- `npm run check:docs`: the documentation standard.
- `npm run docs:build`: builds the wiki pages into `tools/.wiki-build/` for review.
- Local server: `LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecretdevsecret ADMIN_PASSWORD=testpass1234 npm run dev`
  (port 3000; sign in as `admin`). Use `PORT=` and `DATA_DIR=/tmp/<name>` for a throwaway second
  server. There is no LiveKit server locally, so a real call can't be verified here; say so.

## Rules

- Read the plan in `documentation/plans/` and the matching architecture or API document before
  changing something they cover. The plan is the contract; if the code must differ, say so.
- Keep existing element ids, routes, API field names and stored keys unless the task is to change
  them. Nothing a person has stored or linked should break.
- Configuration goes in environment variables, never in code. A single-environment install (no
  `BASE_DOMAIN`) must keep behaving exactly as before.
- Colors come from the theme tokens (`documentation/designsystem/design-theme.md`). Reuse the SDK's
  pieces (`host.menu.show`, `host.toolbar.set`, `host.ui.viewSwitch`, the nav registry) rather than
  building new ones.
- Words a person reads: plain and short, and rooms are "spaces". The code keeps `room`.
- A changed module gets a version bump.
- Be exact about verification: "verified live", "checked by a tool" and "read as code only" are
  different claims.
- Don't commit, push or publish the wiki unless Thomas asks. He reviews and commits every change.

## Agents

`.claude/agents/` holds a team. **project-manager** runs the work (`/manage <task>` in any session, or
`claude --agent project-manager` in a terminal): **product-planner** drafts plans for Thomas to
decide (`/plan-feature <idea>` for a planning conversation), **experience-design** builds the front end and how it feels,
**server-development** builds `server/`, the API and the checks, **bug-fixes** fixes defects in any
layer, **quality-assurance** tests and reviews the result without changing code, and
**content-manager** writes the documentation, README and changelog. The flow: plan, Thomas approves,
build, QA, documentation, Thomas commits. Only product-planner writes plans, and only
content-manager edits the rest of `documentation/`, `CHANGELOG.md` and the README; the builders
describe their changes in their reports.
