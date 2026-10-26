import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATURE_CATALOG, PLAYABLE_CREATURE_IDS, PLAYER_MAX_MASS, radiusForCreature } from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";
import { OCEAN_FLOOR_Y, OCEAN_SURFACE_Y } from "../src/shared/geography.js";

function emptyWorld(options = {}) {
  return new GameWorld({
    seed: "safe-spawns",
    populate: false,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0,
    ...options
  });
}

function grow(player, mass) {
  player.mass = mass;
  player.radius = radiusForCreature(player.creatureId, mass);
}

// Deliberately assert the gameplay contract independently of the placement
// helper: a regression in that helper must not also change the test oracle.
function assertClear(player, entity) {
  const gap = Math.hypot(entity.x - player.x, entity.y - player.y);
  const required = player.radius + entity.radius + Math.max(350, player.radius * 0.25);
  assert.ok(gap + 1e-6 >= required,
    `${entity.creatureId ?? entity.hazardType ?? entity.id} spawned ${gap.toFixed(2)} away from ${player.name}; needs ${required.toFixed(2)}`);
}

function assertWorldSafe(world, { includeHazards = false } = {}) {
  for (const player of world.players.values()) {
    if (!player.alive) {
      continue;
    }
    const entities = [...world.npcs.values(), ...(includeHazards ? world.hazards.values() : [])];
    for (const entity of entities) {
      assertClear(player, entity);
      if (world.endless) {
        assert.ok(entity.y - entity.radius >= OCEAN_SURFACE_Y - 1e-6);
        assert.ok(entity.y + entity.radius <= OCEAN_FLOOR_Y + 1e-6);
      } else {
        assert.ok(Math.hypot(entity.x, entity.y) + entity.radius <= world.radius + 1e-6);
      }
    }
  }
}

test("every NPC species rejects or relocates an explicit spawn on a player", () => {
  const world = emptyWorld();
  const player = world.addPlayer({ name: "Spawn guard" });
  player.x = 0;
  player.y = 2000;
  for (const creature of Object.values(CREATURE_CATALOG).filter((entry) => !entry.playable)) {
    world.spawnNpc(creature.id, { x: player.x, y: player.y });
    assertWorldSafe(world);
    world.npcs.clear();
  }
});

test("NPC placement protects every player, including one away from the focus", () => {
  const world = emptyWorld();
  const focus = world.addPlayer({ name: "Focus" });
  const neighbour = world.addPlayer({ name: "Neighbour" });
  Object.assign(focus, { x: 0, y: 2000 });
  Object.assign(neighbour, { x: 3000, y: 2000 });
  world.pickFocusPoint = () => focus;
  world.randomSpawnPoint = () => ({ x: neighbour.x, y: neighbour.y });
  world.spawnNpc("ancient_leviathan");
  assertWorldSafe(world);
});

test("ordinary population waves retain safe clearance at large player sizes", () => {
  for (const mass of [14, 3100, 200_000, 20_000_000]) {
    const world = emptyWorld({ seed: `wave-${mass}`, maxNpcs: 44 });
    const player = world.addPlayer({ name: "Growing" });
    grow(player, mass);
    player.y = OCEAN_FLOOR_Y - player.radius - 10;
    for (let wave = 0; wave < 20; wave += 1) {
      world.maintainPopulation();
      assertWorldSafe(world);
    }
    assert.ok(world.npcs.size > 0, "safe water must still receive wildlife");
  }
});

test("apex hunters cannot collapse onto the player at either ocean boundary", () => {
  for (const [edge, angle] of [[OCEAN_SURFACE_Y + 200, Math.PI * 1.5], [OCEAN_FLOOR_Y - 200, Math.PI / 2]]) {
    const world = emptyWorld({ seed: `apex-${edge}` });
    const player = world.addPlayer({ name: "Boundary" });
    grow(player, 50_000);
    Object.assign(player, { x: 0, y: edge });
    const randomFloat = world.rng.float.bind(world.rng);
    world.rng.float = (min, max) => min === 0 && max === Math.PI * 2 ? angle : randomFloat(min, max);
    const hunter = world.spawnApexHunter(player);
    assertWorldSafe(world);
    if (hunter) {
      assert.equal(hunter.huntTargetId, player.id);
      assert.ok(hunter.radius >= player.radius * 1.08 - 1e-6);
    }
  }
});

