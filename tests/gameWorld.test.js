import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { radiusForCreature } from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";

function emptyWorld() {
  return new GameWorld({
    seed: "test-world",
    populate: false,
    radius: 1200,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0
  });
}

describe("game world simulation", () => {
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
});
