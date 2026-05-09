import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { radiusForCreature } from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";

function emptyWorld() {
  return new GameWorld({
    seed: "test-world",
    populate: false,
    endless: false,
    radius: 1200,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0
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
      id: "session-high-tide",
      name: "High Tide",
      score: 2400,
      mass: 240,
      stage: "Hunter",
      alive: true,
      updatedAt: 0
    });
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

  test("endless worlds let players swim past the old arena edge", () => {
    const world = new GameWorld({
      seed: "endless-test",
      populate: false,
      endless: true,
      radius: 1200,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0
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
    assert.ok([...world.food.values()].every((food) => Math.hypot(food.x - player.x, food.y - player.y) < 1200));
  });
});
