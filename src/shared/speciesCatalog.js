// Real marine species as compact rows, expanded by a builder into the exact
// CREATURE_CATALOG shape the simulation and renderer already consume. The sim
// never sees this terse form. Depth of learning comes from DATA VOLUME feeding
// the existing parametric shape drawers — no per-species art.
//
// A row:  s(id, common, binomial, shape, palette, stages, regions, zones, weight)
//   shape   — one of the renderer's primitives: fish|serpent|kraken|ray|shark|
//             whale|maw|angler
//   palette — a named color preset (below), so we never repeat hex per species
//   stages  — [ [phaseName, realLengthCm, gameMass], ... ] ascending; last = adult.
//             realLengthCm is the true size shown in labels; gameMass balances
//             the creature into the existing food chain.
//   regions — real regions it lives in ([] = found everywhere)
//   zones   — real depth zones it lives in ([] = any depth)
//   weight  — spawn frequency within its biome (default 10)

// Named palettes: {body, belly, accent, eye, pattern}. ~16 cover the whole set.
const PALETTES = Object.freeze({
  silver: { body: "#94a3b8", belly: "#f8fafc", accent: "#60a5fa", eye: "#111827", pattern: "stripe" },
  blueback: { body: "#1d4ed8", belly: "#eff6ff", accent: "#38bdf8", eye: "#111827", pattern: "finFlash" },
  mottled: { body: "#a16207", belly: "#fef9c3", accent: "#115e59", eye: "#111827", pattern: "mottled" },
  reefbright: { body: "#f97316", belly: "#fff7ed", accent: "#facc15", eye: "#0f172a", pattern: "stripe" },
  translucent: { body: "#a5f3fc", belly: "#ecfeff", accent: "#67e8f9", eye: "#0f172a", pattern: "spots" },
  biolum: { body: "#0f172a", belly: "#155e75", accent: "#22d3ee", eye: "#f8fafc", pattern: "lateralGlow" },
  darkpelagic: { body: "#1e293b", belly: "#334155", accent: "#64748b", eye: "#cbd5e1", pattern: "stripe" },
  red: { body: "#7f1d1d", belly: "#b91c1c", accent: "#f87171", eye: "#fde68a", pattern: "spots" },
  gulperblack: { body: "#0b0f1a", belly: "#1e293b", accent: "#ef4444", eye: "#facc15", pattern: "teeth" },
  octopuspurple: { body: "#5b21b6", belly: "#ddd6fe", accent: "#a855f7", eye: "#fef08a", pattern: "spots" },
  sharkgrey: { body: "#475569", belly: "#f8fafc", accent: "#0ea5e9", eye: "#111827", pattern: "countershade" },
  sharkblue: { body: "#1e40af", belly: "#f1f5f9", accent: "#38bdf8", eye: "#111827", pattern: "countershade" },
  rayshadow: { body: "#334155", belly: "#e2e8f0", accent: "#38bdf8", eye: "#f8fafc", pattern: "edgeGlow" },
  whaleblue: { body: "#2563eb", belly: "#dbeafe", accent: "#7dd3fc", eye: "#0f172a", pattern: "softSpots" },
  orcablack: { body: "#0f172a", belly: "#f8fafc", accent: "#38bdf8", eye: "#f8fafc", pattern: "countershade" },
  snailpink: { body: "#9d174d", belly: "#fbcfe8", accent: "#f9a8d4", eye: "#f8fafc", pattern: "softSpots" }
});

// Locomotion presets keyed by shape (reused from the hand-authored creatures).
const MOVEMENT = Object.freeze({
  fish: { acceleration: 840, maxSpeed: 300, drag: 0.8, turnLerp: 0.25 },
  serpent: { acceleration: 700, maxSpeed: 250, drag: 0.85, turnLerp: 0.24 },
  kraken: { acceleration: 720, maxSpeed: 280, drag: 0.84, turnLerp: 0.28 },
  ray: { acceleration: 540, maxSpeed: 225, drag: 0.72, turnLerp: 0.16 },
  shark: { acceleration: 780, maxSpeed: 335, drag: 0.78, turnLerp: 0.16 },
  whale: { acceleration: 360, maxSpeed: 165, drag: 0.68, turnLerp: 0.1 },
  maw: { acceleration: 500, maxSpeed: 200, drag: 0.78, turnLerp: 0.18 },
  angler: { acceleration: 560, maxSpeed: 210, drag: 0.82, turnLerp: 0.22 }
});

