import {
  ADDON_CATALOG,
  CREATURE_CATALOG,
  FOOD_CATALOG,
  PLAYER_MAX_MASS,
  PLAYABLE_CREATURE_IDS,
  canConsume,
  getAddonDefinition,
  getCreatureDefinition,
  getFoodDefinition,
  getGrowthStage,
  publicCreatureCatalog,
  radiusForCreature
} from "./creatureCatalog.js";
import { angleLerp, clamp, distanceSquared, keepInsideCircle, normalize } from "./math.js";
import { createRng } from "./random.js";

const DEFAULT_OPTIONS = Object.freeze({
  endless: true,
  radius: 7200,
  activeRadius: 5200,
  spawnRadius: 3600,
  cullRadius: 7200,
  maxFood: 900,
  maxNpcs: 140,
  maxAddons: 48,
  foodPerPlayer: 310,
  npcsPerPlayer: 44,
  addonsPerPlayer: 13,
  populate: true
});

const FOOD_SPAWNS = Object.freeze([
  { id: "marine_snow", weight: 36 },
  { id: "plankton", weight: 34 },
  { id: "copepod_cluster", weight: 30 },
  { id: "krill", weight: 28 },
  { id: "baby_shrimp", weight: 24 },
  { id: "larval_fish", weight: 24 },
  { id: "comb_jelly", weight: 20 },
  { id: "glass_eel", weight: 18 },
  { id: "reef_minnow", weight: 16 },
  { id: "moon_jelly", weight: 13 },
  { id: "coral_crab", weight: 8 }
]);

const NPC_SPAWNS = Object.freeze([
  { id: "lantern_fry", weight: 26 },
  { id: "silver_sardine", weight: 24 },
  { id: "reef_cod", weight: 15 },
  { id: "humboldt_squid", weight: 11 },
  { id: "yellowfin_tuna", weight: 9 },
  { id: "manta_ray", weight: 6 },
  { id: "mako_shark", weight: 5 },
  { id: "blue_whale", weight: 3 },
  { id: "ancient_leviathan", weight: 1 }
]);

const ADDON_SPAWNS = Object.freeze(
  Object.keys(ADDON_CATALOG).map((id) => ({ id, weight: id === "pearl_shield" ? 5 : 10 }))
);

export class GameWorld {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.endless = Boolean(this.options.endless);
    this.radius = this.options.radius;
    this.rng = createRng(options.seed ?? Date.now());
    this.now = 0;
    this.nextId = 1;
    this.players = new Map();
    this.npcs = new Map();
    this.food = new Map();
    this.addons = new Map();
    this.leaderboard = new Map();
    this.events = [];

