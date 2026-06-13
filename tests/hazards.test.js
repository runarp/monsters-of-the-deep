import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getCreatureDefinition, radiusForCreature } from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";

function hazardWorld() {
  return new GameWorld({
    seed: "hazard-world",
    populate: false,
    endless: true,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0
  });
}

function placePlayer(world, { creatureId = "abyssal_serpent", mass = 200, x = 0, y = 0 } = {}) {
  const player = world.addPlayer({ name: "Diver", creatureId });
  player.x = x;
  player.y = y;
  player.mass = mass;
  player.radius = radiusForCreature(player.creatureId, player.mass);
  player.invulnerableUntil = 0;
  return player;
}

describe("hazards", () => {
  test("a maelstrom drains player mass on contact regardless of size", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 5000, x: 12, y: 0 });
    world.spawnHazard("maelstrom", { x: 0, y: 0 });

    const before = player.mass;
    world.tick(50);

    assert.ok(player.mass < before, "large player should still lose mass");
  });

  test("a maelstrom pulls a player toward its center", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 300, x: 200, y: 0 });
    world.spawnHazard("maelstrom", { x: 0, y: 0 });

    world.tick(50);

    assert.ok(player.vx < 0, "player should be accelerated back toward the vortex center");
  });

  test("a maelstrom kills a creature ground down to its base mass", () => {
    const world = hazardWorld();
    const baseMass = getCreatureDefinition("abyssal_serpent").baseMass;
    const player = placePlayer(world, { mass: baseMass, x: 5, y: 0 });
    world.spawnHazard("maelstrom", { x: 0, y: 0 });

    world.tick(50);

    assert.equal(player.alive, false);
    assert.equal(player.lastEatenBy, "the Maelstrom");
    const events = world.drainEvents();
    assert.ok(events.some((event) => event.type === "player_eaten" && event.predatorName === "the Maelstrom"));
  });

  test("a drift net drains mass but does not kill", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 300, x: 10, y: 0 });
    world.spawnHazard("drift_net", { x: 0, y: 0 });

    const before = player.mass;
    world.tick(50);

    assert.ok(player.mass < before);
    assert.equal(player.alive, true);
  });

  test("spawn invulnerability protects players from hazards", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 300, x: 5, y: 0 });
    player.invulnerableUntil = 10_000;
    world.spawnHazard("maelstrom", { x: 0, y: 0 });

    const before = player.mass;
    world.tick(50);

    assert.equal(player.mass, before);
    assert.equal(player.alive, true);
  });

  test("hazards are published in snapshots", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 300, x: 0, y: 0 });
    world.spawnHazard("maelstrom", { x: 120, y: 0 });

    const snapshot = world.getSnapshot(player.id);
    assert.ok(Array.isArray(snapshot.hazards));
    assert.equal(snapshot.hazards.length, 1);
    assert.equal(snapshot.hazards[0].hazardType, "maelstrom");
    assert.ok(snapshot.hazards[0].radius > 0);
  });
});