// A type tag (matches the diet ladder) implied by body shape.
const SHAPE_TYPE_TAG = Object.freeze({
  kraken: "cephalopod",
  ray: "ray",
  shark: "shark",
  whale: "mammal"
});

function s(id, common, binomial, shape, palette, stages, regions = [], zones = [], weight = 10) {
  return { id, common, binomial, shape, palette, stages, regions, zones, weight };
}

export const SPECIES = Object.freeze([
  // ── Sunlight Zone (epipelagic) ──────────────────────────────────────────
  s("atlantic_herring", "Atlantic Herring", "Clupea harengus", "fish", "silver",
    [["fry", 4, 6], ["juvenile", 12, 20], ["adult", 30, 70]], ["north_atlantic", "norwegian_sea"], ["epipelagic"], 26),
  s("european_pilchard", "European Pilchard", "Sardina pilchardus", "fish", "silver",
    [["fry", 3, 5], ["juvenile", 10, 18], ["adult", 25, 55]], ["benguela", "north_atlantic"], ["epipelagic"], 24),
  s("atlantic_mackerel", "Atlantic Mackerel", "Scomber scombrus", "fish", "blueback",
    [["fry", 5, 8], ["juvenile", 15, 40], ["adult", 40, 150]], ["north_atlantic"], ["epipelagic"], 18),
  s("atlantic_cod", "Atlantic Cod", "Gadus morhua", "fish", "mottled",
    [["fry", 5, 12], ["juvenile", 25, 120], ["adult", 100, 900]], ["north_atlantic", "norwegian_sea"], ["epipelagic", "mesopelagic"], 12),
  s("skipjack_tuna", "Skipjack Tuna", "Katsuwonus pelamis", "fish", "blueback",
    [["juvenile", 25, 120], ["adult", 80, 700]], ["coral_triangle"], ["epipelagic"], 12),
  s("clown_anemonefish", "Clown Anemonefish", "Amphiprion ocellaris", "fish", "reefbright",
    [["fry", 1, 2], ["juvenile", 4, 8], ["adult", 9, 20]], ["coral_triangle"], ["epipelagic"], 22),
  s("giant_trevally", "Giant Trevally", "Caranx ignobilis", "fish", "silver",
    [["juvenile", 15, 60], ["adult", 120, 1400]], ["coral_triangle"], ["epipelagic"], 8),
  s("mahi_mahi", "Mahi-mahi", "Coryphaena hippurus", "fish", "reefbright",
    [["juvenile", 20, 80], ["adult", 100, 1500]], ["coral_triangle", "sargasso_sea"], ["epipelagic"], 9),
  s("flying_fish", "Atlantic Flyingfish", "Cheilopogon melanurus", "fish", "blueback",
    [["juvenile", 8, 15], ["adult", 25, 60]], ["sargasso_sea"], ["epipelagic"], 16),
  s("great_barracuda", "Great Barracuda", "Sphyraena barracuda", "fish", "silver",
    [["juvenile", 25, 90], ["adult", 140, 1600]], ["coral_triangle"], ["epipelagic"], 7),
  s("spotted_eagle_ray", "Spotted Eagle Ray", "Aetobatus narinari", "ray", "rayshadow",
    [["juvenile", 60, 300], ["adult", 200, 1400]], ["coral_triangle"], ["epipelagic"], 6),
  s("blue_shark", "Blue Shark", "Prionace glauca", "shark", "sharkblue",
    [["juvenile", 60, 300], ["adult", 250, 1800]], ["north_atlantic", "sargasso_sea"], ["epipelagic", "mesopelagic"], 6),
  s("great_white_shark", "Great White Shark", "Carcharodon carcharias", "shark", "sharkgrey",
    [["juvenile", 150, 1200], ["adult", 450, 11000]], ["benguela", "kelp_forest"], ["epipelagic"], 3),
  s("bluefin_tuna", "Atlantic Bluefin Tuna", "Thunnus thynnus", "fish", "blueback",
    [["juvenile", 40, 250], ["adult", 250, 6000]], ["north_atlantic"], ["epipelagic"], 5),
  s("atlantic_sailfish", "Atlantic Sailfish", "Istiophorus albicans", "fish", "blueback",
    [["juvenile", 40, 200], ["adult", 300, 5000]], ["coral_triangle"], ["epipelagic"], 5),
  s("ocean_sunfish", "Ocean Sunfish", "Mola mola", "whale", "silver",
    [["juvenile", 40, 400], ["adult", 250, 9000]], ["sargasso_sea"], ["epipelagic"], 3),
  s("orca", "Orca", "Orcinus orca", "whale", "orcablack",
    [["calf", 240, 2500], ["adult", 700, 18000]], ["antarctic_convergence", "north_atlantic"], ["epipelagic"], 2),

  // ── Twilight Zone (mesopelagic) ─────────────────────────────────────────
  s("european_squid", "European Squid", "Loligo vulgaris", "kraken", "translucent",
    [["paralarva", 2, 4], ["juvenile", 10, 40], ["adult", 40, 220]], ["north_atlantic"], ["mesopelagic"], 14),
  s("spotted_lanternfish", "Spotted Lanternfish", "Myctophum punctatum", "fish", "biolum",
    [["juvenile", 2, 3], ["adult", 8, 12]], [], ["mesopelagic"], 26),
  s("silver_hatchetfish", "Silver Hatchetfish", "Argyropelecus aculeatus", "fish", "silver",
    [["juvenile", 2, 3], ["adult", 7, 10]], [], ["mesopelagic"], 22),
  s("sloanes_viperfish", "Sloane's Viperfish", "Chauliodus sloani", "angler", "biolum",
    [["juvenile", 8, 25], ["adult", 30, 140]], [], ["mesopelagic", "bathypelagic"], 10),
  s("bristlemouth", "Bristlemouth", "Cyclothone microdon", "fish", "darkpelagic",
    [["juvenile", 2, 2], ["adult", 6, 7]], [], ["mesopelagic", "bathypelagic"], 24),
  s("cookiecutter_shark", "Cookiecutter Shark", "Isistius brasiliensis", "shark", "darkpelagic",
    [["juvenile", 20, 60], ["adult", 50, 300]], [], ["mesopelagic"], 7),
  s("lancetfish", "Longnose Lancetfish", "Alepisaurus ferox", "serpent", "silver",
    [["juvenile", 40, 120], ["adult", 200, 1500]], [], ["mesopelagic"], 6),
  s("vampire_squid", "Vampire Squid", "Vampyroteuthis infernalis", "kraken", "octopuspurple",
    [["juvenile", 6, 20], ["adult", 30, 150]], [], ["mesopelagic", "bathypelagic"], 9),

  // ── Midnight Zone (bathypelagic) ────────────────────────────────────────
  s("humpback_anglerfish", "Humpback Anglerfish", "Melanocetus johnsonii", "angler", "gulperblack",
    [["juvenile", 3, 8], ["adult", 18, 90]], [], ["bathypelagic"], 14),
  s("gulper_eel", "Pelican Gulper Eel", "Eurypharynx pelecanoides", "maw", "gulperblack",
    [["juvenile", 20, 60], ["adult", 75, 400]], [], ["bathypelagic"], 10),
  s("fangtooth", "Common Fangtooth", "Anoplogaster cornuta", "fish", "gulperblack",
    [["juvenile", 5, 15], ["adult", 16, 70]], [], ["bathypelagic"], 16),
  s("black_swallower", "Black Swallower", "Chiasmodon niger", "maw", "gulperblack",
    [["juvenile", 8, 25], ["adult", 25, 120]], [], ["bathypelagic"], 9),
  s("dragonfish", "Deep-sea Dragonfish", "Grammatostomias flagellibarba", "angler", "biolum",
    [["juvenile", 6, 15], ["adult", 26, 110]], [], ["bathypelagic"], 10),
  s("giant_squid", "Giant Squid", "Architeuthis dux", "kraken", "red",
    [["juvenile", 60, 300], ["adult", 1200, 9000]], [], ["bathypelagic"], 3),
  s("colossal_squid", "Colossal Squid", "Mesonychoteuthis hamiltoni", "kraken", "red",
    [["juvenile", 80, 500], ["adult", 1000, 14000]], ["antarctic_convergence"], ["bathypelagic", "abyssal"], 2),
  s("frilled_shark", "Frilled Shark", "Chlamydoselachus anguineus", "serpent", "sharkgrey",
    [["juvenile", 50, 200], ["adult", 180, 1400]], [], ["bathypelagic"], 5),

  // ── Abyssal Zone ────────────────────────────────────────────────────────
  s("dumbo_octopus", "Dumbo Octopus", "Grimpoteuthis abyssicola", "kraken", "octopuspurple",
    [["juvenile", 8, 30], ["adult", 30, 150]], [], ["abyssal"], 14),
  s("tripod_fish", "Tripod Fish", "Bathypterois grallator", "fish", "snailpink",
    [["juvenile", 10, 40], ["adult", 37, 180]], [], ["abyssal"], 16),
  s("abyssal_grenadier", "Abyssal Grenadier", "Coryphaenoides armatus", "fish", "mottled",
    [["juvenile", 20, 120], ["adult", 90, 700]], [], ["abyssal"], 12),
  s("deepsea_lizardfish", "Deep-sea Lizardfish", "Bathysaurus ferox", "fish", "mottled",
    [["juvenile", 20, 100], ["adult", 65, 500]], [], ["abyssal"], 10),

  // ── Hadal Zone ──────────────────────────────────────────────────────────
  s("hadal_snailfish", "Hadal Snailfish", "Pseudoliparis swirei", "fish", "snailpink",
    [["juvenile", 8, 30], ["adult", 28, 150]], ["mariana_approach"], ["hadal"], 20),
  s("abyssal_cuskeel", "Abyssal Cusk-eel", "Abyssobrotula galatheae", "serpent", "snailpink",
    [["juvenile", 10, 50], ["adult", 20, 120]], ["mariana_approach"], ["hadal"], 16)
]);

