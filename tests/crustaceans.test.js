import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CREATURE_CATALOG,
  FOOD_CATALOG,
  canConsume,
  massForCreatureRadius,
  radiusForCreature
} from "../src/shared/creatureCatalog.js";
import { GameWorld } from "../src/shared/gameWorld.js";

const CRUSTACEANS = [
  { id: "red_king_crab", shape: "crab", x: 22_000 },
  { id: "american_lobster", shape: "lobster", x: 13_000 }
];

function emptyWorld(seed = "crustaceans") {
  return new GameWorld({
    seed,
    populate: false,
    maxFood: 0,
    maxNpcs: 0,
    maxAddons: 0,
    maxHazards: 0
  });
}

function encounter(creatureId) {
  const world = emptyWorld();
  const player = world.addPlayer({ name: "Swimmer", creatureId: "abyssal_serpent" });
  Object.assign(player, { x: 0, y: 2000, invulnerableUntil: 0 });
  const definition = CREATURE_CATALOG[creatureId];
  const enemy = world.spawnNpc(creatureId, { x: 700, y: 2000 }, { mass: definition.baseMass });
  assert.ok(enemy, "an open ocean must allow this encounter");
  Object.assign(enemy, { vx: 0, vy: 0 });
  enemy.ai.retargetAt = 0;
  world.drainEvents();
  return { world, player, enemy, definition };
}

// Combat fixtures deliberately move an existing enemy into contact: production
// spawnNpc must never create that overlap, even for a test-supplied position.
function makeContact(player, enemy) {
  Object.assign(enemy, { x: player.x + 1, y: player.y, vx: 0, vy: 0 });
}

describe("hostile crustaceans", () => {
  test("new enemies are distinct from the existing coral-crab food pickup", () => {
    assert.ok(FOOD_CATALOG.coral_crab);
    for (const { id, shape } of CRUSTACEANS) {
      const definition = CREATURE_CATALOG[id];
      assert.equal(definition.playable, false);
      assert.ok(definition.tags.includes("crustacean"));
      assert.equal(definition.visual.shape, shape);
      assert.ok(definition.movement.maxSpeed > 0);
      assert.ok(definition.diet[0].preyTags.includes("monster"));
      assert.equal(FOOD_CATALOG[id], undefined);
    }
  });

  for (const { id, x } of CRUSTACEANS) {
    test(`${id} is selected by its actual biome spawn pool`, () => {
      const world = emptyWorld(`biome-${id}`);
      const counts = new Map();
      for (let sample = 0; sample < 2000; sample += 1) {
        const selected = world.pickSpeciesForLocation({ x, y: 0 });
        counts.set(selected, (counts.get(selected) ?? 0) + 1);
      }
      assert.ok(counts.get(id) >= 20, `${id} should be a regular resident, not an unreachable catalog entry`);
    });

    test(`${id} uses safe placement even when asked to spawn on a player`, () => {
      const { world, player } = encounter(id);
      const enemy = world.spawnNpc(id, player, { mass: CREATURE_CATALOG[id].baseMass });
      assert.ok(enemy);
      const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      assert.ok(distance >= player.radius + enemy.radius + 350);
      assert.equal(player.alive, true);
    });

    test(`${id} actively pursues and kills through ordinary simulation ticks`, () => {
      const { world, player, enemy, definition } = encounter(id);
      assert.equal(canConsume(enemy, player), true);
      const intent = world.chooseNpcIntent(enemy);
      assert.ok(intent.x < -0.99, "the enemy must steer toward the player");
      assert.equal(intent.y, 0);
      const originalDistance = enemy.x - player.x;
      for (let tick = 0; tick < 30; tick += 1) {
        world.tick(1000 / 30);
      }
      assert.ok(enemy.x - player.x < originalDistance, "AI movement must close the gap");
      for (let tick = 0; tick < 300 && player.alive; tick += 1) {
        world.tick(1000 / 30);
      }
      assert.equal(player.alive, false);
      assert.equal(player.deathCount, 1);
      assert.equal(player.lastEatenBy, definition.name);
      assert.equal(player.respawnAt, world.now + 2800);
      assert.ok(enemy.mass > definition.baseMass, "normal feeding awards the predator mass");
      assert.ok(world.drainEvents().some((event) =>
        event.type === "player_eaten" && event.victimId === player.id && event.predatorId === enemy.id));
    });

    test(`${id} respects spawn immunity and the normal one-bite pearl shield`, () => {
      const { world, player, enemy } = encounter(id);
      player.invulnerableUntil = 2200;
      makeContact(player, enemy);
      world.resolveCollisions();
      assert.equal(player.alive, true);
      assert.equal(player.deathCount, 0);

      world.now = 2201;
      world.collectAddon(player, world.spawnAddon("pearl_shield", player));
      makeContact(player, enemy);
      world.resolveCollisions();
      assert.equal(player.alive, true);
      assert.equal(player.addons.length, 0);
      assert.equal(player.shieldCharges, 0);
      assert.ok(world.drainEvents().some((event) => event.type === "shield_block" && event.attackerId === enemy.id));

      world.now = player.invulnerableUntil - 1;
      makeContact(player, enemy);
      world.resolveCollisions();
      assert.equal(player.alive, true, "shield recovery immunity lasts until expiry");
      world.now = player.invulnerableUntil + 1;
      makeContact(player, enemy);
      world.resolveCollisions();
      assert.equal(player.alive, false, "another unprotected bite is lethal");
      assert.equal(player.deathCount, 1);
    });

    test(`${id} remains edible when smaller and dangerous when oversized`, () => {
      const { world, player, enemy } = encounter(id);
      player.mass = 3100;
      player.radius = radiusForCreature(player.creatureId, player.mass);
      assert.equal(canConsume(enemy, player), false);
      assert.equal(canConsume(player, enemy), true);
      makeContact(player, enemy);
      world.resolveCollisions();
      assert.equal(world.npcs.has(enemy.id), false);
      assert.equal(player.alive, true);
      assert.ok(player.mass > 3100);

      const mass = massForCreatureRadius(id, player.radius * 1.3);
      const giant = world.spawnNpc(id, { x: 5000, y: 2000 }, { mass });
      assert.ok(giant);
      assert.equal(canConsume(giant, player), true, "oversized crustaceans can still threaten a grown player");
      makeContact(player, giant);
      world.resolveCollisions();
      assert.equal(player.alive, false);
    });
  }
});
