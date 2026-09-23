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

- `src/shared/creatureCatalog.js` defines playable monsters, NPC animals, food, hazards, growth stages, diet gates, movement traits, and procedural skin metadata. Real species from `speciesCatalog.js` are folded into `CREATURE_CATALOG` at load, so they render and eat through the same tag/shape rules as the hand-authored monsters.
- `src/shared/speciesCatalog.js` holds ~176 real marine species as compact rows (common + scientific name, life-stage lengths, biome tags) and a builder that expands each into a full catalog entry. This is the file that grows the roster from dozens toward thousands — add rows, no rule changes.
- `src/shared/geography.js` is a pure, deterministic map from world `(x, y)` to a named region and a real depth zone (Sunlight → Hadal). Seas are contiguous longitude bands (a full lap is `WORLD_LAP` units) carrying real coordinates, ocean, whirlpool name, and a danger level; `geoPositionAt(x)` interpolates a real lat/lon for the globe minimap. Spawns are filtered by the biome at each point, and the HUD names where you are.
- `src/shared/gameWorld.js` owns deterministic simulation: endless active-area spawning (biome-filtered, life-stage-aware), movement, growth, player-vs-player eating, NPC adversaries, add-ons, shields, hazards, respawns, and leaderboard scoring. It is pure, browser-safe JavaScript so it runs identically on the server and in the client.
- `src/server/createServer.js` hosts the static client and runs the WebSocket protocol.
- `public/client.js` renders the game with Canvas and streams player input. It speaks one message protocol regardless of whether snapshots come from the server or the local offline session.
- `public/localGame.js` runs the shared `GameWorld` directly in the browser for offline solo play, emitting the same `hello`/`welcome`/`snapshot` messages the server does.
- `public/sw.js` is a service worker that precaches the full app shell so the game loads and plays with no network.
- `public/assets/creatures/scary-creature-atlas.png` provides the scary generated creature sprite atlas used by the picker and in-game renderer.

To add creatures, skins, or hazards, add catalog entries first. The world simulation and client renderer use `shape`, `visual`, `tags`, `diet`, and movement metadata rather than species-specific branches for gameplay rules. To add real species, append rows to `src/shared/speciesCatalog.js` — nothing else needs to change.

## Learning by absorption

The game teaches marine biology, geography, and scale without ever feeling educational — no popups, quizzes, or fact dumps. It rides entirely on labels and structure:

- **Real species, life-cycle labels.** NPCs are real animals labelled `Common Name · life phase · real size` (e.g. `Atlantic Herring · fry · 4 cm` → `· adult · 30 cm`). Kids absorb that animals grow through named sequences purely by reading the thing chasing or fleeing them. Labels are quiet and shown only on nearby, sizeable creatures — never a wall of text.
- **Biogeography.** The named seas are contiguous **longitude bands** along the endless x-axis, arranged as an eastward circumnavigation of the real globe (Sargasso → North Atlantic → Arctic → Southern Ocean → Pacific → home). Depth (y) never changes which sea you're in — that axis belongs to the depth zones. Species spawn where they actually live, so the fauna changes as you sail. The minimap is an **orthographic globe** centred on your real lat/lon: region homes are plotted at their true coordinates as colour-coded dots (by danger), the world turns beneath you as you swim, and hovering a near-side dot names the sea, its ocean, its danger, and its signature residents ("what lives in the Kelp Forest?"). A subtle HUD line names your region, zone, and depth.
- **Real names.** Maelstroms carry the real whirlpool names of their sea (Saltstraumen, Corryvreckan, Moskstraumen…); eating a creature shows its scientific name.

Reading level targets ~10–13: real terms (mesopelagic, bioluminescence) are used plainly and never defined on screen.

## Stage progression & oversized creatures

- **Regions carry a danger level (1–3)**, shown as ⚠ pips next to the sea's name. Dangerous seas (Mariana Approach, Antarctic Convergence) and deeper zones bias spawns toward bigger creatures — places to avoid early and hunt late.
- **The player is never permanently the biggest fish.** Once the nearest player outgrows a species' real adult size, that species occasionally spawns gameplay-oversized specimens sized *by radius* to rival the local apex player. Past ~5× real adult mass the label honestly reads `Giant …`, past ~25× `Monster …` (and drops the now-false real length). Oversized apex species genuinely hunt grown players; small species cap at 400× adult and stay spectacle.
- **Nothing materialises on-screen.** Spawn and cull distances scale with each player's streamed view (which itself grows with the creature), so creatures, hazards, and oversized specimens always swim into sight from beyond the view edge instead of popping into existence mid-screen. Apex hunters spawn just past the view edge marked on their target, stalking closer until normal perception takes over; the mark expires if the target dies and respawns small.
- **Threat rings & hover verdicts.** Other creatures wear a quiet dashed ring from the same diet rules the simulation eats with: red pulsing = it can eat you (always shown), green = you can eat it, amber = standoff — drawn only on creatures big enough that relative size alone is ambiguous. Hovering any creature adds the blunt comparison (`0.6× your mass · you can eat it`), so a huge-but-harmless filter feeder never reads as a predator.
- **Species log ("Creatures spotted")**: a field-guide panel (🐟 button bottom-left, or press `L`) records every species spotted and eaten, with Giant/Monster badges and `???` rows hinting where undiscovered species live. Discovery milestones grant achievement titles — progress that isn't tied to score. Stored per browser in localStorage.

