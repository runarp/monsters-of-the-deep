# Monsters of the Deep

A browser-based multiplayer underwater growth game built with Node.js, WebSockets, and Canvas.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Architecture

- `src/shared/creatureCatalog.js` defines playable monsters, NPC animals, food, hazards, growth stages, diet gates, movement traits, and procedural skin metadata.
- `src/shared/gameWorld.js` owns deterministic simulation: endless active-area spawning, movement, growth, player-vs-player eating, NPC adversaries, add-ons, shields, hazards, respawns, and leaderboard scoring. It is pure, browser-safe JavaScript so it runs identically on the server and in the client.
- `src/server/createServer.js` hosts the static client and runs the WebSocket protocol.
- `public/client.js` renders the game with Canvas and streams player input. It speaks one message protocol regardless of whether snapshots come from the server or the local offline session.
- `public/localGame.js` runs the shared `GameWorld` directly in the browser for offline solo play, emitting the same `hello`/`welcome`/`snapshot` messages the server does.
- `public/sw.js` is a service worker that precaches the full app shell so the game loads and plays with no network.
- `public/assets/creatures/scary-creature-atlas.png` provides the scary generated creature sprite atlas used by the picker and in-game renderer.

To add creatures, skins, or hazards, add catalog entries first. The world simulation and client renderer use `shape`, `visual`, `tags`, `diet`, and movement metadata rather than species-specific branches for gameplay rules.

Player names are required before joining. Leaderboard scores are maintained server-wide by browser session so all clients see the same high-score table, including recent disconnected players.

## Offline play

The app installs a service worker on first visit that precaches the whole game (HTML, scripts, shared simulation modules, and sprite atlases). After that first load it works with no network: the client tries to reach the WebSocket server, and if it can't connect it silently falls back to a local solo game running the same simulation in the browser. A web app manifest makes it installable as a standalone app.

## Save & resume (offline solo)

Offline solo runs are saved to `localStorage` (creature, mass, score). When a saved run exists, the menu offers to resume it — your creature is preselected and your run restarts at the size you left off. "Start fresh" clears the save. Live multiplayer never restores size, so you can't rejoin a shared world pre-grown.

## Hazards

There is no size at which you are safe. Size-independent hazards drift through the world:

- **Maelstrom** — a vortex that drags you inward and grinds away a percentage of your mass per second; it can pull a careless predator of any size to its death.
- **Drift net** — a snare that slows anything caught in it and slowly strips mass until you swim free.

Because the drain is proportional to your mass, even an apex creature bleeds in a maelstrom — there is always something to fear.

## Controls

- ESDF or WASD to move.
- Mouse position steers when no movement keys are pressed.
- Hold the mouse button or `Space` to boost.