const DEFAULT_CONSUME_RATIO = 1.14;

// Real length → in-game radius, calibrated to the hand-authored anchors
// (~30 cm → 15 px, ~25 m whale → ~118 px) so old and new creatures share one
// size scale and the eat rules stay balanced.
export function radiusFromLengthCm(cm) {
  return clampNumber(3.2 * Math.pow(Math.max(1, cm), 0.47), 6, 320);
}

// Same thresholds as creatureCatalog's sizeTagForMass (duplicated to avoid a
// circular import — creatureCatalog imports this module).
function sizeBucketTag(mass) {
  if (mass < 35) return "tinyFish";
  if (mass < 90) return "smallFish";
  if (mass < 220) return "mediumFish";
  if (mass < 620) return "largeFish";
  if (mass < 1500) return "shark";
  return "apex";
}

function dietForBucket(bucket) {
  switch (bucket) {
    case "tinyFish":
      return ["plankton", "larvae"];
    case "smallFish":
      return ["plankton", "larvae", "tinyFish"];
    case "mediumFish":
      return ["tinyFish", "smallFish", "crustacean"];
    case "largeFish":
      return ["smallFish", "mediumFish", "cephalopod"];
    case "shark":
      return ["mediumFish", "largeFish", "ray", "cephalopod", "mammal"];
    default:
      // Apex-bucket species also hunt apex/monster-tagged prey, so an oversized
      // ("Giant"/"Monster") specimen is a genuine predator to a grown player —
      // the size-advantage rule still gates every actual bite.
      return ["largeFish", "ray", "shark", "mammal", "apex", "monster"];
  }
}