test("apex hunters are checked using their final size before insertion", () => {
  const world = emptyWorld();
  const player = world.addPlayer({ name: "Titan" });
  grow(player, 800_000);
  Object.assign(player, { x: 0, y: 8000 });
  const inserted = [];
  const set = world.npcs.set.bind(world.npcs);
  world.npcs.set = (id, entity) => {
    inserted.push({ id, radius: entity.radius, mass: entity.mass });
    assertClear(player, entity);
    return set(id, entity);
  };
  const hunter = world.spawnApexHunter(player);
  assert.ok(hunter, "a hunter can spawn in an otherwise empty ocean");
  const entry = inserted.find((entity) => entity.id === hunter.id);
  assert.equal(entry.radius, hunter.radius, "the hunter must not grow after its spawn clearance was checked");
  assert.equal(entry.mass, hunter.mass);
  assertWorldSafe(world);
});

test("new players do not join inside existing wildlife or hazards", () => {
  const world = emptyWorld();
  const npc = world.spawnNpc("ancient_leviathan", { x: 0, y: 0 });
  world.spawnHazard("maelstrom", { x: 500, y: 0 });
  const randomSpawnPoint = world.randomSpawnPoint.bind(world);
  let attempts = 0;
  world.randomSpawnPoint = (...args) => ++attempts === 1 ? { x: npc.x, y: npc.y } : randomSpawnPoint(...args);
  const player = world.addPlayer({ name: "Arriving" });
  assert.ok(player);
  assert.equal(player.alive, true);
  assertWorldSafe(world, { includeHazards: true });
});

test("respawning players avoid wildlife, hazards and other living players", () => {
  const world = emptyWorld();
  const survivor = world.addPlayer({ name: "Survivor" });
  const respawning = world.addPlayer({ name: "Returning" });
  Object.assign(survivor, { x: 0, y: 2000 });
  respawning.alive = false;
  respawning.respawnAt = world.now + 1;
  world.spawnNpc("ancient_leviathan", { x: 1400, y: 2000 });
  world.spawnHazard("maelstrom", { x: -1400, y: 2000 });
  world.randomSpawnPoint = () => ({ x: survivor.x, y: survivor.y });
  world.respawnPlayer(respawning);
  if (respawning.alive) {
    assertClear(respawning, survivor);
    assertWorldSafe(world, { includeHazards: true });
  } else {
    assert.ok(respawning.respawnAt > world.now);
  }
});

test("crowded bounded worlds defer NPCs and hunters without unsafe fallback", () => {
  const world = emptyWorld({ endless: false, radius: 500, maxNpcs: 8 });
  const player = world.addPlayer({ name: "No water" });
  Object.assign(player, { x: 0, y: 0 });
  grow(player, 20_000_000);
  assert.equal(world.spawnNpc("ancient_leviathan", { x: 0, y: 0 }), null);
  assert.equal(world.spawnApexHunter(player), null);
  world.maintainPopulation();
  assert.equal(world.npcs.size, 0);
  assert.equal(world.drainEvents().filter((event) => event.type === "apex_hunter").length, 0);
});

test("initial population stops retrying when safe NPC placement is impossible", () => {
  const world = emptyWorld({ endless: false, radius: 500, maxNpcs: 8 });
  const player = world.addPlayer({ name: "Crowded" });
  Object.assign(player, { x: 0, y: 0 });
  grow(player, 20_000_000);
  let attempts = 0;
  const spawnNpc = world.spawnNpc.bind(world);
  world.spawnNpc = (...args) => {
    attempts += 1;
    // Prevent a broken while-loop from hanging the entire test runner.
    assert.ok(attempts <= 500, "populateInitial must bound its retry count");
    return spawnNpc(...args);
  };
  world.populateInitial();
  assert.equal(world.npcs.size, 0);
});

test("overcrowded joins fail cleanly without registering an overlapping player", () => {
  const world = emptyWorld({ endless: false, radius: 500 });
  const blocker = world.addPlayer({ name: "Occupant" });
  Object.assign(blocker, { x: 0, y: 0 });
  grow(blocker, 20_000_000);
  world.drainEvents();
  assert.throws(() => world.addPlayer({ name: "Waiting" }), { code: "spawn_blocked" });
  assert.equal(world.players.size, 1);
  assert.equal(world.drainEvents().filter((event) => event.type === "player_joined").length, 0);
});

