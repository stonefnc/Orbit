# Orbit: a live 3D globe, built on free data

Orbit is a browser app that shows what is happening on Earth right now: aircraft, satellites, ships, public cameras,
weather, earthquakes, fires, conflicts and infrastructure, on one 3D globe that runs on a laptop or a phone. This is a
short account of what was built, the decisions that shaped it, and what it still can't do.

## The brief

Three goals, in order of how often they decided a question:

1. **Real data, honestly labelled.** Nothing simulated is presented as live, and every layer says what it does and doesn't
   cover. Where a source can't be had cleanly, the layer is left out and the reason is written down.
2. **Works on first launch with no keys.** Every optional key (ships, extra aircraft feeds, a fuller satellite catalog,
   better imagery) unlocks more, but the globe, the keyless layers and the cameras work from a fresh download.
3. **Smooth on a phone.** The map redraws only when something changed, not 60 times a second.

## What it is, in numbers

About 25,000 lines of TypeScript and CSS in the browser client (Cesium, Vite), about 8,000 in a small Express server that
fetches, merges and caches the feeds, more than 20 toggleable layers plus search, directions and a time machine, around 50 API
routes, 19 unit-test files (130 tests) and three Playwright browser suites run at desktop and phone size. It started in
May 2026 and took about 120 commits. It installs as a web app (PWA), builds into a stand-alone Windows app, and has no
hosted component: you run it yourself.

## How it is put together

- **The browser draws; the server fetches.** The client never talks to most providers directly. The server holds any
  keys, merges overlapping feeds, caches on disk, backs off after errors and serves the last good answer when an upstream
  is down. Keys are typed into a Keys menu that only works from the computer running Orbit, are never sent back to the
  page, and the release build runs with no env files, strips every key variable and scans its own output for token-shaped strings before it will finish.
- **Fallback chains instead of single sources.** Aircraft come from several community feeds, tried in order with
  per-provider cooldowns, and requests are quantised to a grid so panning and extra tabs share one upstream call.
  Satellite orbits fall through three providers and are served stale-while-revalidate so a blocked provider never leaves
  the layer empty.
- **Render on demand.** Cesium runs in request-render mode; every data path asks for a frame. Markers on the far side of
  the globe are hidden by a horizon test rather than disabling depth testing, which also keeps them from showing through
  the Earth. The wind layer is its own 2D canvas of 4,200 particles laid over the globe, advected from a coarse model grid.
- **Cameras go through a proxy that distrusts everything.** The browser only ever receives an Orbit address. The server
  fetches the still from a per-source allow-list over https, re-checks redirects, caps the size and checks the file's first
  bytes before passing it on. It sends Orbit's own user agent and nothing else: a source that blocks non-browser clients
  is left out instead of being spoofed past. Twenty-two agency feeds across North America, Europe, Hong Kong and New
  Zealand supply tens of thousands of cameras.

## Decisions worth explaining

- **Dropping what couldn't be done honestly.** One state's camera video needed a request that claimed another website as its
  origin, so only its stills stayed. A Singapore feed was skipped because its image links change on every update. Western
  Pacific cyclones were not added because one source refused an honest client and the other gave unlabelled track
  geometry with no live storm to test against. Each is recorded with the reason.
- **Coverage is stated in the app.** Clouds say "not the poles", street addresses say "US only", fire outlines say "US
  only", quakes admit that small ones outside the US may be missing. Adding Meteosat for Europe and Africa meant giving each
  satellite its own band of longitudes, which also removed an old grey smear where one satellite's edge overlapped the next.
- **A zero-key test.** A browser test starts both servers against an empty settings folder and checks that the globe loads,
  keyless layers work and keyed layers explain themselves instead of failing.
- **Terms are tracked per source.** Each feed's licence and attribution is recorded, shown in an in-app Credits sheet, and
  the app refuses to depend on keys it cannot ship.

## How it was built

Orbit was built with an AI coding assistant working in role-scoped sessions (globe and data, layers and server, shell and
QA, plus an overseer) in one repository. Docs came first: one document per area listing how it works, its contracts and
its rules, a registry of every shared name, a review queue of user-visible changes, and a log of decisions made without
sign-off. Commits were small and by path, a hook blocked destructive git commands, and a nightly script wrote a recap.
The result was cheaper sessions and a project that stayed understandable between them, at the cost of keeping the docs
true.

## What it can't do

- Ships are coastal only: the free AIS feed is land-based, and open-ocean coverage is satellite AIS, which is paid.
- There are no cameras in South America or Africa; every source found there needs a user's own key.
- Several feeds are the sites' own map endpoints, not documented APIs, and can change without notice.
- `src/main.ts` is large (about 5,500 lines) by choice; the layer code around it is modular.
- It is built to run on one person's computer. Hosting it for others would need accounts, a secrets store, per-user rate
  limits and a review of each provider's commercial terms.
