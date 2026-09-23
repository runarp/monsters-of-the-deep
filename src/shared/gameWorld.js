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
  massForCreatureRadius,
  OVERSIZE_TIERS,
  radiusForCreature,
  resolveTraitBonuses,
  traitHazardDrainResist
} from "./creatureCatalog.js";
import { angleLerp, clamp, distanceSquared, keepInsideCircle, normalize } from "./math.js";
import { createRng } from "./random.js";
import { OCEAN_FLOOR_Y, OCEAN_SURFACE_Y, locationAt, regionAt, zoneAt, zoneIndexAtY } from "./geography.js";
import { speciesSpawnEntries } from "./speciesCatalog.js";

const DEFAULT_OPTIONS = Object.freeze({
  endless: true,
  radius: 7200,
  activeRadius: 5200,
  spawnRadius: 4600,
  cullRadius: 12000,
  maxFood: 1080,
  maxNpcs: 140,
  maxAddons: 48,
  maxHazards: 16,
  foodPerPlayer: 372,
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
  { id: "blue_whale", weight: 6 },
  { id: "ancient_leviathan", weight: 2 }
]);

// Fallback table for the deep zones (abyssal/hadal), where the real-species
// pool is thin by design: the baseline fauna itself skews big and predatory,
// so descending reads as entering worse waters even before oversized
// specimens appear.
const NPC_DEEP_SPAWNS = Object.freeze([
  { id: "lantern_fry", weight: 14 },
  { id: "silver_sardine", weight: 10 },
  { id: "humboldt_squid", weight: 16 },
  { id: "yellowfin_tuna", weight: 8 },
  { id: "manta_ray", weight: 10 },
  { id: "mako_shark", weight: 14 },
  { id: "blue_whale", weight: 9 },
  { id: "ancient_leviathan", weight: 9 }
]);

// Hand-authored creatures given real biome membership, so they join the
// region/zone pools alongside the real species instead of only surfacing
// through the fallback tables above. Without this a blue whale is unreachable
// anywhere the species pool is healthy — i.e. everywhere except the hadal
// floor — which is precisely where nobody swims for the first hour.
//
// Blue whales are cosmopolitan surface feeders (every ocean, sunlight and
// twilight zones); the leviathan is a monster and stays a thing of the deep.
const LEGACY_SPAWN_ENTRIES = Object.freeze([
  { id: "blue_whale", regions: [], zones: ["epipelagic", "mesopelagic"], weight: 6 },
  { id: "ancient_leviathan", regions: [], zones: ["bathypelagic", "abyssal", "hadal"], weight: 4 }
]);

// Real species tagged by the biome they live in. Spawn tables are filtered by
// the region/zone at each spawn point and cached, so the plane can hold
// thousands of species without re-filtering the list on every spawn.
const SPECIES_SPAWN_ENTRIES = Object.freeze(speciesSpawnEntries());
const speciesPoolCache = new Map();

function livesHere(entry, region, zone) {
  return (
    (entry.regions.length === 0 || entry.regions.includes(region)) &&
    (entry.zones.length === 0 || entry.zones.includes(zone))
  );
}

