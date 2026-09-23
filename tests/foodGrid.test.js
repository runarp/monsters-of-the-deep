import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canConsume } from "../src/shared/creatureCatalog.js";
import { FoodGrid, GameWorld } from "../src/shared/gameWorld.js";

function touches(first, second) {
  const radius = first.radius + second.radius;
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2 <= radius * radius;
}

describe("food grid", () => {
  test("picks exactly the morsel a linear scan would", () => {
    const world = new GameWorld({ seed: "grid-equivalence" });
    world.addPlayer({ name: "Anchor" });
    for (let tick = 0; tick < 60; tick += 1) {
      world.tick(33);
    }
    // Pile food onto some NPCs and blow a few up to Monster size so both the
    // grid path and the oversized fallback get exercised.
    const npcs = [...world.npcs.values()];
    npcs.slice(0, 20).forEach((npc, index) => {
      for (let extra = 0; extra < 4; extra += 1) {
        world.spawnFood(undefined, { x: npc.x + extra * 3 - index, y: npc.y + extra });
      }
    });
    npcs.slice(20, 23).forEach((npc) => {
      npc.radius *= 40;
    });

    const grid = new FoodGrid(world.food);
    let matches = 0;
    for (const npc of world.npcs.values()) {
      const accept = (food) => canConsume(npc, food);
      const linear = [...world.food.values()].find((food) => touches(npc, food) && accept(food)) ?? null;
      assert.equal(grid.firstTouching(npc, accept), linear);
      if (linear) {
        matches += 1;
      }
    }
    assert.ok(matches > 5, `expected several NPCs touching food, got ${matches}`);
  });
});
