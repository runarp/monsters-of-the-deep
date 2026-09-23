import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canConsume,
  getCreatureDefinition,
  getGrowthStage,
  PLAYER_FULL_SCREEN_MASS,
  PLAYER_MAX_MASS,
  radiusForCreature
} from "../src/shared/creatureCatalog.js";
import { OCEAN_FLOOR_Y, OCEAN_SURFACE_Y, zoneAt } from "../src/shared/geography.js";
import { GameWorld, publicLeaderboardId } from "../src/shared/gameWorld.js";

function npcBaseMass(creatureId) {
  return getCreatureDefinition(creatureId).baseMass;
}

function emptyWorld() {
  return new GameWorld({
    seed: "test-world",
    populate: false,
    endless: false,
    radius: 1200,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0
  });
}

describe("game world simulation", () => {
  test("players must have a name", () => {
    const world = emptyWorld();

    assert.throws(() => {
      world.addPlayer({ name: "   ", creatureId: "abyssal_serpent" });
    }, /Player name is required/);
  });

  test("players eat starter food and gain mass", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Ada", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.invulnerableUntil = 0;
    const beforeMass = player.mass;

    const food = world.spawnFood("plankton", { x: 0, y: 0 });
    world.tick(16);

    assert.equal(world.food.has(food.id), false);
    assert.ok(player.mass > beforeMass);
  });

  test("starter growth is fast enough to matter immediately", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Ada", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.invulnerableUntil = 0;

    const beforeMass = player.mass;
    world.spawnFood("reef_minnow", { x: 0, y: 0 });
    world.tick(16);

    assert.ok(player.mass >= beforeMass + 12);
  });

  test("grown players still consume tiny food instead of dragging it along", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Ada", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.mass = 340;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = 0;

    const food = world.spawnFood("plankton", { x: 0, y: 0 });
    world.tick(16);

    assert.equal(world.food.has(food.id), false);
  });

  test("player movement responds quickly to fresh input", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Dash", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    world.setPlayerInput(player.id, { x: 1, y: 0 });

    for (let index = 0; index < 4; index += 1) {
      world.tick(50);
    }

    assert.ok(player.x > 35);
    assert.ok(player.vx > 180);
  });

  test("small players cannot consume very large creatures", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Nori", creatureId: "reef_leviathan" });
    player.x = 0;
    player.y = 0;
    player.invulnerableUntil = 10_000;

    const whale = world.spawnNpc("blue_whale", { x: 0, y: 0 });
    world.tick(16);

    assert.equal(world.npcs.has(whale.id), true);
    assert.equal(player.alive, true);
  });

  test("players consume visibly smaller NPCs instead of carrying them on contact", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Nori", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.mass = 32;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = 0;

    const sardine = world.spawnNpc("silver_sardine", { x: 0, y: 0 });
    sardine.vx = 0;
    sardine.vy = 0;
    sardine.mass = 24;
    sardine.radius = radiusForCreature(sardine.creatureId, sardine.mass);
    sardine.ai = { x: 0, y: 0, retargetAt: 10_000 };

    world.tick(16);

    assert.equal(world.npcs.has(sardine.id), false);
    assert.ok(player.mass > 32);
  });

  test("smaller-radius NPCs cannot eat larger players and are consumed on contact", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Ray", creatureId: "reef_leviathan" });
    player.x = 0;
    player.y = 0;
    player.mass = 800;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = 0;

    const shark = world.spawnNpc("mako_shark", { x: 1, y: 0 });
    shark.vx = 0;
    shark.vy = 0;
    shark.mass = 950;
    shark.radius = radiusForCreature(shark.creatureId, shark.mass);
    shark.ai = { x: 0, y: 0, retargetAt: 10_000 };

    assert.ok(shark.mass > player.mass);
    assert.ok(shark.radius < player.radius);

    world.tick(16);

    assert.equal(player.alive, true);
    assert.equal(world.npcs.has(shark.id), false);
  });

  test("players keep growing beyond the old apex mass", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Apex", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.mass = 3098;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = 0;
    world.setPlayerInput(player.id, { x: 1, y: 0 });

    // Sized so the (phase-faded) food value still clearly moves a ~3,100-mass
    // player past the old apex threshold.
    const finalFood = world.spawnFood("coral_crab", { x: 0, y: 0 });
    finalFood.mass = 80;
    world.tick(16);

    assert.equal(player.won, false);
    assert.ok(player.mass > 3100);
    assert.deepEqual(player.input, { x: 1, y: 0, boost: false });
    assert.equal(world.drainEvents().some((event) => event.type === "player_won"), false);

    const snapshot = world.getSnapshot(player.id);
    assert.equal(snapshot.self.won, false);
    assert.ok(snapshot.self.mass > 3100);
    assert.equal(snapshot.world.fullScreenMass, PLAYER_FULL_SCREEN_MASS);

    const massBeforeExtra = player.mass;
    const extraFood = world.spawnFood("plankton", { x: 0, y: 0 });
    world.tick(16);

    assert.equal(world.food.has(extraFood.id), false);
    assert.ok(player.mass > massBeforeExtra, "food eaten past the old apex still adds mass");
  });

  test("growth stages and mass continue far beyond the old full-screen cap", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Vast", creatureId: "abyssal_serpent" });

    player.mass = 500_000;
    assert.equal(getGrowthStage(player.creatureId, player.mass).label, "Ocean Incarnate");
    assert.equal(getGrowthStage(player.creatureId, 1_500_000).label, "The Deep Itself");

    player.mass = PLAYER_MAX_MASS - 5;
    world.addMass(player, 10_000_000);
    assert.equal(player.mass, PLAYER_MAX_MASS, "growth should stop exactly at the max mass cap");
  });

  test("late-game growth is slower than early growth", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Curve", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 0;
    player.mass = 120;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = 0;

    const earlyFood = world.spawnFood("coral_crab", { x: 0, y: 0 });
    earlyFood.mass = 20;
    world.tick(16);
    const earlyGain = player.mass - 120;

    player.mass = 50_000;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    const lateFood = world.spawnFood("coral_crab", { x: 0, y: 0 });
    lateFood.mass = 20;
    world.tick(16);
    const lateGain = player.mass - 50_000;

    assert.ok(lateGain > 0);
    assert.ok(lateGain < earlyGain * 0.25);
  });

  test("larger players can eat smaller players and trigger respawn state", () => {
    const world = emptyWorld();
    const predator = world.addPlayer({ name: "Big", creatureId: "abyssal_serpent" });
    const prey = world.addPlayer({ name: "Small", creatureId: "glass_kraken" });

    predator.x = 0;
    predator.y = 0;
    predator.mass = 100;
    predator.radius = radiusForCreature(predator.creatureId, predator.mass);
    predator.invulnerableUntil = 0;

    prey.x = 0;
    prey.y = 0;
    prey.mass = 18;
    prey.radius = radiusForCreature(prey.creatureId, prey.mass);
    prey.invulnerableUntil = 0;

    world.tick(16);

    assert.equal(prey.alive, false);
    assert.equal(prey.lastEatenBy, "Big");
    assert.ok(predator.mass > 100);
    assert.ok(world.drainEvents().some((event) => event.type === "player_eaten"));
  });

  test("leaderboard keeps best scores after players leave", () => {
    const world = emptyWorld();
    const player = world.addPlayer({
      name: "High Tide",
      creatureId: "katulu",
      leaderboardId: "session-high-tide"
    });
    player.score = 2400;
    player.mass = 240;

    world.removePlayer(player.id);

    assert.equal(world.players.size, 0);
    assert.deepEqual(world.getLeaderboard(1)[0], {
      id: publicLeaderboardId("session-high-tide"),
      name: "High Tide",
      score: 2400,
      mass: 240,
      stage: "Hunter",
      alive: true,
      online: false,
      updatedAt: 0
    });
  });

  test("public leaderboard never exposes the raw session id", () => {
    const world = emptyWorld();
    world.addPlayer({ name: "Secret", creatureId: "katulu", leaderboardId: "secret-session-id" });
    world.addPlayer({ name: "Other", creatureId: "katulu", leaderboardId: "other-session-id" });
    const board = world.getLeaderboard(10);
    assert.equal(JSON.stringify(board).includes("secret-session-id"), false);
    assert.equal(new Set(board.map((entry) => entry.id)).size, 2);
    assert.match(board[0].id, /^lb_[0-9a-f]{16}$/);
  });

  test("snapshot self carries the bite bonus the simulation bites with", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Spurred", creatureId: "abyssal_serpent" });
    player.mass = 400;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.addons = [
      { addonId: "coral_spurs", expiresAt: 60_000, angle: 0 },
      { addonId: "coral_spurs", expiresAt: 60_000, angle: 1 }
    ];
    // Just small enough to swallow with two Coral Spurs, too big without.
    const npc = world.spawnNpc("reef_cod", { x: 0, y: 0 });
    npc.radius = player.radius / 1.045;

    const self = world.getSnapshot(player.id).self;
    assert.equal(self.biteRatioBonus, world.getPlayerBonuses(player).biteRatioBonus);
    assert.equal(canConsume(self, npc), false);
    assert.equal(canConsume(self, npc, { biteRatioBonus: self.biteRatioBonus }), true);
    assert.equal(canConsume(player, npc, world.getPlayerBonuses(player)), true);
  });

  test("leaderboard marks currently-connected sessions as online", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Live One", creatureId: "katulu", leaderboardId: "session-live" });
    player.score = 900;
    world.updateScores();
    assert.equal(world.getLeaderboard(1)[0].online, true);

    world.removePlayer(player.id);
    assert.equal(world.getLeaderboard(1)[0].online, false);
  });

  test("crossing a growth stage broadcasts a milestone event", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Grower", creatureId: "abyssal_serpent" });
    player.invulnerableUntil = 0;
    world.drainEvents();

    // Baseline (hatchling) should not announce.
    world.updateScores();
    assert.equal(world.drainEvents().some((event) => event.type === "player_grew"), false);

    // Cross into the next stage.
    player.mass = 120; // Hunter
    world.updateScores();
    const grew = world.drainEvents().find((event) => event.type === "player_grew");
    assert.ok(grew, "advancing a stage should emit player_grew");
    assert.equal(grew.name, "Grower");
    assert.equal(grew.stage, "Hunter");

    // Staying in the same stage should not re-announce.
    player.mass = 130;
    world.updateScores();
    assert.equal(world.drainEvents().some((event) => event.type === "player_grew"), false);
  });

  test("leaderboard never downgrades a returning session score", () => {
    const world = emptyWorld();
    const firstRun = world.addPlayer({
      name: "Deep Run",
      creatureId: "katulu",
      leaderboardId: "session-deep-run"
    });
    firstRun.score = 900;
    firstRun.mass = 90;
    world.removePlayer(firstRun.id);

    const secondRun = world.addPlayer({
      name: "Deep Run",
      creatureId: "katulu",
      leaderboardId: "session-deep-run"
    });
    secondRun.score = 120;
    world.updateScores();

    assert.equal(world.getLeaderboard(1)[0].score, 900);
  });

  test("leaderboard survives an export/import round-trip", () => {
    const source = emptyWorld();
    const player = source.addPlayer({ name: "Persist", creatureId: "katulu", leaderboardId: "session-persist" });
    player.score = 5400;
    player.mass = 200; // keeps the explicit score above the mass-derived score
    source.updateScores();

    const exported = source.exportLeaderboard();
    assert.ok(exported.length >= 1);
    assert.equal(exported[0].id, "session-persist");
    assert.equal(exported[0].score, 5400);

    // Simulate a restart: a brand-new world loads the saved scores.
    const restarted = emptyWorld();
    restarted.importLeaderboard(exported);
    const top = restarted.getLeaderboard(1)[0];
    assert.equal(top.name, "Persist");
    assert.equal(top.score, 5400);
    assert.equal(top.alive, false);

    // A returning session keeps the higher of saved vs new.
    const returning = restarted.addPlayer({ name: "Persist", creatureId: "katulu", leaderboardId: "session-persist" });
    returning.score = 100;
    restarted.updateScores();
    assert.equal(restarted.getLeaderboard(1)[0].score, 5400);
  });

  test("importLeaderboard ignores malformed entries", () => {
    const world = emptyWorld();
    world.importLeaderboard([
      null,
      { id: "ok", score: 300, name: "Ok", mass: 40 },
      { id: 123, score: 999 },
      { score: 999 },
      { id: "no-score" }
    ]);
    const board = world.getLeaderboard(10);
    assert.equal(board.length, 1);
    assert.equal(board[0].id, publicLeaderboardId("ok"));
  });

  test("add-ons attach to players and affect bonuses", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Kelp", creatureId: "glass_kraken" });
    player.x = 0;
    player.y = 0;

    const addon = world.spawnAddon("tide_ribbon", { x: 0, y: 0 });
    world.tick(16);

    assert.equal(world.addons.has(addon.id), false);
    assert.equal(player.addons.length, 1);
    assert.ok(world.getPlayerBonuses(player).speedMultiplier > 1);
    assert.ok(world.getPlayerBonuses(player).magnetRadius > 64);
  });

  test("pearl shield blocks a lethal bite once", () => {
    const world = emptyWorld();
    const predator = world.addPlayer({ name: "Bite", creatureId: "abyssal_serpent" });
    const prey = world.addPlayer({ name: "Shell", creatureId: "glass_kraken" });

    predator.x = 0;
    predator.y = 0;
    predator.mass = 120;
    predator.radius = radiusForCreature(predator.creatureId, predator.mass);
    predator.invulnerableUntil = 0;

    prey.x = 0;
    prey.y = 0;
    prey.mass = 18;
    prey.radius = radiusForCreature(prey.creatureId, prey.mass);
    prey.invulnerableUntil = 0;
    prey.shieldCharges = 1;

    world.tick(16);

    assert.equal(prey.alive, true);
    assert.equal(prey.shieldCharges, 0);
    assert.ok(world.drainEvents().some((event) => event.type === "shield_block"));
  });

  test("NPCs spawn as biome-appropriate species at varied life stages", () => {
    const world = new GameWorld({
      seed: "biome-spawn",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });

    // Spawn a batch with no explicit id/position → biome-driven selection.
    const seenSpecies = new Set();
    const seenStages = new Set();
    for (let index = 0; index < 200; index += 1) {
      const npc = world.spawnNpc();
      seenSpecies.add(npc.creatureId);
      seenStages.add(getGrowthStage(npc.creatureId, npc.mass).name);
    }

    assert.ok(seenSpecies.size >= 4, "a living ocean should draw several species");
    assert.ok(seenStages.size >= 2, "life stages should vary (fry/juvenile/adult), not all adults");
  });

  test("explicit spawnNpc ids still work for the legacy food-chain", () => {
    const world = emptyWorld();
    const sardine = world.spawnNpc("silver_sardine", { x: 5, y: 5 });
    assert.equal(sardine.creatureId, "silver_sardine");
    assert.ok(sardine.mass > 0);
    assert.equal(sardine.x, 5);
  });

  test("players cannot swim above the surface or below the hadal floor", () => {
    const world = new GameWorld({
      seed: "depth-bounds",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });
    const player = world.addPlayer({ name: "Diver", creatureId: "bloop" });
    player.x = 0;
    player.invulnerableUntil = 0;

    // Start just below the surface and swim up hard — should stop at the surface.
    player.y = OCEAN_SURFACE_Y + 3000;
    world.setPlayerInput(player.id, { x: 0, y: -1 });
    for (let index = 0; index < 120; index += 1) {
      world.tick(50);
    }
    assert.ok(player.y >= OCEAN_SURFACE_Y, "player should be stopped at the surface");
    assert.equal(zoneAt(player.x, player.y).id, "epipelagic");

    // Start just above the floor and dive hard — should stop at the floor.
    player.y = OCEAN_FLOOR_Y - 3000;
    world.setPlayerInput(player.id, { x: 0, y: 1 });
    for (let index = 0; index < 120; index += 1) {
      world.tick(50);
    }
    assert.ok(player.y <= OCEAN_FLOOR_Y, "player should be stopped at the floor");
    assert.equal(zoneAt(player.x, player.y).id, "hadal");
  });

  test("spawns near the surface spread back into the water instead of piling on the boundary", () => {
    const world = new GameWorld({
      seed: "spawn-band",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });
    const player = world.addPlayer({ name: "Surface", creatureId: "bloop" });
    player.x = 0;
    player.y = OCEAN_SURFACE_Y + 300; // hugging the surface

    const ceiling = OCEAN_SURFACE_Y + 200;
    let onBoundary = 0;
    for (let index = 0; index < 500; index += 1) {
      const point = world.randomSpawnPoint(100);
      assert.ok(point.y >= ceiling, "spawns stay inside the ocean band");
      assert.ok(point.y <= OCEAN_FLOOR_Y - 200);
      if (point.y === ceiling) {
        onBoundary += 1;
      }
    }
    // Clamping used to park a large share of spawns exactly on the ceiling,
    // drawing a visible line of food along the surface. Reflection spreads
    // them back down.
    assert.ok(onBoundary <= 2, `expected almost no spawns exactly on the boundary, got ${onBoundary}`);
  });

  test("deep water near a grown player spawns oversized specimens, shallow water near a hatchling never does", () => {
    const world = new GameWorld({
      seed: "oversize-spawns",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });
    const player = world.addPlayer({ name: "Apex", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 24_000; // hadal depths
    player.mass = 50_000;

    let oversized = 0;
    for (let index = 0; index < 600; index += 1) {
      // Outside the player's streamed view — oversized specimens only ever
      // materialise off-screen.
      const npc = world.spawnNpc(undefined, { x: 12_000, y: 24_000 });
      world.npcs.delete(npc.id);
      const baseMass = npcBaseMass(npc.creatureId);
      assert.ok(npc.mass <= baseMass * 400, "oversize never exceeds the 400× sanity cap");
      if (npc.mass >= baseMass * 5) {
        oversized += 1;
      }
    }
    assert.ok(oversized > 0, "the deep should breed Giant/Monster specimens around a grown player");

    // A fresh hatchling in the sunlight zone never meets an oversized spawn.
    player.mass = 14;
    player.y = OCEAN_SURFACE_Y + 400;
    let shallowOversized = 0;
    for (let index = 0; index < 400; index += 1) {
      const npc = world.spawnNpc(undefined, { x: 2000, y: OCEAN_SURFACE_Y + 400 });
      world.npcs.delete(npc.id);
      if (npc.mass >= npcBaseMass(npc.creatureId) * 5) {
        shallowOversized += 1;
      }
    }
    assert.equal(shallowOversized, 0);
  });

  test("a grown player is never left as the biggest fish for long", () => {
    const world = new GameWorld({
      seed: "apex-pressure",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 40,
      maxAddons: 0,
      maxHazards: 0,
      npcsPerPlayer: 4
    });
    const player = world.addPlayer({ name: "Biggest", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 10_000;
    player.mass = 12_000;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = Number.MAX_SAFE_INTEGER; // observe, don't die

    let stalker = null;
    for (let index = 0; index < 2000 && !stalker; index += 1) {
      world.tick(33);
      stalker = [...world.npcs.values()].find((npc) => npc.radius >= player.radius);
    }

    assert.ok(stalker, "an apex hunter should appear near a grown player");
    assert.ok(
      stalker.mass <= npcBaseMass(stalker.creatureId) * 400,
      "apex hunters respect the oversize sanity cap"
    );
    const distance = Math.hypot(stalker.x - player.x, stalker.y - player.y);
    assert.ok(distance > 1000, "the hunter arrives at a distance, not on top of the player");
    assert.ok(
      world.drainEvents().some((event) => event.type === "apex_hunter" && event.playerId === player.id),
      "the hunted player is warned via an event"
    );
  });

  test("an apex hunter spawned off-screen stalks its mark closer", () => {
    const world = new GameWorld({
      seed: "apex-stalk",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 40,
      maxAddons: 0,
      maxHazards: 0,
      npcsPerPlayer: 4
    });
    const player = world.addPlayer({ name: "Marked", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 10_000;
    player.mass = 12_000;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    player.invulnerableUntil = Number.MAX_SAFE_INTEGER; // observe, don't die

    let hunter = null;
    for (let index = 0; index < 2000 && !hunter; index += 1) {
      world.tick(33);
      hunter = [...world.npcs.values()].find((npc) => npc.huntTargetId === player.id);
    }
    assert.ok(hunter, "an apex hunter should be marked on its target");

    const before = Math.hypot(hunter.x - player.x, hunter.y - player.y);
    // Beyond its own perception radius, so only the mark can draw it in.
    assert.ok(before > 1900, "the hunter starts beyond normal NPC perception");
    for (let index = 0; index < 300; index += 1) {
      world.tick(33);
    }
    const after = Math.hypot(hunter.x - player.x, hunter.y - player.y);
    assert.ok(after < before - 500, `the hunter should close in on its mark (${Math.round(before)} → ${Math.round(after)})`);
  });

  test("oversized predators never spawn right on top of a player", () => {
    const world = new GameWorld({
      seed: "oversize-safety",
      populate: false,
      endless: true,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });
    const player = world.addPlayer({ name: "Close", creatureId: "abyssal_serpent" });
    player.x = 0;
    player.y = 24_000;
    player.mass = 50_000;

    for (let index = 0; index < 400; index += 1) {
      const npc = world.spawnNpc(undefined, { x: 300, y: 24_000 }); // well inside the safe distance
      world.npcs.delete(npc.id);
      assert.ok(npc.mass < npcBaseMass(npc.creatureId) * 5, "no Giant/Monster spawns inside the safe distance");
    }
  });

  test("endless worlds let players swim past the old arena edge", () => {
    const world = new GameWorld({
      seed: "endless-test",
      populate: false,
      endless: true,
      radius: 1200,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0,
      maxHazards: 0
    });
    const player = world.addPlayer({ name: "Open", creatureId: "bloop" });
    player.x = 1190;
    player.y = 0;
    player.invulnerableUntil = 0;
    world.setPlayerInput(player.id, { x: 1, y: 0 });

    for (let index = 0; index < 80; index += 1) {
      world.tick(50);
    }

    assert.ok(player.x > 1300);
    assert.equal(world.getSnapshot(player.id).world.endless, true);
    assert.equal(world.getSnapshot(player.id).world.radius, null);
  });

  test("endless population culls far entities and replenishes near players", () => {
    const world = new GameWorld({
      seed: "active-area-test",
      populate: false,
      endless: true,
      maxFood: 40,
      maxNpcs: 8,
      maxAddons: 4,
      maxHazards: 0,
      foodPerPlayer: 24,
      npcsPerPlayer: 4,
      addonsPerPlayer: 2,
      cullRadius: 1000,
      spawnRadius: 700
    });
    const player = world.addPlayer({ name: "Patch", creatureId: "katulu" });
    player.x = 10_000;
    player.y = 10_000;
    const staleFood = world.spawnFood("plankton", { x: -10_000, y: -10_000 });

    world.tick(50);

    assert.equal(world.food.has(staleFood.id), false);
    assert.ok(world.food.size > 0);
    // Spawn geometry is view-scaled: even with a tiny spawnRadius option, food
    // lands within the hatchling view band ((2600 + radius × 12) × 1.25).
    const spawnBand = (2600 + player.radius * 12) * 1.25;
    assert.ok([...world.food.values()].every((food) => Math.hypot(food.x - player.x, food.y - player.y) <= spawnBand));
  });
});