function expandSpecies(species) {
  const stages = species.stages;
  const adult = stages[stages.length - 1];
  const adultCm = adult[1];
  const adultMass = adult[2];
  const bucket = sizeBucketTag(adultMass);
  const typeTag = SHAPE_TYPE_TAG[species.shape];
  const tags = typeTag ? [bucket, typeTag] : [bucket];

  const builtStages = stages.map(([name, cm, mass], index) => ({
    minMass: mass,
    name,
    label: name,
    scale: 0.7 + (index / Math.max(1, stages.length - 1)) * 0.3,
    cm
  }));

  return {
    id: species.id,
    name: species.common,
    commonName: species.common,
    binomial: species.binomial,
    speciesBuilt: true,
    playable: false,
    tags,
    baseMass: adultMass,
    baseRadius: radiusFromLengthCm(adultCm),
    consumeRatio: DEFAULT_CONSUME_RATIO,
    movement: { ...MOVEMENT[species.shape] },
    diet: [{ minMass: 0, preyTags: dietForBucket(bucket) }],
    stages: builtStages,
    regions: [...species.regions],
    zones: [...species.zones],
    spawnWeight: species.weight,
    visual: { shape: species.shape, ...PALETTES[species.palette] }
  };
}

export function buildSpeciesCreatures() {
  const catalog = {};
  for (const species of SPECIES) {
    catalog[species.id] = expandSpecies(species);
  }
  return catalog;
}

// Spawn-pool metadata (id + region/zone membership + weight) used by the world
// to pick biome-appropriate species without expanding the whole catalog.
export function speciesSpawnEntries() {
  return SPECIES.map((species) => ({
    id: species.id,
    regions: species.regions,
    zones: species.zones,
    weight: species.weight
  }));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