    if (this.options.populate) {
      this.populateInitial();
    }
  }

  populateInitial() {
    while (this.food.size < this.options.maxFood) {
      this.spawnFood();
    }
    while (this.npcs.size < this.options.maxNpcs) {
      this.spawnNpc();
    }
    while (this.addons.size < this.options.maxAddons) {
      this.spawnAddon();
    }
  }

  addPlayer({ id, name, creatureId = "abyssal_serpent", leaderboardId } = {}) {
    const sanitizedName = sanitizeName(name);
    if (!isValidPlayerName(sanitizedName)) {
      throw new Error("Player name is required.");
    }

    const creature = getCreatureDefinition(
      PLAYABLE_CREATURE_IDS.includes(creatureId) ? creatureId : "abyssal_serpent"
    );
    const spawn = this.randomSpawnPoint(600);
    const player = {
      id: id ?? this.createId("player"),
      kind: "player",
      name: sanitizedName,
      leaderboardId: leaderboardId ?? id ?? null,
      creatureId: creature.id,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      heading: this.rng.float(-Math.PI, Math.PI),
      mass: creature.baseMass,
      radius: radiusForCreature(creature.id, creature.baseMass),
      input: { x: 0, y: 0, boost: false },
      alive: true,
      score: Math.floor(creature.baseMass * 10),
      eatenCount: 0,
      playerKills: 0,
      deathCount: 0,
      addons: [],
      shieldCharges: 0,
      invulnerableUntil: this.now + 2200,
      respawnAt: null,
      lastEatenBy: null,
      won: false,
      wonAt: null
    };
    player.leaderboardId ??= player.id;

    this.players.set(player.id, player);
    this.recordLeaderboardScore(player);
    this.events.push({ type: "player_joined", playerId: player.id, name: player.name });
    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.recordLeaderboardScore(player);
      this.players.delete(playerId);
      this.events.push({ type: "player_left", playerId, name: player.name });
    }
  }

  setPlayerInput(playerId, input = {}) {
    const player = this.players.get(playerId);
    if (!player || player.won) {
      return;
    }

    const desired = normalize(Number(input.x) || 0, Number(input.y) || 0);
    player.input = {
      x: desired.x,
      y: desired.y,
      boost: Boolean(input.boost)
    };
  }

  spawnFood(foodId = weightedPick(this.rng, FOOD_SPAWNS), position = this.randomSpawnPoint(100)) {
    const definition = getFoodDefinition(foodId);
    const mass = definition.mass * this.rng.float(0.85, 1.35);
    const entity = {
      id: this.createId("food"),
      kind: "food",
      foodId: definition.id,
      x: position.x,
      y: position.y,
      mass,
      radius: definition.radius * Math.sqrt(mass / definition.mass)
    };
    this.food.set(entity.id, entity);
    return entity;
  }

  spawnNpc(creatureId = weightedPick(this.rng, NPC_SPAWNS), position = this.randomSpawnPoint(500)) {
    const creature = getCreatureDefinition(creatureId);
    const mass = creature.baseMass * this.rng.float(0.86, 1.28);
    const entity = {
      id: this.createId("npc"),
      kind: "npc",
      creatureId: creature.id,
      x: position.x,
      y: position.y,
      vx: this.rng.float(-20, 20),
      vy: this.rng.float(-20, 20),
      heading: this.rng.float(-Math.PI, Math.PI),
      mass,
      radius: radiusForCreature(creature.id, mass),
      ai: {
        x: this.rng.float(-1, 1),
        y: this.rng.float(-1, 1),
        retargetAt: this.now + this.rng.float(300, 1800)
      }
    };
    this.npcs.set(entity.id, entity);
    return entity;
  }

  spawnAddon(addonId = weightedPick(this.rng, ADDON_SPAWNS), position = this.randomSpawnPoint(250)) {
    const definition = getAddonDefinition(addonId);
    const entity = {
      id: this.createId("addon"),
      kind: "addon",
      addonId: definition.id,
      x: position.x,
      y: position.y,
      radius: 18,
      spin: this.rng.float(-Math.PI, Math.PI)
    };
    this.addons.set(entity.id, entity);
    return entity;
  }

  tick(dtMs = 50) {
    const cappedDtMs = clamp(dtMs, 1, 120);
    const dt = cappedDtMs / 1000;
    this.now += cappedDtMs;

    this.maintainPopulation();
    this.updatePlayers(dt);
    this.updateNpcs(dt);
    this.resolveCollisions();
    this.updateScores();
  }

  getSnapshot(playerId = null) {
    const viewer = playerId ? this.players.get(playerId) : null;
    const center = viewer && (viewer.alive || viewer.won) ? viewer : { x: 0, y: 0, radius: 0 };
    const viewRadius = viewer ? clamp(2600 + viewer.radius * 12, 2600, 6400) : this.options.activeRadius;
    const visible = (entity) => {
      const range = viewRadius + entity.radius + 200;
      return distanceSquared(center, entity) <= range * range;
    };

    return {
      type: "snapshot",
      now: Math.round(this.now),
      playerId,
      world: { endless: this.endless, radius: this.endless ? null : this.radius, maxPlayerMass: PLAYER_MAX_MASS },
      self: viewer ? serializeEntity(viewer, this.now) : null,
      players: [...this.players.values()]
        .filter((player) => player.alive || player.won)
        .map((player) => serializeEntity(player, this.now)),
      npcs: [...this.npcs.values()].filter(visible).map((npc) => serializeEntity(npc, this.now)),
      food: [...this.food.values()].filter(visible).map((food) => serializeEntity(food, this.now)),
      addons: [...this.addons.values()].filter(visible).map((addon) => serializeEntity(addon, this.now)),
      leaderboard: this.getLeaderboard()
    };
  }

  getLeaderboard(limit = 10) {
    return [...this.leaderboard.values()]
      .sort((a, b) => b.score - a.score || b.mass - a.mass)
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        score: entry.score,
        mass: Math.round(entry.mass),
        stage: entry.stage,
        alive: entry.alive,
        updatedAt: entry.updatedAt
      }));
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  createId(prefix) {
    const id = `${prefix}_${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  randomPoint(margin = 0) {
    if (this.endless) {
      return this.randomSpawnPoint(margin);
    }

    const angle = this.rng.float(0, Math.PI * 2);
    const distance = Math.sqrt(this.rng.next()) * Math.max(10, this.radius - margin);
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance
    };
  }

  randomSpawnPoint(margin = 0) {
    if (!this.endless) {
      return this.randomPoint(margin);
    }

    const focus = this.pickFocusPoint();
    const angle = this.rng.float(0, Math.PI * 2);
    const minDistance = Math.min(260, this.options.spawnRadius * 0.18);
    const maxDistance = Math.max(minDistance + 20, this.options.spawnRadius - margin);
    const distance = minDistance + Math.sqrt(this.rng.next()) * (maxDistance - minDistance);
    return {
      x: focus.x + Math.cos(angle) * distance,
      y: focus.y + Math.sin(angle) * distance
    };
  }

  pickFocusPoint() {
    const alivePlayers = [...this.players.values()].filter((player) => player.alive);
    if (alivePlayers.length === 0) {
      return { x: 0, y: 0 };
    }
    return this.rng.pick(alivePlayers);
  }

  maintainPopulation() {
    if (this.endless) {
      this.cullDistantEntities();
    }

    const focusCount = Math.max(1, [...this.players.values()].filter((player) => player.alive).length);
    const targetFood = Math.min(this.options.maxFood, Math.max(180, focusCount * this.options.foodPerPlayer));
    const targetNpcs = Math.min(this.options.maxNpcs, Math.max(32, focusCount * this.options.npcsPerPlayer));
    const targetAddons = Math.min(this.options.maxAddons, Math.max(8, focusCount * this.options.addonsPerPlayer));

    for (let index = 0; index < 34 && this.food.size < targetFood; index += 1) {
      this.spawnFood();
    }
    for (let index = 0; index < 5 && this.npcs.size < targetNpcs; index += 1) {
      this.spawnNpc();
    }
    for (let index = 0; index < 3 && this.addons.size < targetAddons; index += 1) {
      this.spawnAddon();
    }
  }

  cullDistantEntities() {
    const focusPoints = [...this.players.values()].filter((player) => player.alive);
    if (focusPoints.length === 0) {
      focusPoints.push({ x: 0, y: 0 });
    }

    const cullRadiusSq = this.options.cullRadius * this.options.cullRadius;
    const isNearFocus = (entity) => focusPoints.some((focus) => distanceSquared(entity, focus) <= cullRadiusSq);

    for (const [id, entity] of this.food.entries()) {
      if (!isNearFocus(entity)) {
        this.food.delete(id);
      }
    }
    for (const [id, entity] of this.addons.entries()) {
      if (!isNearFocus(entity)) {
        this.addons.delete(id);
      }
    }
    for (const [id, entity] of this.npcs.entries()) {
      if (!isNearFocus(entity)) {
        this.npcs.delete(id);
      }
    }
  }

  updatePlayers(dt) {
    for (const player of this.players.values()) {
      if (!player.alive) {
        if (player.respawnAt && this.now >= player.respawnAt) {
          this.respawnPlayer(player);
        }
        continue;
      }
      if (player.won) {
        continue;
      }
      if (this.checkPlayerVictory(player)) {
        continue;
      }

      this.expireAddons(player);
      this.applyMagnet(player, dt);

      const bonuses = this.getPlayerBonuses(player);
      const creature = getCreatureDefinition(player.creatureId);
      const massSlowdown = clamp(
        1.2 - Math.log2(Math.max(1, player.mass / creature.baseMass)) * 0.045,
        0.68,
        1.22
      );
      let speedMultiplier = bonuses.speedMultiplier * massSlowdown * 1.12;
      let accelerationMultiplier = 1.48;

      if (player.input.boost && player.mass > creature.baseMass * 1.12) {
        speedMultiplier *= 1.36;
        accelerationMultiplier = 1.85;
        player.mass = Math.max(creature.baseMass, player.mass - player.mass * 0.006 * dt);
      }

      this.applyMovement(player, player.input, dt, speedMultiplier, accelerationMultiplier);
      player.radius = radiusForCreature(player.creatureId, player.mass);
      this.checkPlayerVictory(player);
    }
  }

  updateNpcs(dt) {
    for (const npc of this.npcs.values()) {
      if (this.now >= npc.ai.retargetAt) {
        npc.ai = this.chooseNpcIntent(npc);
      }

      const creature = getCreatureDefinition(npc.creatureId);
      const massSlowdown = clamp(
        1.1 - Math.log2(Math.max(1, npc.mass / creature.baseMass)) * 0.045,
        0.55,
        1.12
      );
      this.applyMovement(npc, npc.ai, dt, massSlowdown, 1);
      npc.radius = radiusForCreature(npc.creatureId, npc.mass);
    }
  }

  chooseNpcIntent(npc) {
    let nearestPrey = null;
    let nearestThreat = null;
    let nearestPreyDistance = Infinity;
    let nearestThreatDistance = Infinity;
    const perception = clamp(900 + npc.radius * 6, 900, 1900);
    const perceptionSq = perception * perception;

    for (const player of this.players.values()) {
      if (!player.alive || player.won) {
        continue;
      }
      const d2 = distanceSquared(npc, player);
      if (d2 > perceptionSq) {
        continue;
      }
      if (canConsume(npc, player) && d2 < nearestPreyDistance) {
        nearestPrey = player;
        nearestPreyDistance = d2;
      }
      if (canConsume(player, npc, this.getPlayerBonuses(player)) && d2 < nearestThreatDistance) {
        nearestThreat = player;
        nearestThreatDistance = d2;
      }
    }

    if (nearestThreat) {
      const away = normalize(npc.x - nearestThreat.x, npc.y - nearestThreat.y);
      return {
        x: away.x,
        y: away.y,
        retargetAt: this.now + this.rng.float(250, 650)
      };
    }

    if (nearestPrey) {
      const toward = normalize(nearestPrey.x - npc.x, nearestPrey.y - npc.y);
      return {
        x: toward.x,
        y: toward.y,
        retargetAt: this.now + this.rng.float(220, 520)
      };
    }

    const wander = normalize(this.rng.float(-1, 1), this.rng.float(-1, 1));
    return {
      x: wander.x,
      y: wander.y,
      retargetAt: this.now + this.rng.float(700, 2600)
    };
  }

  applyMovement(entity, input, dt, speedMultiplier = 1, accelerationMultiplier = 1) {
    const creature = getCreatureDefinition(entity.creatureId);
    const movement = creature.movement;
    const desired = normalize(input.x, input.y);
    let inputX = desired.x;
    let inputY = desired.y;
    const edgeDistance = Math.hypot(entity.x, entity.y);
    if (!this.endless && edgeDistance > this.radius * 0.86) {
      inputX -= (entity.x / edgeDistance) * 0.8;
      inputY -= (entity.y / edgeDistance) * 0.8;
      const corrected = normalize(inputX, inputY);
      inputX = corrected.x;
      inputY = corrected.y;
    }

    entity.vx += inputX * movement.acceleration * accelerationMultiplier * dt;
    entity.vy += inputY * movement.acceleration * accelerationMultiplier * dt;

    if (entity.kind === "player" && desired.length > 0) {
      const response = clamp(dt * 10, 0, 1);
      const desiredSpeed = movement.maxSpeed * speedMultiplier;
      entity.vx += (inputX * desiredSpeed - entity.vx) * response * 0.32;
      entity.vy += (inputY * desiredSpeed - entity.vy) * response * 0.32;
    }

    const drag = Math.pow(movement.drag, dt * 5.8);
    entity.vx *= drag;
    entity.vy *= drag;

    const speed = Math.hypot(entity.vx, entity.vy);
    const maxSpeed = movement.maxSpeed * speedMultiplier;
    if (speed > maxSpeed) {
      entity.vx = (entity.vx / speed) * maxSpeed;
      entity.vy = (entity.vy / speed) * maxSpeed;
    }

    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;

    const movementAngle = Math.atan2(entity.vy, entity.vx);
    if (speed > 5) {
      const turnLerp = entity.kind === "player" ? clamp(movement.turnLerp + 0.16, 0, 0.52) : movement.turnLerp;
      entity.heading = angleLerp(entity.heading, movementAngle, turnLerp);
    }

    if (!this.endless) {
      keepInsideCircle(entity, this.radius - entity.radius - 20);
    }
  }

  applyMagnet(player, dt) {
    const bonuses = this.getPlayerBonuses(player);
    const magnetRadius = player.radius + bonuses.magnetRadius;
    const magnetRadiusSq = magnetRadius * magnetRadius;
    const pull = clamp(3.8 + player.radius / 80, 3.8, 6.5) * dt;

    for (const collection of [this.food, this.addons]) {
      for (const entity of collection.values()) {
        const d2 = distanceSquared(player, entity);
        if (d2 > magnetRadiusSq || d2 <= 1) {
          continue;
        }
        const d = Math.sqrt(d2);
        entity.x += ((player.x - entity.x) / d) * magnetRadius * pull;
        entity.y += ((player.y - entity.y) / d) * magnetRadius * pull;
      }
    }
  }

  resolveCollisions() {
    for (const player of this.players.values()) {
      if (!player.alive || player.won) {
        continue;
      }

      for (const addon of [...this.addons.values()]) {
        if (isTouching(player, addon, 16)) {
          this.collectAddon(player, addon);
        }
      }

      for (const food of [...this.food.values()]) {
        if (isTouching(player, food) && canConsume(player, food, this.getPlayerBonuses(player))) {
          this.consumeFood(player, food);
          if (player.won) {
            break;
          }
        }
      }

      if (player.won) {
        continue;
      }

      for (const npc of [...this.npcs.values()]) {
        if (!isTouching(player, npc)) {
          continue;
        }
        if (canConsume(player, npc, this.getPlayerBonuses(player))) {
          this.consumeNpc(player, npc);
          if (player.won) {
            break;
          }
        } else if (canConsume(npc, player)) {
          const consumed = this.consumePlayer(npc, player);
          if (!consumed && player.alive && this.npcs.has(npc.id)) {
            separateEntities(player, npc);
          }
        } else {
          separateEntities(player, npc);
        }
      }
    }

    const players = [...this.players.values()].filter((player) => player.alive && !player.won);
    for (let index = 0; index < players.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < players.length; otherIndex += 1) {
        const first = players[index];
        const second = players[otherIndex];
        if (!first.alive || !second.alive || first.won || second.won) {
          continue;
        }
        if (!isTouching(first, second)) {
          continue;
        }
        if (canConsume(first, second, this.getPlayerBonuses(first))) {
          this.consumePlayer(first, second);
        } else if (canConsume(second, first, this.getPlayerBonuses(second))) {
          this.consumePlayer(second, first);
        } else {
          separateEntities(first, second);
        }
      }
    }

    for (const npc of this.npcs.values()) {
      for (const food of [...this.food.values()]) {
        if (isTouching(npc, food) && canConsume(npc, food)) {
          this.consumeFood(npc, food);
          break;
        }
      }
    }
  }

  consumeFood(consumer, food) {
    this.food.delete(food.id);
    const digestion = consumer.kind === "player" ? this.getPlayerBonuses(consumer).digestionMultiplier : 0.38;
    if (consumer.kind === "player") {
      this.addMass(consumer, food.mass * digestion);
      consumer.eatenCount += 1;
      this.events.push({ type: "ate_food", playerId: consumer.id, foodId: food.foodId });
    } else {
      consumer.mass += food.mass * digestion;
    }
  }

  consumeNpc(player, npc) {
    this.npcs.delete(npc.id);
    const bonuses = this.getPlayerBonuses(player);
    this.addMass(player, npc.mass * 0.72 * bonuses.digestionMultiplier);
    player.eatenCount += 1;
    this.events.push({
      type: "ate_creature",
      playerId: player.id,
      creatureId: npc.creatureId,
      mass: Math.round(npc.mass)
    });
  }

  consumePlayer(consumer, victim) {
    if (!victim.alive || this.now < victim.invulnerableUntil) {
      return false;
    }

    if (victim.shieldCharges > 0) {
      victim.shieldCharges -= 1;
      victim.mass = Math.max(getCreatureDefinition(victim.creatureId).baseMass, victim.mass * 0.88);
      victim.invulnerableUntil = this.now + 1800;
      const away = normalize(victim.x - consumer.x, victim.y - consumer.y);
      victim.vx += away.x * 520;
      victim.vy += away.y * 520;
      this.events.push({
        type: "shield_block",
        playerId: victim.id,
        attackerId: consumer.id,
        attackerName: consumer.name ?? getCreatureDefinition(consumer.creatureId).name
      });
      return false;
    }

    const gainedMass = victim.mass * (consumer.kind === "player" ? 0.44 : 0.18);
    if (consumer.kind === "player") {
      this.addMass(consumer, gainedMass);
      consumer.playerKills += 1;
    } else {
      consumer.mass += gainedMass;
    }

    victim.alive = false;
    victim.respawnAt = this.now + 2800;
    victim.deathCount += 1;
    victim.lastEatenBy = consumer.name ?? getCreatureDefinition(consumer.creatureId).name;
    victim.addons = [];
    victim.shieldCharges = 0;
    victim.vx = 0;
    victim.vy = 0;

    this.events.push({
      type: "player_eaten",
      victimId: victim.id,
      victimName: victim.name,
      predatorId: consumer.id,
      predatorName: victim.lastEatenBy
    });
    return true;
  }

  addMass(entity, amount) {
    entity.mass += amount;
    if (entity.kind === "player") {
      this.checkPlayerVictory(entity);
    }
  }

  checkPlayerVictory(player) {
    if (!player.alive || player.won || player.mass < PLAYER_MAX_MASS) {
      return false;
    }

    player.mass = PLAYER_MAX_MASS;
    player.radius = radiusForCreature(player.creatureId, PLAYER_MAX_MASS);
    player.won = true;
    player.wonAt = this.now;
    player.vx = 0;
    player.vy = 0;
    player.input = { x: 0, y: 0, boost: false };
    player.addons = [];
    player.shieldCharges = 0;
    player.invulnerableUntil = this.now + 86_400_000;
    this.events.push({
      type: "player_won",
      playerId: player.id,
      playerName: player.name,
      mass: Math.round(player.mass)
    });
    return true;
  }

  collectAddon(player, addon) {
    const definition = getAddonDefinition(addon.addonId);
    this.addons.delete(addon.id);

    const sameAddon = player.addons.filter(
      (active) => active.addonId === addon.addonId && active.expiresAt > this.now
    );
    if (sameAddon.length >= definition.maxStacks) {
      sameAddon[0].expiresAt = this.now + definition.durationMs;
    } else {
      player.addons.push({
        addonId: addon.addonId,
        expiresAt: this.now + definition.durationMs,
        angle: this.rng.float(0, Math.PI * 2)
      });
    }

    if (definition.effects.shieldCharges) {
      player.shieldCharges = Math.min(
        definition.maxStacks,
        player.shieldCharges + definition.effects.shieldCharges
      );
    }

    this.events.push({ type: "collected_addon", playerId: player.id, addonId: addon.addonId });
  }

  expireAddons(player) {
    player.addons = player.addons.filter((addon) => addon.expiresAt > this.now);
  }

  getPlayerBonuses(player) {
    this.expireAddons(player);
    const bonuses = {
      speedMultiplier: 1,
      magnetRadius: 96,
      digestionMultiplier: 1.65,
      biteRatioBonus: 0.04,
      orbitDamage: 0
    };

    for (const active of player.addons) {
      const effects = getAddonDefinition(active.addonId).effects;
      bonuses.speedMultiplier += effects.speedMultiplier ?? 0;
      bonuses.magnetRadius += effects.magnetRadius ?? 0;
      bonuses.digestionMultiplier += effects.digestionMultiplier ?? 0;
      bonuses.biteRatioBonus += effects.biteRatioBonus ?? 0;
      bonuses.orbitDamage += effects.orbitDamage ?? 0;
    }

    return bonuses;
  }

  respawnPlayer(player) {
    const creature = getCreatureDefinition(player.creatureId);
    const spawn = this.randomSpawnPoint(600);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.heading = this.rng.float(-Math.PI, Math.PI);
    player.mass = creature.baseMass;
    player.radius = radiusForCreature(creature.id, creature.baseMass);
    player.alive = true;
    player.respawnAt = null;
    player.invulnerableUntil = this.now + 2600;
    player.lastEatenBy = null;
    player.won = false;
    player.wonAt = null;
    player.input = { x: 0, y: 0, boost: false };
    this.events.push({ type: "player_respawned", playerId: player.id, name: player.name });
  }

  updateScores() {
    for (const player of this.players.values()) {
      const score = Math.floor(player.mass * 10 + player.eatenCount * 18 + player.playerKills * 300);
      player.score = Math.max(player.score, score);
      this.recordLeaderboardScore(player);
    }
  }

  recordLeaderboardScore(player) {
    const key = player.leaderboardId ?? player.id;
    const existing = this.leaderboard.get(key);
    const score = Math.max(existing?.score ?? 0, player.score);
    const mass = Math.max(existing?.mass ?? 0, Math.round(player.mass));
    this.leaderboard.set(key, {
      id: key,
      name: player.name,
      score,
      mass,
      stage: getGrowthStage(player.creatureId, Math.max(player.mass, existing?.mass ?? player.mass)).label,
      creatureId: player.creatureId,
      alive: player.alive,
      won: Boolean(existing?.won || player.won),
      updatedAt: Math.round(this.now)
    });
  }
}

export function sanitizeName(name) {
  return String(name ?? "")
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

export function isValidPlayerName(name) {
  return sanitizeName(name).length > 0;
}

function serializeEntity(entity, now) {
  const serialized = {
    id: entity.id,
    kind: entity.kind,
    x: roundForNetwork(entity.x),
    y: roundForNetwork(entity.y),
    mass: Math.round(entity.mass ?? 0),
    radius: roundForNetwork(entity.radius),
    heading: Number((entity.heading ?? entity.spin ?? 0).toFixed(3))
  };

  if (entity.kind === "player") {
    serialized.name = entity.name;
    serialized.creatureId = entity.creatureId;
    serialized.alive = entity.alive;
    serialized.won = entity.won;
    serialized.wonAt = entity.wonAt === null ? null : Math.round(entity.wonAt);
    serialized.score = entity.score;
    serialized.stage = getGrowthStage(entity.creatureId, entity.mass).label;
    serialized.shieldCharges = entity.shieldCharges;
    serialized.invulnerable = now < entity.invulnerableUntil;
    serialized.addons = entity.addons
      .filter((addon) => addon.expiresAt > now)
      .map((addon) => ({
        addonId: addon.addonId,
        angle: Number(addon.angle.toFixed(3)),
        remainingMs: Math.round(addon.expiresAt - now)
      }));
    serialized.lastEatenBy = entity.lastEatenBy;
  } else if (entity.kind === "npc") {
    serialized.creatureId = entity.creatureId;
  } else if (entity.kind === "food") {
    serialized.foodId = entity.foodId;
  } else if (entity.kind === "addon") {
    serialized.addonId = entity.addonId;
  }

  return serialized;
}

function roundForNetwork(value) {
  return Number(value.toFixed(2));
}

function weightedPick(rng, table) {
  const totalWeight = table.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.float(0, totalWeight);
  for (const item of table) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.id;
    }
  }
  return table.at(-1).id;
}

function isTouching(first, second, extra = 0) {
  const radius = first.radius + second.radius + extra;
  return distanceSquared(first, second) <= radius * radius;
}

function separateEntities(first, second) {
  const direction = normalize(first.x - second.x, first.y - second.y);
  const overlap = Math.max(0, first.radius + second.radius - Math.sqrt(distanceSquared(first, second)));
  first.x += direction.x * overlap * 0.5;
  first.y += direction.y * overlap * 0.5;
  second.x -= direction.x * overlap * 0.5;
  second.y -= direction.y * overlap * 0.5;
}

export function catalogForClient() {
  return {
    creatures: CREATURE_CATALOG,
    food: FOOD_CATALOG,
    addons: ADDON_CATALOG
  };
}
