import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CREATURE_CATALOG, getGrowthStage } from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";

// Pins the pacing curve. A player on a "nominal diet" — steady grazing plus a
// phase-appropriate hunt — must take 2–5 minutes per growth stage from Giant
// onward. If a balance change (digestion, growth efficiency, food value,
// bite cap) bends the curve outside that window, this fails.
const FOOD_PER_SECOND = 1.0; // grazing rate
const AVG_FOOD_MASS = 4.2; // weighted average of the food spawn table (~3.8 × 1.1 jitter)
const HUNT_INTERVAL_S = 15; // one successful hunt per this many seconds
const PREY_FRACTION = 0.3; // victim mass as a fraction of the player's

const STAGE_MIN_SECONDS = 120;
const STAGE_MAX_SECONDS = 300;
// The hatchling→Giant ramp is deliberately fast: instant early feedback is
// what hooks a new player. The 2–5 minute promise starts at Giant.
const PACED_FROM_MASS = 260;

function nominalWorld() {
  return new GameWorld({
    seed: "progression",
    populate: false,
    endless: true,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0
  });
}

function runNominalDiet() {
  const world = nominalWorld();
  const player = world.addPlayer({ name: "Pace", creatureId: "abyssal_serpent" });
  player.x = 0;
  player.y = 0;
  player.invulnerableUntil = 0;

  const stages = CREATURE_CATALOG.abyssal_serpent.stages;
  const crossings = new Map();
  const dt = 0.5;
  let t = 0;
  let foodDebt = 0;
  let nextHunt = HUNT_INTERVAL_S;

  while (player.mass < stages.at(-1).minMass && t < 3600 * 3) {
    t += dt;
    foodDebt += FOOD_PER_SECOND * dt;
    while (foodDebt >= 1) {
      foodDebt -= 1;
      const food = world.spawnFood("plankton", { x: player.x, y: player.y });
      food.mass = AVG_FOOD_MASS;
      world.consumeFood(player, food);
    }
    if (t >= nextHunt) {
      nextHunt += HUNT_INTERVAL_S;
      const npc = world.spawnNpc("silver_sardine", { x: 0, y: 0 });
      npc.mass = player.mass * PREY_FRACTION;
      world.consumeNpc(player, npc);
    }
    for (const stage of stages) {
      if (player.mass >= stage.minMass && !crossings.has(stage.minMass)) {
        crossings.set(stage.minMass, t);
      }
    }
  }

  return { stages, crossings, total: t };
}

describe("growth progression pacing", () => {
  test("each stage from Giant onward takes 2–5 minutes on a nominal diet", () => {
    const { stages, crossings } = runNominalDiet();

    for (let index = 0; index < stages.length - 1; index += 1) {
      const stage = stages[index];
      const next = stages[index + 1];
      const enteredAt = crossings.get(stage.minMass);
      const leftAt = crossings.get(next.minMass);
      assert.ok(enteredAt !== undefined, `${stage.label} was never reached`);
      assert.ok(leftAt !== undefined, `${next.label} was never reached`);
      if (stage.minMass < PACED_FROM_MASS) {
        continue; // the early ramp is covered by its own test
      }
      const took = leftAt - enteredAt;
      assert.ok(
        took >= STAGE_MIN_SECONDS && took <= STAGE_MAX_SECONDS,
        `${stage.label}: took ${Math.round(took)}s, expected ${STAGE_MIN_SECONDS}–${STAGE_MAX_SECONDS}s`
      );
    }
  });

  test("the early ramp (hatchling → Giant) stays under a minute, full run 25–60 minutes", () => {
    const { crossings, total } = runNominalDiet();
    assert.ok(crossings.get(PACED_FROM_MASS) < 60, "the hatchling ramp should feel instant");
    assert.ok(total >= 25 * 60 && total <= 60 * 60, `full run took ${Math.round(total / 60)} min`);
  });

  test("no single meal grants more than ~a quarter of the current body", () => {
    for (const mass of [40, 100, 1000, 10_000, 100_000, 1_000_000]) {
      const world = nominalWorld();
      const player = world.addPlayer({ name: "Bite", creatureId: "abyssal_serpent" });
      player.mass = mass;
      player.invulnerableUntil = 0;

      // Worst case: an enormous victim (far bigger than anything the bite
      // rules would normally allow) still cannot leapfrog the curve.
      const npc = world.spawnNpc("silver_sardine", { x: 0, y: 0 });
      npc.mass = mass * 20;
      const before = player.mass;
      world.consumeNpc(player, npc);
      const gain = player.mass - before;

      assert.ok(gain <= before * 0.25 + 12.001, `gain ${gain} exceeds bite cap at mass ${mass}`);
      const stagesBefore = getGrowthStage("abyssal_serpent", before).minMass;
      const stagesAfter = getGrowthStage("abyssal_serpent", player.mass).minMass;
      const stageList = CREATURE_CATALOG.abyssal_serpent.stages.map((stage) => stage.minMass);
      assert.ok(
        stageList.indexOf(stagesAfter) - stageList.indexOf(stagesBefore) <= 1,
        `a single bite skipped a full stage at mass ${mass}`
      );
    }
  });

  test("a meal is never worth more than the victim's own mass", () => {
    const world = nominalWorld();
    const player = world.addPlayer({ name: "Fair", creatureId: "abyssal_serpent" });
    player.mass = 100;
    player.invulnerableUntil = 0;

    const npc = world.spawnNpc("silver_sardine", { x: 0, y: 0 });
    npc.mass = 30;
    const before = player.mass;
    world.consumeNpc(player, npc);

    assert.ok(player.mass - before < 30, "gain must stay below the victim's mass");
  });
});
