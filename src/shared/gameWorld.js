import {
  ADDON_CATALOG,
  CREATURE_CATALOG,
  PLAYER_FULL_SCREEN_MASS,
  PLAYER_MAX_MASS,
  FOOD_CATALOG,
  PLAYABLE_CREATURE_IDS,
  canConsume,
  getAddonDefinition,
  getCreatureDefinition,
  getFoodDefinition,
  getGrowthStage,
  getHazardDefinition,
  HAZARD_CATALOG,
  radiusForCreature,
  resolveTraitBonuses,
  traitHazardDrainResist
} from "./creatureCatalog.js";
import { angleLerp, clamp, distanceSquared, keepInsideCircle, normalize } from "./math.js";
import { createRng } from "./random.js";
import { OCEAN_FLOOR_Y, OCEAN_SURFACE_Y, locationAt, regionAt, zoneAt } from "./geography.js";
import { speciesSpawnEntries } from "./speciesCatalog.js";

const DEFAULT_OPTIONS = Object.freeze({
  endless: true,
  radius: 7200,
  activeRadius: 5200,
  spawnRadius: 4600,
  cullRadius: 12000,
  maxFood: 900,
  maxNpcs: 140,
  maxAddons: 48,
  maxHazards: 16,
  foodPerPlayer: 310,
  npcsPerPlayer: 44,
  addonsPerPlayer: 13,
  hazardsPerPlayer: 6,
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

// Real species tagged by the biome they live in. Spawn tables are filtered by
// the region/zone at each spawn point and cached, so the plane can hold
// thousands of species without re-filtering the list on every spawn.
const SPECIES_SPAWN_ENTRIES = Object.freeze(speciesSpawnEntries());
const speciesPoolCache = new Map();

function speciesPoolFor(region, zone) {
  const key = `${region}|${zone}`;
  const cached = speciesPoolCache.get(key);
  if (cached) {
    return cached;
  }
  const pool = SPECIES_SPAWN_ENTRIES.filter(
    (entry) =>
      (entry.regions.length === 0 || entry.regions.includes(region)) &&
      (entry.zones.length === 0 || entry.zones.includes(zone))
  ).map((entry) => ({ id: entry.id, weight: entry.weight }));
  speciesPoolCache.set(key, pool);
  return pool;
}

const ADDON_SPAWNS = Object.freeze(
  Object.keys(ADDON_CATALOG).map((id) => ({ id, weight: id === "pearl_shield" ? 5 : 10 }))
);

const HAZARD_SPAWNS = Object.freeze([
  { id: "drift_net", weight: 8 },
  { id: "maelstrom", weight: 5 }
]);

const LEGACY_APEX_MASS = 3100;

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
    this.hazards = new Map();
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
    while (this.hazards.size < this.options.maxHazards) {
      this.spawnHazard();
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
      wonAt: null,
      // Last announced growth stage, so we only broadcast a milestone when a
      // player advances to a new, larger stage.
      lastStageMin: getGrowthStage(creature.id, creature.baseMass).minMass
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
    if (!player) {
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

  spawnNpc(creatureId, position) {
    if (position === undefined) {
      position = this.randomSpawnPoint(500);
    }
    if (creatureId === undefined) {
      creatureId = this.pickSpeciesForLocation(position);
    }
    const creature = getCreatureDefinition(creatureId);
    const mass = this.rollNpcMass(creature);
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

  // Choose a species that really lives in the biome at this point. Falls back to
  // the legacy global table when a biome's real-species pool is too thin, so no
  // region is ever a dead zone.
  pickSpeciesForLocation(position) {
    const { region, zone } = locationAt(position.x, position.y);
    const pool = speciesPoolFor(region.id, zone.id);
    if (pool.length >= 3) {
      return weightedPick(this.rng, pool);
    }
    if (pool.length > 0 && this.rng.chance(0.6)) {
      return weightedPick(this.rng, pool);
    }
    return weightedPick(this.rng, NPC_SPAWNS);
  }

  // Spawn at a random life stage (weighted toward the young) and land the mass
  // inside that stage's band, so juveniles and fry genuinely appear and the
  // "[name] · [phase] · [size]" label varies. Single-stage legacy NPCs keep the
  // original near-adult jitter.
  rollNpcMass(creature) {
    const stages = creature.stages;
    if (!creature.speciesBuilt || stages.length <= 1) {
      return creature.baseMass * this.rng.float(0.86, 1.28);
    }
    const index = this.rng.int(0, stages.length - 1);
    const floor = stages[index].minMass;
    const ceil = stages[index + 1]?.minMass ?? creature.baseMass * 1.3;
    return this.rng.float(floor, Math.max(floor * 1.02, ceil * 0.98));
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

  spawnHazard(hazardType = weightedPick(this.rng, HAZARD_SPAWNS), position = this.randomHazardPoint()) {
    const definition = getHazardDefinition(hazardType);
    const scale = this.rng.float(0.85, 1.3);
    const baseRadius = definition.influenceRadius ?? definition.radius;
    const entity = {
      id: this.createId("hazard"),
      kind: "hazard",
      hazardType: definition.id,
      x: position.x,
      y: position.y,
      scale,
      mass: definition.baseMass ? definition.baseMass * scale : 0,
      radius: baseRadius * scale,
      spin: this.rng.float(-Math.PI, Math.PI)
    };
    // A maelstrom takes the real whirlpool name of the sea it spins in.
    if (definition.id === "maelstrom") {
      entity.name = regionAt(position.x, position.y).whirlpool;
    }
    this.resizeHazard(entity);
    this.hazards.set(entity.id, entity);
    return entity;
  }

  // A fed maelstrom widens and a ground-down one tightens: radius follows the
  // vortex's current mass relative to what it spawned with.
  resizeHazard(hazard) {
    const definition = getHazardDefinition(hazard.hazardType);
    if (!definition.baseMass) {
      return;
    }
    const baseRadius = (definition.influenceRadius ?? definition.radius) * hazard.scale;
    const massRatio = Math.max(0.05, hazard.mass / (definition.baseMass * hazard.scale));
    hazard.radius = baseRadius * clamp(Math.pow(massRatio, 0.33), 0.45, 2.6);
  }

  randomHazardPoint() {
    let point = this.randomSpawnPoint(420);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const tooClose = [...this.players.values()].some(
        (player) => player.alive && distanceSquared(player, point) < 640 * 640
      );
      if (!tooClose) {
        break;
      }
      point = this.randomSpawnPoint(420);
    }
    return point;
  }

  tick(dtMs = 50) {
    const cappedDtMs = clamp(dtMs, 1, 120);
    const dt = cappedDtMs / 1000;
    this.now += cappedDtMs;

    this.maintainPopulation();
    this.updatePlayers(dt);
    this.updateNpcs(dt);
    this.updateHazards(dt);
    this.resolveCollisions();
    this.updateScores();
  }

  getSnapshot(playerId = null) {
    const viewer = playerId ? this.players.get(playerId) : null;
    const center = viewer && (viewer.alive || viewer.won) ? viewer : { x: 0, y: 0, radius: 0 };
    // Giants see (and are streamed) a much wider slice of ocean so the world
    // still surrounds them once the camera has zoomed far out.
    const viewRadius = viewer ? clamp(2600 + viewer.radius * 12, 2600, 11000) : this.options.activeRadius;
    const visible = (entity) => {
      const range = viewRadius + entity.radius + 200;
      return distanceSquared(center, entity) <= range * range;
    };

    return {
      type: "snapshot",
      now: Math.round(this.now),
      playerId,
      world: {
        endless: this.endless,
        radius: this.endless ? null : this.radius,
        fullScreenMass: PLAYER_FULL_SCREEN_MASS
      },
      self: viewer ? serializeEntity(viewer, this.now) : null,
      players: [...this.players.values()]
        .filter((player) => player.alive || player.won)
        .map((player) => serializeEntity(player, this.now)),
      npcs: [...this.npcs.values()].filter(visible).map((npc) => serializeEntity(npc, this.now)),
      food: [...this.food.values()].filter(visible).map((food) => serializeEntity(food, this.now)),
      addons: [...this.addons.values()].filter(visible).map((addon) => serializeEntity(addon, this.now)),
      hazards: [...this.hazards.values()].filter(visible).map((hazard) => serializeEntity(hazard, this.now)),
      leaderboard: this.getLeaderboard()
    };
  }

  getLeaderboard(limit = 10) {
    const onlineIds = new Set([...this.players.values()].map((player) => player.leaderboardId ?? player.id));
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
        online: onlineIds.has(entry.id),
        updatedAt: entry.updatedAt
      }));
  }

  // Full leaderboard snapshot for persistence (top scores only, so the saved
  // file stays bounded even after thousands of sessions). Pure data — the
  // server layer owns the actual file I/O, keeping this module browser-safe.
  exportLeaderboard(limit = 200) {
    return [...this.leaderboard.values()]
      .sort((a, b) => b.score - a.score || b.mass - a.mass)
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        score: entry.score,
        mass: Math.round(entry.mass),
        stage: entry.stage,
        creatureId: entry.creatureId,
        won: Boolean(entry.won),
        updatedAt: entry.updatedAt
      }));
  }

  // Restore persisted high scores on startup. Loaded entries are historical, so
  // they start not-alive; a returning session keeps the higher of saved vs new.
  importLeaderboard(entries) {
    if (!Array.isArray(entries)) {
      return;
    }
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || typeof entry.score !== "number") {
        continue;
      }
      const existing = this.leaderboard.get(entry.id);
      if (existing && existing.score >= entry.score) {
        continue;
      }
      this.leaderboard.set(entry.id, {
        id: entry.id,
        name: sanitizeName(entry.name) || "Deep One",
        score: entry.score,
        mass: Math.round(entry.mass ?? 0),
        stage: entry.stage ?? "Hatchling",
        creatureId: entry.creatureId ?? "abyssal_serpent",
        alive: false,
        won: Boolean(entry.won),
        updatedAt: entry.updatedAt ?? 0
      });
    }
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
      // Keep spawns inside the vertical ocean (surface → floor).
      y: clamp(focus.y + Math.sin(angle) * distance, OCEAN_SURFACE_Y + 200, OCEAN_FLOOR_Y - 200)
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
    const targetHazards = Math.min(this.options.maxHazards, Math.max(0, focusCount * this.options.hazardsPerPlayer));

    for (let index = 0; index < 34 && this.food.size < targetFood; index += 1) {
      this.spawnFood();
    }
    for (let index = 0; index < 5 && this.npcs.size < targetNpcs; index += 1) {
      this.spawnNpc();
    }
    for (let index = 0; index < 3 && this.addons.size < targetAddons; index += 1) {
      this.spawnAddon();
    }
    for (let index = 0; index < 2 && this.hazards.size < targetHazards; index += 1) {
      this.spawnHazard();
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
    for (const [id, entity] of this.hazards.entries()) {
      if (!isNearFocus(entity)) {
        this.hazards.delete(id);
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
        const boostCost = 0.006 * (bonuses.boostMassCostMultiplier ?? 1);
        player.mass = Math.max(creature.baseMass, player.mass - player.mass * boostCost * dt);
      }

      this.applyMovement(player, player.input, dt, speedMultiplier, accelerationMultiplier, bonuses.turnLerpBonus);
      player.radius = radiusForCreature(player.creatureId, player.mass);
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
      if (!player.alive) {
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

  updateHazards(dt) {
    if (this.hazards.size === 0) {
      return;
    }

    for (const player of this.players.values()) {
      if (!player.alive || this.now < player.invulnerableUntil) {
        continue;
      }

      for (const hazard of this.hazards.values()) {
        const definition = getHazardDefinition(hazard.hazardType);
        const distance = Math.sqrt(distanceSquared(player, hazard));
        if (distance >= hazard.radius) {
          continue;
        }

        if (hazard.hazardType === "maelstrom") {
          this.resolveMaelstromTug(player, hazard, definition, distance, dt);
        } else {
          const slow = Math.pow(definition.dragFactor, dt * 5.8);
          player.vx *= slow;
          player.vy *= slow;
          const drainResist = traitHazardDrainResist(player.creatureId, hazard.hazardType);
          const drainRate = definition.drainPerSecond * (1 - drainResist);
          this.drainHazardMass(player, drainRate * dt);
        }
      }
    }

    this.feedMaelstromsWithNpcs(dt);
  }

  // The tug of war: whichever side outweighs the other drains its opponent.
  // Losing mass to the vortex makes it stronger; grinding it down weakens its
  // pull until it collapses and is consumed.
  resolveMaelstromTug(player, hazard, definition, distance, dt) {
    const overpowering = player.mass >= hazard.mass * definition.overpowerRatio;
    const proximity = 1 - distance / hazard.radius;

    if (distance > 1) {
      const direction = normalize(hazard.x - player.x, hazard.y - player.y);
      const pullResist = this.getPlayerBonuses(player).maelstromPullResist ?? 0;
      const pullStrength = definition.pull * (overpowering ? 0.25 : 1) * (1 - pullResist);
      player.vx += direction.x * pullStrength * proximity * dt;
      player.vy += direction.y * pullStrength * proximity * dt;
    }

    if (distance >= maelstromCoreRadius(hazard, definition)) {
      return;
    }

    if (overpowering) {
      const ground = hazard.mass * Math.min(0.9, definition.grindPerSecond * dt);
      hazard.mass -= ground;
      this.addMass(player, ground * definition.consumeGain);
      player.radius = radiusForCreature(player.creatureId, player.mass);
      if (hazard.mass <= definition.collapseMass) {
        this.addMass(player, hazard.mass * definition.consumeGain);
        this.hazards.delete(hazard.id);
        this.events.push({
          type: "hazard_consumed",
          playerId: player.id,
          playerName: player.name,
          hazardType: hazard.hazardType,
          hazardName: hazard.name ?? definition.name
        });
        return;
      }
      this.resizeHazard(hazard);
      return;
    }

    const drained = this.drainHazardMass(player, definition.drainPerSecond * dt);
    if (drained.amount > 0) {
      hazard.mass = Math.min(definition.maxMass, hazard.mass + drained.amount);
      this.resizeHazard(hazard);
    }
    if (drained.reachedFloor && definition.lethal) {
      this.killByHazard(player, hazard.name ?? definition.name);
      hazard.mass = Math.min(definition.maxMass, hazard.mass + drained.floorRemainder);
      this.resizeHazard(hazard);
    }
  }

  // Vortices also graze on wildlife that wanders into the core, so an
  // unattended maelstrom slowly fattens on the ecosystem around it.
  feedMaelstromsWithNpcs(dt) {
    for (const hazard of this.hazards.values()) {
      const definition = getHazardDefinition(hazard.hazardType);
      if (hazard.hazardType !== "maelstrom" || hazard.mass >= definition.maxMass) {
        continue;
      }
      const core = maelstromCoreRadius(hazard, definition);
      const coreSq = core * core;
      for (const npc of this.npcs.values()) {
        if (distanceSquared(npc, hazard) > coreSq) {
          continue;
        }
        const bite = npc.mass * definition.drainPerSecond * dt;
        npc.mass -= bite;
        hazard.mass = Math.min(definition.maxMass, hazard.mass + bite);
        if (npc.mass < getCreatureDefinition(npc.creatureId).baseMass * 0.4) {
          hazard.mass = Math.min(definition.maxMass, hazard.mass + npc.mass);
          this.npcs.delete(npc.id);
        } else {
          npc.radius = radiusForCreature(npc.creatureId, npc.mass);
        }
      }
      this.resizeHazard(hazard);
    }
  }

  drainHazardMass(player, fraction) {
    const baseMass = getCreatureDefinition(player.creatureId).baseMass;
    const next = player.mass * (1 - fraction);
    if (next <= baseMass) {
      const amount = Math.max(0, player.mass - baseMass);
      player.mass = baseMass;
      player.radius = radiusForCreature(player.creatureId, player.mass);
      return { amount, reachedFloor: true, floorRemainder: baseMass * 0.5 };
    }
    const amount = player.mass - next;
    player.mass = next;
    player.radius = radiusForCreature(player.creatureId, player.mass);
    return { amount, reachedFloor: false, floorRemainder: 0 };
  }

  killByHazard(player, cause) {
    if (!player.alive || this.now < player.invulnerableUntil) {
      return;
    }
    player.alive = false;
    player.respawnAt = this.now + 2800;
    player.deathCount += 1;
    player.lastEatenBy = cause;
    player.addons = [];
    player.shieldCharges = 0;
    player.vx = 0;
    player.vy = 0;
    this.events.push({
      type: "player_eaten",
      victimId: player.id,
      victimName: player.name,
      predatorId: null,
      predatorName: cause
    });
  }

  applyMovement(entity, input, dt, speedMultiplier = 1, accelerationMultiplier = 1, turnLerpBonus = 0) {
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
      const turnLerp =
        entity.kind === "player"
          ? clamp(movement.turnLerp + turnLerpBonus + 0.16, 0, 0.58)
          : movement.turnLerp;
      entity.heading = angleLerp(entity.heading, movementAngle, turnLerp);
    }

    if (!this.endless) {
      keepInsideCircle(entity, this.radius - entity.radius - 20);
    } else {
      this.keepWithinOcean(entity);
    }
  }

  // The surface and hadal floor are hard boundaries — you cannot swim out of the
  // ocean. Velocity into the boundary is bled off so you glide along it rather
  // than sticking.
  keepWithinOcean(entity) {
    const margin = (entity.radius ?? 0) + 12;
    const ceiling = OCEAN_SURFACE_Y + margin;
    const floor = OCEAN_FLOOR_Y - margin;
    if (entity.y < ceiling) {
      entity.y = ceiling;
      if (entity.vy < 0) {
        entity.vy *= -0.2;
      }
    } else if (entity.y > floor) {
      entity.y = floor;
      if (entity.vy > 0) {
        entity.vy *= -0.2;
      }
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
      if (!player.alive) {
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
        }
      }

      for (const npc of [...this.npcs.values()]) {
        if (!isTouching(player, npc)) {
          continue;
        }
        if (canConsume(player, npc, this.getPlayerBonuses(player))) {
          this.consumeNpc(player, npc);
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

    const players = [...this.players.values()].filter((player) => player.alive);
    for (let index = 0; index < players.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < players.length; otherIndex += 1) {
        const first = players[index];
        const second = players[otherIndex];
        if (!first.alive || !second.alive) {
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
    let digestion = consumer.kind === "player" ? this.getPlayerBonuses(consumer).digestionMultiplier : 0.38;
    if (consumer.kind === "player") {
      const tagBonus = this.getPlayerBonuses(consumer).tagDigestionBonus ?? {};
      for (const tag of getFoodDefinition(food.foodId).tags) {
        digestion += tagBonus[tag] ?? 0;
      }
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
    let growthMultiplier = 1;
    if (entity.kind === "player") {
      growthMultiplier = this.getPlayerBonuses(entity).growthMultiplier ?? 1;
    }
    const growthAmount =
      entity.kind === "player" ? amount * playerGrowthEfficiency(entity.mass) * growthMultiplier : amount;
    entity.mass += growthAmount;
    if (entity.kind === "player" && entity.mass > PLAYER_MAX_MASS) {
      entity.mass = PLAYER_MAX_MASS;
    }
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
      orbitDamage: 0,
      turnLerpBonus: 0,
      growthMultiplier: 1,
      boostMassCostMultiplier: 1,
      maelstromPullResist: 0,
      tagDigestionBonus: {}
    };

    for (const active of player.addons) {
      const effects = getAddonDefinition(active.addonId).effects;
      bonuses.speedMultiplier += effects.speedMultiplier ?? 0;
      bonuses.magnetRadius += effects.magnetRadius ?? 0;
      bonuses.digestionMultiplier += effects.digestionMultiplier ?? 0;
      bonuses.biteRatioBonus += effects.biteRatioBonus ?? 0;
      bonuses.orbitDamage += effects.orbitDamage ?? 0;
    }

    const zoneId = zoneAt(player.x, player.y).id;
    const traitBonuses = resolveTraitBonuses(player.creatureId, { zoneId, mass: player.mass });
    bonuses.speedMultiplier += traitBonuses.speedMultiplier;
    bonuses.turnLerpBonus += traitBonuses.turnLerpBonus;
    bonuses.magnetRadius += traitBonuses.magnetRadius;
    bonuses.digestionMultiplier += traitBonuses.digestionMultiplier;
    bonuses.biteRatioBonus += traitBonuses.biteRatioBonus;
    bonuses.maelstromPullResist += traitBonuses.maelstromPullResist;
    bonuses.boostMassCostMultiplier = traitBonuses.boostMassCostMultiplier;
    bonuses.growthMultiplier = traitBonuses.growthMultiplier;

    for (const [tag, value] of Object.entries(traitBonuses.tagDigestionBonus)) {
      bonuses.tagDigestionBonus[tag] = (bonuses.tagDigestionBonus[tag] ?? 0) + value;
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
    player.lastStageMin = getGrowthStage(player.creatureId, player.mass).minMass;
    this.events.push({ type: "player_respawned", playerId: player.id, name: player.name });
  }

  updateScores() {
    for (const player of this.players.values()) {
      const score = Math.floor(player.mass * 10 + player.eatenCount * 18 + player.playerKills * 300);
      player.score = Math.max(player.score, score);
      this.recordLeaderboardScore(player);
      this.announceGrowthMilestone(player);
    }
  }

  // Broadcasts "X grew to <Stage>" the moment a living player crosses into a
  // larger growth stage — roughly a dozen milestones across a full run.
  announceGrowthMilestone(player) {
    if (!player.alive) {
      return;
    }
    const stage = getGrowthStage(player.creatureId, player.mass);
    if (stage.minMass > (player.lastStageMin ?? -1)) {
      if (player.lastStageMin !== undefined) {
        this.events.push({
          type: "player_grew",
          playerId: player.id,
          name: player.name,
          stage: stage.label,
          mass: Math.round(player.mass)
        });
      }
      player.lastStageMin = stage.minMass;
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
  } else if (entity.kind === "hazard") {
    serialized.hazardType = entity.hazardType;
    serialized.scale = Number((entity.scale ?? 1).toFixed(3));
    if (entity.name) {
      serialized.name = entity.name;
    }
  }

  return serialized;
}

function playerGrowthEfficiency(mass) {
  if (mass <= 260) {
    return 1;
  }
  if (mass <= LEGACY_APEX_MASS) {
    return clamp(1 - Math.log2(mass / 260) * 0.075, 0.62, 1);
  }
  return clamp(0.62 * Math.pow(0.74, Math.log2(mass / LEGACY_APEX_MASS)), 0.1, 0.62);
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

// The deadly core scales with the vortex's current (mass-driven) footprint.
function maelstromCoreRadius(hazard, definition) {
  const influence = definition.influenceRadius ?? hazard.radius;
  return definition.coreRadius * (hazard.radius / influence);
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
    addons: ADDON_CATALOG,
    hazards: HAZARD_CATALOG
  };
}
