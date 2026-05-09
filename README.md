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

- `src/shared/creatureCatalog.js` defines playable monsters, NPC animals, food, growth stages, diet gates, movement traits, and procedural skin metadata.
- `src/shared/gameWorld.js` owns deterministic simulation: endless active-area spawning, movement, growth, player-vs-player eating, NPC adversaries, add-ons, shields, respawns, and leaderboard scoring.
- `src/server/createServer.js` hosts the static client and runs the WebSocket protocol.
- `public/client.js` renders the game with Canvas and streams player input to the server.
- `public/assets/creatures/scary-creature-atlas.png` provides the scary generated creature sprite atlas used by the picker and in-game renderer.

To add creatures or skins, add catalog entries first. The world simulation and client renderer use `shape`, `visual`, `tags`, `diet`, and movement metadata rather than species-specific branches for gameplay rules.

Player names are required before joining. Leaderboard scores are maintained server-wide by browser session so all clients see the same high-score table, including recent disconnected players.

## Controls

- ESDF or WASD to move.
- Mouse position steers when no movement keys are pressed.
- Hold the mouse button or `Space` to boost.