// A biome's spawn pool: its real species, plus any hand-authored creature that
// belongs here. `speciesCount` deliberately counts only the REAL species —
// it is what decides whether this biome's fauna is too thin to stand on its
// own, and a bolted-on monster must not be able to answer that question. Left
// to count itself, a leviathan becomes the sole "resident" of an empty hadal
// cell and takes over the sea.
function speciesPoolFor(region, zone) {
  const key = `${region}|${zone}`;
  const cached = speciesPoolCache.get(key);
  if (cached) {
    return cached;
  }
  const species = SPECIES_SPAWN_ENTRIES.filter((entry) => livesHere(entry, region, zone));
  const legacy = LEGACY_SPAWN_ENTRIES.filter((entry) => livesHere(entry, region, zone));
  const pool = {
    entries: [...species, ...legacy].map((entry) => ({ id: entry.id, weight: entry.weight })),
    speciesCount: species.length
  };
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

// How far the spawn tables lean toward the nearest player's current stage.
// These are nudges layered on top of the biome weights, not overrides: a sea
// still spawns its own fauna, it just runs a little richer in what that player
// has grown into eating, and in what has grown into eating them. Prey and
// predators are boosted by the same factor on purpose — feeding gets easier
// without the sea quietly turning into a picnic.
const PREY_WEIGHT_BIAS = 1.2;
const PREDATOR_WEIGHT_BIAS = 1.2;
// The deep's headline monster carries the predator bias further, so the added
// pressure has a face rather than being a uniform thickening of sharks.
const LEVIATHAN_WEIGHT_BIAS = 1.6;

const LEGACY_APEX_MASS = 3100;

// Every session ever seen gets a leaderboard row, so a long-running server
// would grow the table without bound. Past the high-water mark it is pruned
// back to the best scores (online sessions always kept) — far more than the
// 10 shown or the 200 persisted.
const LEADERBOARD_KEEP = 500;
const LEADERBOARD_PRUNE_AT = 1000;

// Where oversized ("Giant"/"Monster") specimens start, shared with the labels.
const OVERSIZE_MIN_RATIO = OVERSIZE_TIERS.at(-1).minRatio;
// Floor for how close an oversized predator may materialise to a player. The
// real rule is "outside the player's streamed view" (see rollNpcMass) — this
// only guards degenerate cases where the view maths would allow less.
const OVERSIZE_SAFE_DISTANCE = 1400;
// Hard sanity cap: even a gameplay monster stops at 400× its real adult mass.
const OVERSIZE_MAX_RATIO = 400;

// Apex pressure: any player past this mass is guaranteed roughly one larger
// predator prowling within this range — random oversize rolls alone leave long
// stretches where a grown player is safely the biggest thing in the sea.
const APEX_PRESSURE_MASS = LEGACY_APEX_MASS;
const APEX_PRESSURE_RANGE = 5200;
// Per-tick chance of trickling in a hunter for a player who has none nearby.
const APEX_PRESSURE_CHANCE = 0.024;
// Which hunter answers the call. Every eligible species is equally likely
// except the leviathan, which is picked far more often than its one-of-many
// share would give it — the deep's monster should be the one that comes for a
// grown player, not the 65th tuna.
const APEX_HUNTER_DEFAULT_WEIGHT = 1;
const APEX_LEVIATHAN_WEIGHT = 10;

// Species eligible to be spawned as an apex hunter: non-playable creatures
// whose diet includes apex-tagged prey, i.e. they will genuinely hunt a grown
// player once they have the size advantage.
const APEX_HUNTER_IDS = Object.freeze(
  Object.values(CREATURE_CATALOG)
    .filter(
      (creature) =>
        !creature.playable && creature.diet.some((entry) => entry.preyTags.includes("apex"))
    )
    .map((creature) => creature.id)
);

// The streamed slice of ocean around a viewer. Grows with the creature (the
// camera zooms out as you grow) and, past the old clamp, with sheer body size
// so an end-game titan still has water around it instead of only itself.
// Spawn and cull distances are derived from this: anything that materialises
// must do so relative to what the player can actually see, or late-game
// spawns pop into existence mid-screen.
function viewRadiusForRadius(radius = 0) {
  return clamp(2600 + radius * 12, 2600, Math.max(11000, radius * 3.5));
}

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

  spawnFood(foodId, position = this.randomSpawnPoint(100)) {
    if (foodId === undefined) {
      // Resolved after the position, not in the parameter list: which morsels
      // count as edible depends on who is nearest to where it lands.
      foodId = weightedPick(this.rng, this.biasFoodTableForStage(position));
    }
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
      // Creatures materialise in the outer half of the view or beyond — a fish
      // fading in near the view edge reads as "swam into sight", not pop-in.
      position = this.randomSpawnPoint(500, 0.55);
    }
    if (creatureId === undefined) {
      creatureId = this.pickSpeciesForLocation(position);
    }
    const creature = getCreatureDefinition(creatureId);
    const mass = this.rollNpcMass(creature, position);
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
    const { entries, speciesCount } = speciesPoolFor(region.id, zone.id);
    if (speciesCount >= 3) {
      return weightedPick(this.rng, this.biasPoolForStage(entries, position));
    }
    if (speciesCount > 0 && this.rng.chance(0.6)) {
      return weightedPick(this.rng, this.biasPoolForStage(entries, position));
    }
    const fallback = zoneIndexAtY(position.y) >= 3 ? NPC_DEEP_SPAWNS : NPC_SPAWNS;
    return weightedPick(this.rng, this.biasPoolForStage(fallback, position));
  }

  // Spawn at a random life stage (weighted toward the young) and land the mass
  // inside that stage's band, so juveniles and fry genuinely appear and the
  // "[name] · [phase] · [size]" label varies. Single-stage legacy NPCs keep the
  // original near-adult jitter.
  rollNpcMass(creature, position = null) {
    const stages = creature.stages;
    let mass;
    if (!creature.speciesBuilt || stages.length <= 1) {
      mass = creature.baseMass * this.rng.float(0.86, 1.28);
    } else {
      const index = this.rng.int(0, stages.length - 1);
      const floor = stages[index].minMass;
      const ceil = stages[index + 1]?.minMass ?? creature.baseMass * 1.3;
      mass = this.rng.float(floor, Math.max(floor * 1.02, ceil * 0.98));
    }
    if (!position) {
      return mass;
    }

    // Stage-progression sizing: the deeper the zone and the more dangerous the
    // sea, the larger the same species runs (ambient bias tops out around ~3×
    // adult in a danger-3 hadal trench) — dangerous regions and great depths
    // are places to avoid early and to hunt late.
    const zoneIndex = zoneIndexAtY(position.y);
    const danger = regionAt(position.x, position.y).danger ?? 1;
    mass *= this.rng.float(1, 1 + zoneIndex * 0.16 * danger);

    // Apex pacing: once the nearest player has outgrown a species' real adult,
    // that species occasionally spawns a gameplay-oversized "Giant"/"Monster"
    // specimen scaled to the local apex — so the player is never permanently
    // the biggest thing in the water. Rarer near the surface, common in the
    // deep and in dangerous seas; never dropped inside the player's view —
    // a monster must swim into sight, not blink into it.
    const local = this.nearestAlivePlayer(position);
    if (
      local &&
      local.distance >= Math.max(OVERSIZE_SAFE_DISTANCE, viewRadiusForRadius(local.player.radius)) &&
      local.player.mass > creature.baseMass * OVERSIZE_MIN_RATIO
    ) {
      const monsterChance = Math.min(0.15, 0.02 + zoneIndex * 0.015 + (danger - 1) * 0.025);
      if (this.rng.chance(monsterChance)) {
        const floor = creature.baseMass * OVERSIZE_MIN_RATIO;
        // Aim by RADIUS, not mass: species have wildly different mass→radius
        // scales, so "as big as the local apex player" must be computed as the
        // mass this species needs to present a comparable radius. Small
        // species hit the sanity cap and stay spectacle; big apex species
        // become genuine predators again.
        const targetRadius = local.player.radius * this.rng.float(0.75, 1.55);
        const ceiling = Math.max(
          floor * 1.05,
          Math.min(massForCreatureRadius(creature.id, targetRadius), creature.baseMass * OVERSIZE_MAX_RATIO)
        );
        // Top-biased roll (pow < 1 pushes toward the ceiling): an oversized
        // specimen should usually be near apex scale, not barely past Giant.
        mass = Math.max(mass, floor + (ceiling - floor) * Math.pow(this.rng.next(), 0.55));
      }
    }
    return mass;
  }

  nearestAlivePlayer(position) {
    let best = null;
    let bestD2 = Infinity;
    for (const player of this.players.values()) {
      if (!player.alive) {
        continue;
      }
      const d2 = distanceSquared(player, position);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = player;
      }
    }
    return best ? { player: best, distance: Math.sqrt(bestD2) } : null;
  }

  // Tilt a spawn pool toward the nearest player's stage of life. Species that
  // are neither prey nor predator to them keep their biome weight untouched.
  // Solo/offline and server both run this — it reads only world state.
  biasPoolForStage(pool, position) {
    const local = this.nearestAlivePlayer(position);
    if (!local) {
      return pool;
    }
    let biased = null;
    for (let index = 0; index < pool.length; index += 1) {
      const entry = pool[index];
      const bias = this.stageBiasFor(local.player, entry.id);
      if (bias === 1) {
        continue;
      }
      biased ??= pool.slice();
      biased[index] = { id: entry.id, weight: entry.weight * bias };
    }
    return biased ?? pool;
  }

  stageBiasFor(player, creatureId) {
    const probe = creatureProbe(creatureId);
    let bias = 1;
    if (canConsume(player, probe)) {
      bias *= PREY_WEIGHT_BIAS;
    }
    if (canConsume(probe, player)) {
      bias *= creatureId === "ancient_leviathan" ? LEVIATHAN_WEIGHT_BIAS : PREDATOR_WEIGHT_BIAS;
    }
    return bias;
  }

  biasFoodTableForStage(position) {
    const local = this.nearestAlivePlayer(position);
    if (!local) {
      return FOOD_SPAWNS;
    }
    // Food a player has not grown into yet is the whole of the early game's
    // difficulty, so the bias has real teeth for a fresh creature and quietly
    // flattens to nothing once every morsel is edible (a uniform boost across
    // the table normalises straight back out).
    let biased = null;
    for (let index = 0; index < FOOD_SPAWNS.length; index += 1) {
      const entry = FOOD_SPAWNS[index];
      if (!canConsume(local.player, foodProbe(entry.id))) {
        continue;
      }
      biased ??= FOOD_SPAWNS.slice();
      biased[index] = { id: entry.id, weight: entry.weight * PREY_WEIGHT_BIAS };
    }
    return biased ?? FOOD_SPAWNS;
  }

  spawnAddon(addonId = weightedPick(this.rng, ADDON_SPAWNS), position = this.randomSpawnPoint(250, 0.3)) {
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
    let point = this.randomSpawnPoint(420, 0.6);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const tooClose = [...this.players.values()].some((player) => {
        const clearance = Math.max(640, viewRadiusForRadius(player.radius) * 0.5);
        return player.alive && distanceSquared(player, point) < clearance * clearance;
      });
      if (!tooClose) {
        break;
      }
      point = this.randomSpawnPoint(420, 0.6);
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

  // Per-connection memory for delta snapshots. Pass it to getSnapshot and the
  // snapshot carries food as changes since the last one sent with this view,
  // and the leaderboard only when it changed. Food is ~80% of a full snapshot
  // and almost all of it sits still, so resending it 24×/s was most of the
  // bandwidth. A fresh view state always starts with a food keyframe.
  createViewState() {
    return { food: new Map(), primed: false, leaderboardKey: null };
  }

  getSnapshot(playerId = null, view = null) {
    const viewer = playerId ? this.players.get(playerId) : null;
    const center = viewer && viewer.alive ? viewer : { x: 0, y: 0, radius: 0 };
    // Giants see (and are streamed) a much wider slice of ocean so the world
    // still surrounds them once the camera has zoomed far out.
    const viewRadius = viewer ? viewRadiusForRadius(viewer.radius) : this.options.activeRadius;
    const visible = (entity) => {
      const range = viewRadius + entity.radius + 200;
      return distanceSquared(center, entity) <= range * range;
    };

    const snapshot = {
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
        .filter((player) => player.alive)
        .map((player) => serializeEntity(player, this.now)),
      npcs: [...this.npcs.values()].filter(visible).map((npc) => serializeEntity(npc, this.now)),
      addons: [...this.addons.values()].filter(visible).map((addon) => serializeEntity(addon, this.now)),
      hazards: [...this.hazards.values()].filter(visible).map((hazard) => serializeEntity(hazard, this.now))
    };

    if (snapshot.self && viewer.alive) {
      // The client's threat rings and hover verdicts ask canConsume the same
      // question the bite does, so they need the same bite bonus (add-ons +
      // trait) — without it a Coral Spurs player sees "standoff" on prey
      // they would actually swallow.
      snapshot.self.biteRatioBonus = Number(this.getPlayerBonuses(viewer).biteRatioBonus.toFixed(3));
    }

    const visibleFood = [...this.food.values()].filter(visible);
    if (!view) {
      snapshot.food = visibleFood.map((food) => serializeEntity(food, this.now));
      snapshot.leaderboard = this.getLeaderboard();
      return snapshot;
    }

    Object.assign(snapshot, foodDelta(visibleFood, view, this.now));
    const leaderboard = this.getLeaderboard();
    const leaderboardKey = JSON.stringify(leaderboard);
    if (leaderboardKey !== view.leaderboardKey) {
      view.leaderboardKey = leaderboardKey;
      snapshot.leaderboard = leaderboard;
    }
    return snapshot;
  }

  // Events concerning a single player's own meals and pickups go only to that
  // player; everything else (joins, kills, milestones) is broadcast.
  eventsFor(events, playerId) {
    return events.filter((event) => !PRIVATE_EVENT_TYPES.has(event.type) || event.playerId === playerId);
  }

  getLeaderboard(limit = 10) {
    const onlineIds = new Set([...this.players.values()].map((player) => player.leaderboardId ?? player.id));
    return [...this.leaderboard.values()]
      .sort((a, b) => b.score - a.score || b.mass - a.mass)
      .slice(0, limit)
      .map((entry) => ({
        // Never the raw key: it is the owner's sessionId, and anyone holding a
        // sessionId can join as that session and kick its owner off.
        id: publicLeaderboardId(entry.id),
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

  // minViewFraction sets how deep into the focus player's streamed view a
  // spawn may land: food can drift in on-screen (the default), creatures and
  // hazards materialise out toward or beyond the view edge. The old fixed
  // 260-unit minimum felt fine for a hatchling but put late-game spawns
  // mid-screen — spawn geometry has to scale with the view, which grows ~10×
  // over a run.
  randomSpawnPoint(margin = 0, minViewFraction = 0.1) {
    if (!this.endless) {
      return this.randomPoint(margin);
    }

    const focus = this.pickFocusPoint();
    const view = viewRadiusForRadius(focus.radius ?? 0);
    const spawnRadius = Math.max(this.options.spawnRadius, view * 1.25);
    const angle = this.rng.float(0, Math.PI * 2);
    const minDistance = Math.max(260, view * minViewFraction);
    const maxDistance = Math.max(minDistance + 20, spawnRadius - margin);
    const distance = minDistance + Math.sqrt(this.rng.next()) * (maxDistance - minDistance);
    // Keep spawns inside the vertical ocean (surface → floor) by REFLECTING
    // overshoot back into the band. Clamping instead piles every out-of-band
    // roll onto the boundary itself, drawing a dense artificial line of food
    // and creatures along the surface/floor whenever a player hovers there.
    const ceiling = OCEAN_SURFACE_Y + 200;
    const floor = OCEAN_FLOOR_Y - 200;
    let y = focus.y + Math.sin(angle) * distance;
    if (y < ceiling) {
      y = ceiling + (ceiling - y);
    } else if (y > floor) {
      y = floor - (y - floor);
    }
    return {
      x: focus.x + Math.cos(angle) * distance,
      y: clamp(y, ceiling, floor)
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

    this.maintainApexPredators();
  }

  // Guarantee "you are not the biggest fish": every grown player keeps roughly
  // one visibly-larger predator in their neighbourhood. When none is nearby, a
  // new one trickles in at the edge of view (~1–2 s expected wait), sized by
  // radius so it is a genuine threat, not just a big number.
  maintainApexPredators() {
    if (this.npcs.size >= this.options.maxNpcs) {
      return;
    }
    for (const player of this.players.values()) {
      if (!player.alive || player.mass < APEX_PRESSURE_MASS) {
        continue;
      }
      // The neighbourhood scales with the player's view: a screen-filling
      // giant's "nearby" is much wider than a fresh leviathan's. Must reach
      // past the hunter spawn band (view × ~1.2) or the quota never sees its
      // own hunter and keeps spawning more.
      const range = Math.max(APEX_PRESSURE_RANGE, viewRadiusForRadius(player.radius) * 1.4);
      const rangeSq = range * range;
      let hasPredator = false;
      for (const npc of this.npcs.values()) {
        // Only a creature that could genuinely eat the player counts — a
        // merely-bigger filter feeder is scenery, not pressure.
        if (distanceSquared(npc, player) <= rangeSq && canConsume(npc, player)) {
          hasPredator = true;
          break;
        }
      }
      if (hasPredator || !this.rng.chance(APEX_PRESSURE_CHANCE)) {
        continue;
      }
      this.spawnApexHunter(player);
    }
  }

  spawnApexHunter(player) {
    const candidates = APEX_HUNTER_IDS.filter((id) => {
      const creature = getCreatureDefinition(id);
      return (
        massForCreatureRadius(id, player.radius * 1.12) <= creature.baseMass * OVERSIZE_MAX_RATIO
      );
    });
    if (candidates.length === 0) {
      return null;
    }
    const creatureId = weightedPick(
      this.rng,
      candidates.map((id) => ({
        id,
        weight: id === "ancient_leviathan" ? APEX_LEVIATHAN_WEIGHT : APEX_HUNTER_DEFAULT_WEIGHT
      }))
    );
    const creature = getCreatureDefinition(creatureId);
    const angle = this.rng.float(0, Math.PI * 2);
    // Just past the view edge (never visible pop-in) but always INSIDE the
    // pressure range, or the quota never sees its own hunter and keeps
    // spawning more.
    const distance = viewRadiusForRadius(player.radius) * this.rng.float(1.02, 1.2);
    const position = {
      x: player.x + Math.cos(angle) * distance,
      y: clamp(
        player.y + Math.sin(angle) * distance,
        OCEAN_SURFACE_Y + 200,
        OCEAN_FLOOR_Y - 200
      )
    };
    const npc = this.spawnNpc(creatureId, position);
    npc.mass = Math.min(
      massForCreatureRadius(creatureId, player.radius * this.rng.float(1.08, 1.45)),
      creature.baseMass * OVERSIZE_MAX_RATIO
    );
    npc.radius = radiusForCreature(creatureId, npc.mass);
    // Spawning off-screen means spawning outside the NPC perception radius, so
    // a hunter stalks its mark by scent until close enough to see it — without
    // this it would wander at the view edge and never arrive.
    npc.huntTargetId = player.id;
    this.events.push({
      type: "apex_hunter",
      playerId: player.id,
      creatureId,
      mass: Math.round(npc.mass)
    });
    return npc;
  }

  cullDistantEntities() {
    const focusPoints = [...this.players.values()].filter((player) => player.alive);
    if (focusPoints.length === 0) {
      focusPoints.push({ x: 0, y: 0 });
    }

    // The cull boundary must sit comfortably outside the spawn band (view ×
    // 1.25) for the largest local player, or view-scaled spawns would be
    // deleted the tick after they appear.
    const zones = focusPoints.map((focus) => {
      const cullRadius = Math.max(this.options.cullRadius, viewRadiusForRadius(focus.radius) * 1.6);
      return { x: focus.x, y: focus.y, r2: cullRadius * cullRadius };
    });
    const isNearFocus = (entity) => zones.some((zone) => distanceSquared(entity, zone) <= zone.r2);

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
      // An apex hunter tracks its marked player from any distance — it spawned
      // beyond perception on purpose. The mark expires if the player shrinks
      // back below apex scale (died and respawned), so no monster ever crosses
      // the sea to chase a hatchling.
      const marked = npc.huntTargetId === player.id && player.mass >= APEX_PRESSURE_MASS;
      if (d2 > perceptionSq && !marked) {
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

    // Every NPC against every morsel was ~150k touch tests a tick and most of
    // the server's CPU; bucketing food into a grid first makes it a handful.
    const foodGrid = new FoodGrid(this.food);
    for (const npc of this.npcs.values()) {
      const food = foodGrid.firstTouching(npc, (candidate) => this.food.has(candidate.id) && canConsume(npc, candidate));
      if (food) {
        this.consumeFood(npc, food);
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
      // Food carries absolute (real) masses, so its value must fade as the
      // player grows or plankton would out-feed hunting well past Giant:
      // full value up to ~90 mass, then square-root falloff. Prey that
      // matches your phase — not grazing — is what moves the late curve.
      this.addMass(consumer, food.mass * digestion * foodValueScale(consumer.mass));
      consumer.eatenCount += 1;
      this.events.push({ type: "ate_food", playerId: consumer.id, foodId: food.foodId });
    } else {
      consumer.mass += food.mass * digestion;
    }
  }

  consumeNpc(player, npc) {
    this.npcs.delete(npc.id);
    const bonuses = this.getPlayerBonuses(player);
    // 0.45 × digestion (~1.65) ≈ 0.74 of the victim's mass before growth
    // efficiency — a meal is never worth more than the whole animal (the old
    // 0.72 × 1.65 = 1.19× let one big victim more than double a player).
    this.addMass(player, npc.mass * 0.45 * bonuses.digestionMultiplier);
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

    if (this.spendShieldCharge(victim)) {
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
    let growthAmount = amount;
    if (entity.kind === "player") {
      const growthMultiplier = this.getPlayerBonuses(entity).growthMultiplier ?? 1;
      growthAmount = amount * playerGrowthEfficiency(entity.mass) * growthMultiplier;
      // Single-bite cap: one meal can never grant more than ~a quarter of the
      // current body (+12 so hatchlings still pop). Growth stages are ~2.5×
      // apart, so no lucky Monster meal skips a stage — big prey stays a
      // great meal, not a teleport through the progression.
      growthAmount = Math.min(growthAmount, entity.mass * 0.25 + 12);
    }
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
    player.shieldCharges = shieldChargesFor(player.addons);

    this.events.push({ type: "collected_addon", playerId: player.id, addonId: addon.addonId });
  }

  // Shield charges live on their add-on: each active Pearl Shield is a charge,
  // so a shield that times out takes its charge with it (the HUD's "70 s"
  // means what it says) and a spent charge stops orbiting.
  expireAddons(player) {
    player.addons = player.addons.filter((addon) => addon.expiresAt > this.now);
    player.shieldCharges = shieldChargesFor(player.addons);
  }

  spendShieldCharge(player) {
    this.expireAddons(player);
    let spent = -1;
    for (let index = 0; index < player.addons.length; index += 1) {
      const addon = player.addons[index];
      if (!getAddonDefinition(addon.addonId).effects.shieldCharges) {
        continue;
      }
      // Spend the one closest to expiring, keeping the fresher shield.
      if (spent === -1 || addon.expiresAt < player.addons[spent].expiresAt) {
        spent = index;
      }
    }
    if (spent === -1) {
      return false;
    }
    player.addons.splice(spent, 1);
    player.shieldCharges = shieldChargesFor(player.addons);
    return true;
  }

  getPlayerBonuses(player) {
    this.expireAddons(player);
    const bonuses = {
      speedMultiplier: 1,
      magnetRadius: 96,
      digestionMultiplier: 1.65,
      biteRatioBonus: 0.04,
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
      updatedAt: Math.round(this.now)
    });
    if (!existing && this.leaderboard.size > LEADERBOARD_PRUNE_AT) {
      this.pruneLeaderboard();
    }
  }

  pruneLeaderboard() {
    const online = new Set([...this.players.values()].map((player) => player.leaderboardId ?? player.id));
    const ranked = [...this.leaderboard.values()].sort((a, b) => b.score - a.score || b.mass - a.mass);
    let kept = 0;
    for (const entry of ranked) {
      if (online.has(entry.id)) {
        continue;
      }
      kept += 1;
      if (kept > LEADERBOARD_KEEP) {
        this.leaderboard.delete(entry.id);
      }
    }
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

// Stable, opaque stand-in for a leaderboard key. Two FNV-1a passes with
// different offsets give 64 bits — plenty to keep rows distinct, and the
// server only ever matches on the real sessionId, so a hash is useless for
// impersonation.
export function publicLeaderboardId(key) {
  const text = String(key);
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x811c9dc5) >>> 0;
  }
  return `lb_${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function shieldChargesFor(addons) {
  let charges = 0;
  for (const addon of addons) {
    charges += getAddonDefinition(addon.addonId).effects.shieldCharges ?? 0;
  }
  return charges;
}

const PRIVATE_EVENT_TYPES = new Set(["ate_food", "ate_creature", "collected_addon", "shield_block", "apex_hunter"]);

// Food only moves when a magnet drags it; below this drift the client's copy
// is close enough and no update is sent.
const FOOD_MOVE_EPSILON = 0.5;

function foodDelta(visibleFood, view, now) {
  if (!view.primed) {
    view.primed = true;
    view.food.clear();
    for (const food of visibleFood) {
      view.food.set(food.id, { x: food.x, y: food.y });
    }
    return { foodKeyframe: true, food: visibleFood.map((food) => serializeEntity(food, now)) };
  }

  const foodAdded = [];
  const foodMoved = [];
  const seen = new Set();
  for (const food of visibleFood) {
    seen.add(food.id);
    const sent = view.food.get(food.id);
    if (!sent) {
      view.food.set(food.id, { x: food.x, y: food.y });
      foodAdded.push(serializeEntity(food, now));
    } else if (Math.abs(sent.x - food.x) > FOOD_MOVE_EPSILON || Math.abs(sent.y - food.y) > FOOD_MOVE_EPSILON) {
      sent.x = food.x;
      sent.y = food.y;
      foodMoved.push([food.id, roundForNetwork(food.x), roundForNetwork(food.y)]);
    }
  }
  const foodRemoved = [];
  for (const id of view.food.keys()) {
    if (!seen.has(id)) {
      view.food.delete(id);
      foodRemoved.push(id);
    }
  }

  const delta = {};
  if (foodAdded.length > 0) {
    delta.foodAdded = foodAdded;
  }
  if (foodMoved.length > 0) {
    delta.foodMoved = foodMoved;
  }
  if (foodRemoved.length > 0) {
    delta.foodRemoved = foodRemoved;
  }
  return delta;
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

// The pacing curve. Tuned against the nominal-diet model in
// tests/progression.test.js so that every stage from Giant onward takes
// roughly 2–5 minutes: full efficiency through the (deliberately fast)
// hatchling ramp, then harmonic decay per mass doubling, with a floor so the
// last stages don't turn into a grind.
const GROWTH_EFFICIENCY_FULL_UNTIL = 150;
const GROWTH_EFFICIENCY_DECAY = 0.9;
const GROWTH_EFFICIENCY_FLOOR = 0.25;

function playerGrowthEfficiency(mass) {
  if (mass <= GROWTH_EFFICIENCY_FULL_UNTIL) {
    return 1;
  }
  return Math.max(
    GROWTH_EFFICIENCY_FLOOR,
    1 / (1 + GROWTH_EFFICIENCY_DECAY * Math.log2(mass / GROWTH_EFFICIENCY_FULL_UNTIL))
  );
}

// Food is full-value for small creatures and fades on a square root past ~90
// mass — grazing feeds a juvenile, not a titan.
const FOOD_VALUE_FULL_MASS = 90;

function foodValueScale(mass) {
  return clamp(Math.sqrt(FOOD_VALUE_FULL_MASS / Math.max(1, mass)), 0.04, 1);
}

function roundForNetwork(value) {
  return Number(value.toFixed(2));
}

// The mass rollNpcMass actually tends to produce for a species: it picks a life
// stage uniformly and lands the mass inside that band, so the expected spawn is
// the mean of the per-stage band midpoints. The stage bias has to ask about
// THIS mass — judging by the adult would call a herring inedible to a player
// who spends their first minute eating herring fry, and judging by the fry
// would call every species edible forever. The local depth/danger upsizing is
// deliberately left out: this asks where a species sits in the food chain, not
// how big this particular roll came out.
const typicalSpawnMassCache = new Map();

function typicalSpawnMass(creatureId) {
  const cached = typicalSpawnMassCache.get(creatureId);
  if (cached !== undefined) {
    return cached;
  }
  const creature = getCreatureDefinition(creatureId);
  const stages = creature.stages;
  let mass;
  if (!creature.speciesBuilt || stages.length <= 1) {
    mass = creature.baseMass * 1.07; // mean of rollNpcMass's 0.86–1.28 jitter
  } else {
    let sum = 0;
    for (let index = 0; index < stages.length; index += 1) {
      const floor = stages[index].minMass;
      const ceil = stages[index + 1]?.minMass ?? creature.baseMass * 1.3;
      sum += (floor + Math.max(floor * 1.02, ceil * 0.98)) / 2;
    }
    mass = sum / stages.length;
  }
  typicalSpawnMassCache.set(creatureId, mass);
  return mass;
}

// Stand-in entities for canConsume, so the spawn tables ask the exact question
// the eating rules answer. Anything else and "prey" at spawn time drifts from
// "prey" at the bite.
function creatureProbe(creatureId) {
  const mass = typicalSpawnMass(creatureId);
  return {
    id: "spawn-probe",
    kind: "npc",
    creatureId,
    mass,
    radius: radiusForCreature(creatureId, mass)
  };
}

function foodProbe(foodId) {
  const definition = getFoodDefinition(foodId);
  return {
    id: "spawn-probe",
    kind: "food",
    foodId,
    mass: definition.mass * 1.1 // mean of spawnFood's 0.85–1.35 jitter
  };
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

// A throwaway uniform grid over this tick's food. firstTouching returns the
// same morsel the old linear scan would have — the earliest-spawned one that
// touches and passes the filter — so NPC feeding stays deterministic.
const FOOD_GRID_CELL = 256;
// Past this many cells (a Monster-sized NPC) the grid stops paying for itself.
const FOOD_GRID_MAX_CELLS = 256;

export class FoodGrid {
  constructor(foodMap) {
    this.foodMap = foodMap;
    this.cells = new Map();
    this.order = new Map();
    this.maxRadius = 0;
    let index = 0;
    for (const food of foodMap.values()) {
      this.order.set(food, index);
      index += 1;
      this.maxRadius = Math.max(this.maxRadius, food.radius);
      const key = foodGridKey(Math.floor(food.x / FOOD_GRID_CELL), Math.floor(food.y / FOOD_GRID_CELL));
      const cell = this.cells.get(key);
      if (cell) {
        cell.push(food);
      } else {
        this.cells.set(key, [food]);
      }
    }
  }

  firstTouching(entity, accept) {
    const reach = entity.radius + this.maxRadius;
    const minX = Math.floor((entity.x - reach) / FOOD_GRID_CELL);
    const maxX = Math.floor((entity.x + reach) / FOOD_GRID_CELL);
    const minY = Math.floor((entity.y - reach) / FOOD_GRID_CELL);
    const maxY = Math.floor((entity.y + reach) / FOOD_GRID_CELL);
    if ((maxX - minX + 1) * (maxY - minY + 1) > FOOD_GRID_MAX_CELLS) {
      for (const food of this.foodMap.values()) {
        if (isTouching(entity, food) && accept(food)) {
          return food;
        }
      }
      return null;
    }

    let best = null;
    let bestOrder = Infinity;
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const cell = this.cells.get(foodGridKey(cx, cy));
        if (!cell) {
          continue;
        }
        for (const food of cell) {
          const order = this.order.get(food);
          if (order < bestOrder && isTouching(entity, food) && accept(food)) {
            best = food;
            bestOrder = order;
          }
        }
      }
    }
    return best;
  }
}

// Packs a cell coordinate pair into one number (no string keys in the hot
// loop). Good for ±2^25 cells either way — far past any swimmable distance.
function foodGridKey(cx, cy) {
  return (cx + 33_554_432) * 67_108_864 + (cy + 33_554_432);
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
