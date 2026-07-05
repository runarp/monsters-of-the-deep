import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PLAYABLE_CREATURE_IDS,
  getCreatureTrait,
  publicCreatureCatalog,
  resolveTraitBonuses,
  traitHazardDrainResist
} from "../src/shared/creatureCatalog.js";
import { OCEAN_FLOOR_Y } from "../src/shared/geography.js";
import { GameWorld } from "../src/shared/gameWorld.js";
import { radiusForCreature } from "../src/shared/creatureCatalog.js";

function hazardWorld() {
  return new GameWorld({
    seed: "trait-world",
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

describe("creature traits", () => {
  test("every playable creature exposes a public trait blurb", () => {
    const catalog = publicCreatureCatalog();
    assert.equal(catalog.playable.length, PLAYABLE_CREATURE_IDS.length);
    for (const entry of catalog.playable) {
      assert.ok(entry.trait?.name);
      assert.ok(entry.trait?.summary);
      assert.equal(entry.trait.effects, undefined, "effects stay server-side");
    }
  });

  test("zone traits apply only in matching depth bands", () => {
    const shallow = resolveTraitBonuses("reef_leviathan", { zoneId: "epipelagic", mass: 100 });
    const deep = resolveTraitBonuses("reef_leviathan", { zoneId: "abyssal", mass: 100 });
    assert.ok(shallow.speedMultiplier > 0);
    assert.equal(deep.speedMultiplier, 0);

    const abyss = resolveTraitBonuses("abyssal_serpent", { zoneId: "abyssal", mass: 100 });
    const sun = resolveTraitBonuses("abyssal_serpent", { zoneId: "epipelagic", mass: 100 });
    assert.ok(abyss.speedMultiplier > sun.speedMultiplier);
    assert.ok(abyss.turnLerpBonus > 0);
  });

  test("bloop grows faster only while still small", () => {
    const early = resolveTraitBonuses("bloop", { zoneId: "epipelagic", mass: 120 });
    const late = resolveTraitBonuses("bloop", { zoneId: "epipelagic", mass: 900 });
    assert.equal(early.growthMultiplier, 1.18);
    assert.equal(late.growthMultiplier, 1);
  });

  test("glass kraken resists drift net drain", () => {
    assert.equal(traitHazardDrainResist("glass_kraken", "drift_net"), 0.45);
    assert.equal(traitHazardDrainResist("glass_kraken", "maelstrom"), 0);
  });

  test("glass kraken loses less mass in a drift net", () => {
    const world = hazardWorld();
    const player = placePlayer(world, { creatureId: "glass_kraken", mass: 300, x: 10, y: 0 });
    world.spawnHazard("drift_net", { x: 0, y: 0 });

    const before = player.mass;
    world.tick(50);
    const glassLoss = before - player.mass;

    const controlWorld = hazardWorld();
    const control = placePlayer(controlWorld, { creatureId: "sea_eater", mass: 300, x: 10, y: 0 });
    controlWorld.spawnHazard("drift_net", { x: 0, y: 0 });
    const beforeControl = control.mass;
    controlWorld.tick(50);
    const controlLoss = beforeControl - control.mass;

    assert.ok(glassLoss < controlLoss);
  });

  test("umbral manta resists maelstrom pull", () => {
    const world = hazardWorld();
    const manta = placePlayer(world, { creatureId: "umbral_manta", mass: 300, x: 200, y: 0 });
    world.spawnHazard("maelstrom", { x: 0, y: 0 });
    world.tick(50);
    const mantaPull = Math.abs(manta.vx);

    const world2 = hazardWorld();
    const serpent = placePlayer(world2, { creatureId: "abyssal_serpent", mass: 300, x: 200, y: 0 });
    world2.spawnHazard("maelstrom", { x: 0, y: 0 });
    world2.tick(50);
    const serpentPull = Math.abs(serpent.vx);

    assert.ok(mantaPull < serpentPull);
  });

  test("abyssal serpent is faster in the hadal zone", () => {
    const world = hazardWorld();
    const hadalY = OCEAN_FLOOR_Y - 400;
    const serpent = placePlayer(world, {
      creatureId: "abyssal_serpent",
      mass: 200,
      x: 0,
      y: hadalY
    });
    serpent.input = { x: 1, y: 0, boost: false };

    const world2 = hazardWorld();
    const reef = placePlayer(world2, {
      creatureId: "reef_leviathan",
      mass: 200,
      x: 0,
      y: hadalY
    });
    reef.input = { x: 1, y: 0, boost: false };

    for (let index = 0; index < 20; index += 1) {
      world.tick(50);
      world2.tick(50);
    }

    assert.ok(serpent.vx > reef.vx);
  });

  test("traits are defined for every playable creature", () => {
    for (const creatureId of PLAYABLE_CREATURE_IDS) {
      const trait = getCreatureTrait(creatureId);
      assert.ok(trait?.name);
      assert.ok(trait?.effects);
    }
  });
});
