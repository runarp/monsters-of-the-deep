import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CREATURE_CATALOG,
  FOOD_CATALOG,
  PLAYABLE_CREATURE_IDS,
  canConsume,
  getDietTags,
  getGrowthStage
} from "../src/shared/creatureCatalog.js";

describe("creature catalog", () => {
  test("playable creatures have movement, visuals, and growth stages", () => {
    assert.ok(PLAYABLE_CREATURE_IDS.length >= 10);
    assert.ok(PLAYABLE_CREATURE_IDS.includes("craken"));
    assert.ok(PLAYABLE_CREATURE_IDS.includes("sea_eater"));
    assert.ok(PLAYABLE_CREATURE_IDS.includes("bloop"));
    assert.ok(PLAYABLE_CREATURE_IDS.includes("katulu"));
    assert.ok(PLAYABLE_CREATURE_IDS.includes("elgramaha"));

    for (const creatureId of PLAYABLE_CREATURE_IDS) {
      const creature = CREATURE_CATALOG[creatureId];
      assert.equal(creature.playable, true);
      assert.ok(creature.name.length > 0);
      assert.ok(creature.summary.length > 0);
      assert.ok(creature.baseMass > 0);
      assert.ok(creature.baseRadius > 0);
      assert.ok(creature.visual.shape);
      assert.equal(creature.visual.sprite?.src, "/assets/creatures/scary-creature-atlas.png");
      assert.equal(typeof creature.visual.sprite?.index, "number");
      assert.ok(creature.visual.artStyle || creatureId === "abyssal_serpent" || creatureId === "glass_kraken" || creatureId === "reef_leviathan");
      assert.ok(creature.movement.maxSpeed > 0);
      assert.ok(creature.diet.length >= 3);
      assert.ok(creature.stages.length >= 4);
    }
  });

  test("diets and stages progress by mass", () => {
    const earlyDiet = getDietTags("abyssal_serpent", 14);
    const laterDiet = getDietTags("abyssal_serpent", 950);
    assert.deepEqual(earlyDiet, ["plankton", "larvae", "jelly", "tinyFish"]);
    assert.ok(laterDiet.includes("shark"));

    assert.equal(getGrowthStage("glass_kraken", 13).label, "Hatchling");
    assert.equal(getGrowthStage("glass_kraken", 420).label, "Giant");
  });

  test("consumption is constrained by diet tags and mass ratios", () => {
    const hatchling = {
      id: "player",
      kind: "player",
      creatureId: "abyssal_serpent",
      mass: 14
    };
    const plankton = {
      id: "food",
      kind: "food",
      foodId: "plankton",
      mass: FOOD_CATALOG.plankton.mass
    };
    const cod = {
      id: "cod",
      kind: "npc",
      creatureId: "reef_cod",
      mass: CREATURE_CATALOG.reef_cod.baseMass
    };

    assert.equal(canConsume(hatchling, plankton), true);
    assert.equal(
      canConsume(hatchling, {
        id: "minnow",
        kind: "food",
        foodId: "reef_minnow",
        mass: FOOD_CATALOG.reef_minnow.mass
      }),
      true
    );
    assert.equal(canConsume(hatchling, cod), false);

    hatchling.mass = 420;
    assert.equal(canConsume(hatchling, cod), true);
  });

  test("large NPC predators can treat small players as prey", () => {
    const sardine = {
      id: "sardine",
      kind: "npc",
      creatureId: "silver_sardine",
      mass: 34
    };
    const tinyPlayer = {
      id: "player",
      kind: "player",
      creatureId: "glass_kraken",
      mass: 14
    };

    assert.equal(canConsume(sardine, tinyPlayer), true);
  });
});
