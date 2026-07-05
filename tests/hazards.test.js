import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getCreatureDefinition, radiusForCreature } from "../src/shared/creatureCatalog.js";
import { regionAt } from "../src/shared/geography.js";
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
  test("a maelstrom drains players smaller than its overpower threshold", () => {
    const world = hazardWorld();
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    const player = placePlayer(world, { mass: Math.floor(hazard.mass * 0.6), x: 12, y: 0 });

    const before = player.mass;
    world.tick(50);

    assert.ok(player.mass < before, "smaller player should lose mass to the vortex");
  });

  test("maelstroms grow by feeding on drained players", () => {
    const world = hazardWorld();
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    const player = placePlayer(world, { mass: Math.floor(hazard.mass * 0.6) });
    const startingHazardMass = hazard.mass;
    const startingHazardRadius = hazard.radius;

    for (let index = 0; index < 10; index += 1) {
      player.x = hazard.x;
      player.y = hazard.y;
      world.tick(50);
    }

    assert.ok(hazard.mass > startingHazardMass, "vortex should gain the drained mass");
    assert.ok(hazard.radius > startingHazardRadius, "vortex should widen as it feeds");
  });

  test("big players overpower, shrink, and consume a maelstrom", () => {
    const world = hazardWorld();
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    const player = placePlayer(world, { mass: Math.ceil(hazard.mass * 4) });
    const startingHazardMass = hazard.mass;
    const startingPlayerMass = player.mass;

    let consumedEvent = null;
    for (let index = 0; index < 400 && !consumedEvent; index += 1) {
      player.x = hazard.x;
      player.y = hazard.y;
      world.tick(50);
      consumedEvent = world.drainEvents().find((event) => event.type === "hazard_consumed") ?? null;
      if (index === 3) {
        assert.ok(hazard.mass < startingHazardMass, "vortex should shrink while being overpowered");
      }
    }

    assert.ok(consumedEvent, "overpowering player should eventually consume the vortex");
    assert.equal(consumedEvent.playerId, player.id);
    assert.equal(world.hazards.has(hazard.id), false);
    assert.ok(player.mass > startingPlayerMass, "player should gain mass from the consumed vortex");
  });

  test("the tug of war can flip as the vortex outgrows a player", () => {
    const world = hazardWorld();
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    // Just above the overpower threshold: the player grinds at first, but a
    // rival's drained mass can push the vortex back above the flip point.
    const player = placePlayer(world, { mass: Math.ceil(hazard.mass * 1.3) });

    world.tick(50);
    const groundMass = hazard.mass;
    assert.ok(groundMass < hazard.scale * 520 * 1.001, "player at 1.3x should be grinding the vortex");

    hazard.mass = player.mass * 2;
    const before = player.mass;
    player.x = hazard.x;
    player.y = hazard.y;
    world.tick(50);
    assert.ok(player.mass < before, "once outgrown, the same player is drained again");
  });

  test("maelstroms graze on NPCs that wander into the core", () => {
    const world = hazardWorld();
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    const startingHazardMass = hazard.mass;
    const npc = world.spawnNpc("silver_sardine", { x: 0, y: 0 });
    npc.ai = { x: 0, y: 0, retargetAt: Number.MAX_SAFE_INTEGER };

    for (let index = 0; index < 300 && world.npcs.has(npc.id); index += 1) {
      npc.x = hazard.x;
      npc.y = hazard.y;
      npc.vx = 0;
      npc.vy = 0;
      world.tick(50);
    }

    assert.equal(world.npcs.has(npc.id), false, "vortex should eventually consume the trapped NPC");
    assert.ok(hazard.mass > startingHazardMass, "vortex should grow from grazing");
  });

  test("a maelstrom pulls a player toward its center", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { mass: 300, x: 200, y: 0 });
    world.spawnHazard("maelstrom", { x: 0, y: 0 });

    world.tick(50);

    assert.ok(player.vx < 0, "player should be accelerated back toward the vortex center");
  });

  test("a maelstrom kills a creature ground down to its base mass and is named for its sea", () => {
    const world = hazardWorld();
    const baseMass = getCreatureDefinition("abyssal_serpent").baseMass;
    const player = placePlayer(world, { mass: baseMass, x: 5, y: 0 });
    const hazard = world.spawnHazard("maelstrom", { x: 0, y: 0 });
    const whirlpoolName = regionAt(0, 0).whirlpool;
    assert.equal(hazard.name, whirlpoolName, "maelstrom takes its region's real whirlpool name");

    world.tick(50);

    assert.equal(player.alive, false);
    assert.equal(player.lastEatenBy, whirlpoolName);
    const events = world.drainEvents();
    assert.ok(events.some((event) => event.type === "player_eaten" && event.predatorName === whirlpoolName));
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
