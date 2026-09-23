import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GameWorld } from "../src/shared/gameWorld.js";

function emptyWorld() {
  return new GameWorld({
    seed: "delta-world",
    populate: false,
    endless: false,
    radius: 1200,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0
  });
}

// Replays deltas the way client.js applyFoodDelta does.
function applyDelta(known, snapshot) {
  if (snapshot.foodKeyframe) {
    known.clear();
    for (const food of snapshot.food) {
      known.set(food.id, food);
    }
  }
  for (const food of snapshot.foodAdded ?? []) {
    known.set(food.id, food);
  }
  for (const [id, x, y] of snapshot.foodMoved ?? []) {
    known.set(id, { ...known.get(id), x, y });
  }
  for (const id of snapshot.foodRemoved ?? []) {
    known.delete(id);
  }
}

describe("delta snapshots", () => {
  test("food streams as a keyframe, then only changes", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Viewer", creatureId: "katulu" });
    player.x = 0;
    player.y = 0;
    const kept = world.spawnFood("plankton", { x: 100, y: 0 });
    const eaten = world.spawnFood("krill", { x: -100, y: 0 });
    const view = world.createViewState();
    const known = new Map();

    const first = world.getSnapshot(player.id, view);
    assert.equal(first.foodKeyframe, true);
    assert.equal(first.food.length, 2);
    applyDelta(known, first);

    const idle = world.getSnapshot(player.id, view);
    assert.equal(idle.food, undefined);
    assert.equal(idle.foodAdded, undefined);
    assert.equal(idle.foodMoved, undefined);
    assert.equal(idle.foodRemoved, undefined);

    world.food.delete(eaten.id);
    kept.x += 40;
    const fresh = world.spawnFood("plankton", { x: 0, y: 150 });
    const changed = world.getSnapshot(player.id, view);
    assert.deepEqual(changed.foodRemoved, [eaten.id]);
    assert.deepEqual(changed.foodMoved, [[kept.id, 140, 0]]);
    assert.deepEqual(changed.foodAdded.map((food) => food.id), [fresh.id]);
    applyDelta(known, changed);

    const truth = world.getSnapshot(player.id).food;
    assert.deepEqual(
      [...known.values()].map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id)),
      truth.map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id))
    );
  });

  test("food that drifts out of view is removed", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Viewer", creatureId: "katulu" });
    player.x = 0;
    player.y = 0;
    const food = world.spawnFood("plankton", { x: 100, y: 0 });
    const view = world.createViewState();
    world.getSnapshot(player.id, view);
    food.x = 50_000;
    assert.deepEqual(world.getSnapshot(player.id, view).foodRemoved, [food.id]);
  });

  test("leaderboard is only sent when it changes", () => {
    const world = emptyWorld();
    const player = world.addPlayer({ name: "Viewer", creatureId: "katulu" });
    const view = world.createViewState();
    assert.ok(world.getSnapshot(player.id, view).leaderboard);
    assert.equal(world.getSnapshot(player.id, view).leaderboard, undefined);
    player.score += 500;
    world.updateScores();
    assert.ok(world.getSnapshot(player.id, view).leaderboard);
  });

  test("private events only reach their own player", () => {
    const world = emptyWorld();
    const events = [
      { type: "ate_food", playerId: "a" },
      { type: "ate_food", playerId: "b" },
      { type: "collected_addon", playerId: "b" },
      { type: "player_grew", playerId: "b" },
      { type: "player_eaten", victimId: "b" }
    ];
    assert.deepEqual(
      world.eventsFor(events, "a").map((event) => event.type),
      ["ate_food", "player_grew", "player_eaten"]
    );
  });
});
