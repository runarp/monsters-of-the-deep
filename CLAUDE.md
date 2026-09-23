# Monsters of the Deep — LLM overview

Browser "eat-and-grow" game (agar.io-like) set in a real-world ocean. Players pick a monster, eat food / real marine species / other players to grow through 16 named stages (mass 14 → 20,000,000), and dodge hazards. Runs multiplayer over WebSockets, or fully offline in the browser (PWA) using the *same* simulation code. Audience is kids ~10–13: the game teaches marine biology and geography purely through labels, never popups or quizzes.

`README.md` is the developer readme; `user-guide.md` is the player-facing guide. Keep both in sync when gameplay numbers change.

## Commands

```bash
npm install
npm start              # multiplayer server + static client on :3000 (PORT env overrides)
npm run dev            # same, with node --watch
npm run start:offline  # static client only, no WebSocket → browser falls back to offline solo
npm test               # node --test (built-in runner, no framework); ~8 s, ~100 tests
```

- Node ≥ 20, ESM (`"type": "module"`). Only runtime dependency is `ws`. No bundler, no build step, no TypeScript, no linter.
- `.claude/launch.json` defines `monsters` and `monsters-offline` preview servers.
- Debug overlay: press `` ` `` or load with `?debug` (snapshot cadence, ping, hard snaps).
- `/health` returns JSON entity counts.

## Layout

| Path | Role |
|---|---|
| `src/shared/` | **Browser-safe, deterministic game logic.** Served to the browser as-is at `/shared/*` and imported by the server. No Node APIs here. |
| `src/shared/gameWorld.js` | `GameWorld` class: spawning, movement, NPC AI, hazards, eating, growth, scoring, snapshots. The heart of the game. |
| `src/shared/creatureCatalog.js` | Hand-authored playable monsters and legacy NPCs, food, add-ons, hazards, diet tiers, growth stages, traits, `canConsume` (the one eating rule), mass↔radius. Merges in the real species at load. |
| `src/shared/speciesCatalog.js` | ~176 real species as compact `s(...)` rows expanded into full catalog entries. To add a species, add a row; nothing else changes. |
| `src/shared/geography.js` | Pure map from `(x, y)` → region (longitude band, x axis) and depth zone (y axis). No RNG. |
| `src/shared/math.js`, `random.js` | Vector helpers; seeded RNG (`createRng(seed)`). |
| `src/server/createServer.js` | HTTP static server + WebSocket protocol, tick/broadcast loops, heartbeat, leaderboard persistence. |
| `src/server/index.js` / `static.js` | Entry points (multiplayer / HTTP-only). |
| `src/server/leaderboardStore.js` | JSON file persistence (`data/leaderboard.json`, or `LEADERBOARD_FILE`). Atomic temp+rename. |
| `public/client.js` | ~3k-line single-file renderer: Canvas drawing, input, interpolation, HUD, globe minimap, species log, event feed. No framework. |
| `public/localGame.js` | Offline session: runs `GameWorld` in the browser and emits the same messages as the server. Also save/resume and pause. |
| `public/sw.js` | Service worker: precache list + stale-while-revalidate. **Bump `CACHE_VERSION` when changing the cached asset list.** |
| `public/index.html`, `styles.css` | DOM overlay UI (join modal, HUD, minimap, leaderboard, species log). |
| `tests/` | `node:test` suites against the shared sim and the server. The client has no tests. |

## Core architecture

```
            ┌──── server (Node) ────┐          ┌──── browser ────────────────┐
            │ GameWorld.tick  30 Hz │  ws JSON │ client.js                   │
 input ───▶ │ getSnapshot()   24 Hz │ ───────▶ │  handleMessage → ingest →   │
            └───────────────────────┘          │  interpolate → Canvas draw  │
                        OR (offline)           │                             │
            localGame.js: same GameWorld,  ───▶│  same handleMessage()       │
            same message shapes, in-page       └─────────────────────────────┘
```

- **Server-authoritative, one code path.** The client never simulates. It renders snapshots for every entity, including the player's own creature (no client-side prediction). Offline mode swaps the transport and keeps the protocol: `transportSend()` picks the socket or `state.local`.
- **Protocol** (JSON over WebSocket):
  - client → server: `join {sessionId, name, creatureId}`, `input {x, y, boost}` (polled at 30 Hz, sent only on change plus a 250 ms keepalive), `ping`.
  - server → client: `hello {world, catalog, leaderboard}`, `welcome {playerId, …}`, `snapshot {now, self, players, npcs, addons, hazards, <food delta>, leaderboard?, events?}`, `error {code, message}`, `pong`. Offline only: `paused`/`resumed`, and `welcome.resumed`.
  - Snapshots are per viewer and cull entities to `viewRadiusForRadius(viewer.radius)`. `players` is not culled.
  - **Delta snapshots.** Each connection holds a `world.createViewState()`, which is passed to `getSnapshot(playerId, view)`. Food is sent as `food` + `foodKeyframe: true` the first time, then only as `foodAdded` / `foodMoved [[id,x,y]]` / `foodRemoved [id]`. `leaderboard` is included only when it changed. `client.js` `applyFoodDelta` rebuilds `snapshot.food` so the renderer always sees a full list. Calling `getSnapshot` without a view gives a full, undelta'd snapshot (tests use this).
  - Events: `world.eventsFor(events, playerId)` sends a player's own meals, pickups, shield blocks and apex-hunter warnings only to that player. Everything else is broadcast.
  - The socket uses permessage-deflate (level 1). `maxPayload` is 4 KiB, and messages are rate-limited per socket (dropped past 120/s, closed past 600/s).
- **Rendering.** `ingestSnapshot` keeps a `renderEntities` map keyed by `kind:id` with from→target poses, interpolated over the measured snapshot gap and then exponentially smoothed. A jump of more than max(700, 10·r) units is a "hard snap". Draw order is hazards, food, add-ons, then creatures sorted small→large.
- **Sessions.** `sessionId` lives in `sessionStorage`. A new `join` with the same sessionId kicks the old socket (close code 4001), so sessionIds are secrets. The leaderboard is keyed by sessionId internally, but `getLeaderboard()` only exposes `publicLeaderboardId(key)`, an opaque hash. When a socket drops, the player stays in the world for 15 s (`createSessionKeeper` in createServer.js), stopped but still vulnerable. A `join` from the same session with the same creature reclaims it (`welcome.reconnected`). A different creature, or the timeout, removes it.

## World model (things you must know before changing gameplay)

- **Endless plane.** x is unbounded; regions are 9000-unit longitude bands cycling through 10 real seas (`WORLD_LAP = 90,000`). y is bounded: surface `-6000` to floor `26000`, split into 5 real depth zones. Players spawn near origin (Sargasso, Sunlight zone). A legacy bounded-circle mode (`endless: false`) still exists in the code.
- **Active area only.** Entities exist only near alive players. `maintainPopulation` culls anything beyond each player's cull radius and spawns toward per-player targets (food 372, NPCs 44, add-ons 13, hazards 6 per player, capped by `max*`). The spawn/cull geometry scales with `viewRadiusForRadius(radius)` so things never pop in on screen. If you change view or zoom maths, keep spawn band < cull radius (spawn ≈ view × 1.25, cull ≈ view × 1.6).
- **Spawn selection.** `pickSpeciesForLocation` uses the biome pool (real species + `LEGACY_SPAWN_ENTRIES`) when it has ≥3 real species, otherwise falls back to `NPC_SPAWNS` / `NPC_DEEP_SPAWNS`. Pools are then biased toward the nearest player's prey and predators (`biasPoolForStage`, using `canConsume` on a typical-mass probe).
- **NPC mass** (`rollNpcMass`): a random life stage, upsized by zone depth × region danger, plus a chance of an **oversized** "Giant"/"Monster" specimen sized *by radius* to rival the nearest player (capped at 400× adult). This only happens outside that player's view.
- **Apex pressure** (`maintainApexPredators`): players ≥ 3100 mass with no predator in range get an apex hunter spawned just past the view edge, with `huntTargetId` so it tracks them beyond normal perception.
- **Eating** (`canConsume` in creatureCatalog.js — the single source of truth, also used by the client's threat rings and the spawn bias; the snapshot's `self.biteRatioBonus` lets the client pass the same bite bonus the sim uses):
  - Food: players eat any food ≤ 0.95× their mass (+ bite bonus). NPCs also need a diet-tag match.
  - Creatures: the consumer's *radius* must exceed the target's by `consumeRatio` (players ignore diet tags; NPCs need a diet match plus a mass ratio).
- **Growth** (`addMass`): gains × `playerGrowthEfficiency(mass)` (harmonic decay past 150, floor 0.25) × trait multiplier, capped per bite at 25% of body + 12. Food value fades by √(90/mass). NPC meal = 0.45 × digestion × victim mass; player kill = 0.44 × victim mass. **`tests/progression.test.js` pins 2–5 min per stage from Giant up.** Run it after any balance change.
- **Bonuses** (`getPlayerBonuses`): base values + add-ons + trait (`resolveTraitBonuses`, zone-aware). Recomputed on demand. That's cheap enough that it doesn't show up in profiles.
- **Collisions.** NPC feeding uses a per-tick `FoodGrid` (256-unit cells) that returns the same morsel a linear scan would (`tests/foodGrid.test.js`). Player collisions are still linear, which is fine because entity counts are capped. A tick is about 0.2–0.5 ms.
- **Hazards.** Maelstrom: has its own mass and plays tug-of-war. It drains you and grows, or if you are ≥ 1.25× its mass you grind it down and eat it. It is lethal when it drains you to base mass. It also feeds on NPCs. Drift net: slows you and drains mass, never lethal.
- **Add-ons** stack up to `maxStacks` and expire. Shield charges are derived from the active Pearl Shield add-ons (`shieldChargesFor`), so a charge expires with its add-on, and `spendShieldCharge` removes the add-on it uses.
- **Boost:** +36% speed, costs 0.6% mass/s, and needs mass > 1.12× base.
- **Scoring:** `mass×10 + meals×18 + kills×300`, high-water per session. The leaderboard keeps the best entry per sessionId, is pruned in memory to the top 500 plus online sessions once it passes 1000 rows, and persists the top 200 every 30 s and on shutdown. The Docker image declares `/app/data` as a volume for it, and runs as the `node` user.

## Offline / PWA specifics

- `localGame.js` pauses the sim when the tab is hidden, frozen, or idle for 30 s (the client reports idle via `setPaused`). It persists on pause and `pagehide`.
- Save (`localStorage["monstersOfTheDeep.solo"]`) is a *high-water* checkpoint per creature, so dying never shrinks it. Multiplayer never restores size.
- Species log is stored in `localStorage["monstersOfTheDeep.speciesLog"]`.
- Adding a new file that the client imports (JS module or sprite) means adding it to `PRECACHE_URLS` in `sw.js` **and** bumping `CACHE_VERSION`, or offline play breaks.

## Conventions

- Data-driven. New creatures, food, add-ons, hazards, and species go in the catalogs. The sim and renderer branch on `shape`, `tags`, `diet`, `movement`, and `visual`, not on species ids. A few intentional exceptions (`ancient_leviathan` spawn weights, `pearl_shield` rarity) are named constants in `gameWorld.js`.
- Catalog objects are `deepFreeze`d. Never mutate them at runtime.
- Comments explain *why* a tuning number is what it is, often with the bug it fixed. Preserve that style when you retune, and update the comment with the number.
- Code style: 2-space indent, double quotes, semicolons, `camelCase`, `SCREAMING_SNAKE` module constants, explicit `{}` blocks. No dependencies added lightly.
- `src/shared` must stay importable in both Node and the browser, with absolute `/shared/...` imports on the client side and relative imports inside `src/shared`.
- Tests construct `GameWorld({ seed, populate: false, max*: 0 })` and place entities by hand. Follow that pattern for deterministic tests.
- Learning-by-absorption rule: real names and real sizes in quiet labels only. No on-screen definitions, popups, or fact dumps.

## Known gaps / rough edges (as of 2026-09)

