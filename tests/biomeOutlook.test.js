import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canConsume, radiusForCreature } from "../src/shared/creatureCatalog.js";
import { biomeOutlook } from "../src/shared/gameWorld.js";
import { DEPTH_ZONES, REGIONS } from "../src/shared/geography.js";

function playerAt(mass, creatureId = "abyssal_serpent") {
  return { id: "outlook-player", kind: "player", creatureId, mass, radius: radiusForCreature(creatureId, mass) };
}

const BONUS = { biteRatioBonus: 0.04 };

describe("biome outlook", () => {
  test("shares stay within [0, 1] for every cell at every size", () => {
    for (const mass of [14, 120, 1000, 20_000, 2_000_000]) {
      const player = playerAt(mass);
      for (const region of REGIONS) {
        for (const zone of DEPTH_ZONES) {
          const outlook = biomeOutlook(player, region.id, zone.id, BONUS);
          for (const key of ["preyShare", "threatShare"]) {
            assert.ok(outlook[key] >= 0 && outlook[key] <= 1, `${key} ${outlook[key]} in ${region.id}/${zone.id}`);
          }
          assert.ok(outlook.mealValue >= 0);
          assert.ok(["deadly", "risky", "safe"].includes(outlook.verdict));
        }
      }
    }
  });

  test("a hatchling faces more threats in the Mariana abyss than the Sargasso twilight", () => {
    const hatchling = playerAt(14);
    const abyss = biomeOutlook(hatchling, "mariana_approach", "abyssal", BONUS);
    const twilight = biomeOutlook(hatchling, "sargasso_sea", "mesopelagic", BONUS);
    assert.ok(abyss.threatShare > twilight.threatShare);
    assert.equal(abyss.verdict, "deadly");
  });

  test("a grown titan has nothing to fear in the Sargasso shallows", () => {
    const outlook = biomeOutlook(playerAt(50_000), "sargasso_sea", "epipelagic", BONUS);
    assert.equal(outlook.threatShare, 0);
    assert.equal(outlook.verdict, "safe");
    assert.ok(outlook.preyShare > 0.9);
  });

  test("listed prey and threats really are, at the size they typically spawn here", () => {
    const player = playerAt(40);
    const outlook = biomeOutlook(player, "north_atlantic", "epipelagic", BONUS);
    assert.ok(outlook.prey.length > 0 && outlook.threats.length > 0);
    // At least the adult form of each listed threat can eat the player, and
    // at least the young of each listed prey can be eaten.
    for (const id of outlook.threats) {
      const huge = { id: "probe", kind: "npc", creatureId: id, mass: 1e7, radius: radiusForCreature(id, 1e7) };
      assert.ok(canConsume(huge, player), `${id} listed as a threat`);
    }
    for (const id of outlook.prey) {
      const tiny = { id: "probe", kind: "npc", creatureId: id, mass: 0.5, radius: radiusForCreature(id, 0.5) };
      assert.ok(canConsume(player, tiny, BONUS), `${id} listed as prey`);
    }
  });

  test("bite bonuses can only widen what counts as prey", () => {
    const player = playerAt(300);
    for (const region of REGIONS) {
      const plain = biomeOutlook(player, region.id, "bathypelagic", {});
      const spurred = biomeOutlook(player, region.id, "bathypelagic", { biteRatioBonus: 0.14 });
      assert.ok(spurred.preyShare >= plain.preyShare);
    }
  });
});