test("saved solo mass is cleared at its restored size on initial placement", () => {
  const world = emptyWorld();
  world.spawnNpc("ancient_leviathan", { x: 0, y: 0 });
  const randomSpawnPoint = world.randomSpawnPoint.bind(world);
  let attempts = 0;
  world.randomSpawnPoint = (...args) => ++attempts === 1 ? { x: 700, y: 0 } : randomSpawnPoint(...args);
  const player = world.addPlayer({ name: "Saved titan", startingMass: 800_000 });
  assert.equal(player.mass, 800_000);
  assert.equal(player.radius, radiusForCreature(player.creatureId, 800_000));
  assertWorldSafe(world);
});

test("every maximum-size saved creature can join a populated ocean safely", () => {
  for (const creatureId of PLAYABLE_CREATURE_IDS) {
    const world = new GameWorld({ seed: `restored-max-${creatureId}` });
    const player = world.addPlayer({ name: "Saved giant", creatureId, startingMass: PLAYER_MAX_MASS });
    assert.equal(player.mass, PLAYER_MAX_MASS);
    assert.ok(player.y - player.radius >= OCEAN_SURFACE_Y);
    assert.ok(player.y + player.radius <= OCEAN_FLOOR_Y);
    assertWorldSafe(world, { includeHazards: true });
  }
});

test("endless join fallback checks existing players, wildlife and hazards after exhausting random points", () => {
  const world = emptyWorld();
  const npc = world.spawnNpc("ancient_leviathan", { x: 6000, y: 2000 });
  const hazard = world.spawnHazard("maelstrom", { x: 8000, y: 2000 });
  const neighbour = world.addPlayer({ name: "Neighbour" });
  Object.assign(neighbour, { x: 12_000, y: 15_000 });
  grow(neighbour, PLAYER_MAX_MASS);
  let attempts = 0;
  world.randomSpawnPoint = () => {
    attempts += 1;
    return { x: npc.x, y: npc.y };
  };
  const player = world.addPlayer({ name: "Fallback", startingMass: PLAYER_MAX_MASS });
  assert.ok(attempts > 1, "the retry path must actually be exercised");
  assertClear(player, npc);
  assertClear(player, hazard);
  assertClear(player, neighbour);
  assertClear(neighbour, player);
  assert.ok(player.y - player.radius >= OCEAN_SURFACE_Y);
  assert.ok(player.y + player.radius <= OCEAN_FLOOR_Y);
});

test("NPC retries reject invalid coordinates and never insert an oversized body outside the ocean", () => {
  const world = emptyWorld();
  world.randomSpawnPoint = () => ({ x: Number.NaN, y: 0 });
  assert.equal(world.spawnNpc("silver_sardine", { x: Number.NaN, y: 0 }), null);
  assert.equal(world.spawnNpc(), null);
  assert.equal(world.spawnNpc("ancient_leviathan", { x: 0, y: 0 }, { mass: 1e15 }), null);
  assert.equal(world.npcs.size, 0);
});

test("failed respawns remain dead and retry only after space opens", () => {
  const world = emptyWorld({ endless: false, radius: 1500 });
  const blocker = world.addPlayer({ name: "Blocker" });
  const returning = world.addPlayer({ name: "Returning" });
  Object.assign(blocker, { x: 0, y: 0 });
  grow(blocker, 20_000_000);
  returning.alive = false;
  returning.respawnAt = world.now;
  world.drainEvents();
  world.respawnPlayer(returning);
  assert.equal(returning.alive, false);
  assert.ok(returning.respawnAt > world.now);
  assert.equal(world.drainEvents().filter((event) => event.type === "player_respawned").length, 0);
  world.removePlayer(blocker.id);
  world.respawnPlayer(returning);
  assert.equal(returning.alive, true);
  assert.equal(returning.respawnAt, null);
});

test("dead players do not unnecessarily block safe NPC placement", () => {
  const world = emptyWorld();
  const player = world.addPlayer({ name: "Gone" });
  Object.assign(player, { x: 0, y: 2000, alive: false });
  const npc = world.spawnNpc("silver_sardine", { x: player.x, y: player.y });
  assert.ok(npc);
  assert.equal(npc.x, player.x);
  assert.equal(npc.y, player.y);
});