## Net/render diagnostics

Press `` ` `` (backquote) or load with `?debug` to toggle an overlay showing snapshot cadence (avg/min/max gap — irregular gaps are what read as jitter), snapshot age, ping, cached entity counts, and hard position snaps (rubber-banding, also logged to the console). Remote entities are interpolated between the two most recent snapshots over the measured gap, which removes the 30 Hz tick / 24 Hz broadcast beat.

If the connection drops, your creature waits (stopped, still vulnerable) for 15 seconds; the client reconnects automatically and picks up where it left off. Player names are required before joining. Leaderboard scores are maintained server-wide by browser session so all clients see the same high-score table, including recent disconnected players.

## Offline play

The app installs a service worker on first visit that precaches the whole game (HTML, scripts, shared simulation modules, and sprite atlases). After that first load it works with no network: the client tries to reach the WebSocket server, and if it can't connect it silently falls back to a local solo game running the same simulation in the browser. A web app manifest makes it installable as a standalone app.

## Install on a Chromebook (no installer)

The game is a PWA, so a Chromebook can "install" it from the browser — no package or installer to run:

1. Deploy to a host served over **HTTPS** (e.g. `https://sea.peturs.net`). HTTPS is required for service workers and install; `localhost` also counts during development.
2. Open the site once in Chrome while online — the service worker caches everything.
3. Tap **Install on this device** (the button shown on the start screen), or use Chrome's **⋮ menu → Install / Save and share → Install page as app** / the install icon in the address bar.
4. The game gets a shelf/launcher icon and opens in its own window. From then on it launches and plays **offline**: cached shell + automatic fallback to the local solo game when the server isn't reachable.

Updates reach installed copies automatically: the server stamps `sw.js` with a fingerprint of the served files, and code is fetched network-first (the cache is only the offline fallback). If you host the files somewhere other than this server, bump the `vN` in `CACHE_VERSION` in `public/sw.js` on each release.

### Install on an iPad

iOS/iPadOS browsers are all WebKit and don't support the install prompt, so the **Install** button never appears there. Install is manual instead: open the site in **Safari**, then tap **Share → Add to Home Screen**. The start screen shows this hint automatically on iOS. The app then launches standalone with its own icon and works offline, same as on a Chromebook.

### Hosting a pure offline copy (optional)

`npm run start:offline` serves the client with **no** WebSocket world (HTTP only). The browser can't open a socket, so it goes straight to the local solo game. This is handy for hosting an offline-first copy anywhere static — including alongside the full multiplayer deployment.

## Save & resume (offline solo)

Offline solo runs are saved to `localStorage` (creature, mass, score). When a saved run exists, the menu offers to resume it — your creature is preselected and your run restarts at the size you left off. "Start fresh" clears the save. Live multiplayer never restores size, so you can't rejoin a shared world pre-grown.

## Hazards

There is no size at which you are safe. Size-independent hazards drift through the world:

- **Maelstrom** — a living vortex in a tug of war with everything it touches. It has its own mass: whatever it grinds off players and wildlife feeds it, and a fed vortex spins faster, grows wider, and pulls harder. But grow bigger than the storm (about 1.25× its mass) and the tug flips — you grind *it* down, gain part of what you tear away, and swallow it whole when it collapses.
- **Drift net** — a snare that slows anything caught in it and slowly strips mass until you swim free.

Because the drain is proportional to your mass, even an apex creature bleeds in a maelstrom that has outgrown it — there is always something to fear.

## Scale

Growth continues to a mass of 20,000,000 across late stages (Tide Sovereign → Ocean Incarnate → The Deep Itself → … → The Endless Deep). Past mid-game the camera zooms out more slowly than you grow, so a true giant visibly overflows the screen. Major NPC monsters render with the same photoreal sprite atlas as players (color-tinted per species) and swim with a procedural traveling-wave animation.

## Controls

- ESDF or WASD to move.
- Mouse position steers when no movement keys are pressed.
- Hold the mouse button or `Space` to boost.
- Mouse wheel / trackpad pinch zooms the camera in and out.
