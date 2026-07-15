// Real marine species as compact rows, expanded by a builder into the exact
// CREATURE_CATALOG shape the simulation and renderer already consume. The sim
// never sees this terse form. Depth of learning comes from DATA VOLUME feeding
// the existing parametric shape drawers — no per-species art.
//
// A row:  s(id, common, binomial, shape, palette, stages, regions, zones, weight, feeds)
//   shape   — one of the renderer's primitives: fish|serpent|kraken|ray|shark|
//             whale|maw|angler
//   palette — a named color preset (below), so we never repeat hex per species
//   stages  — [ [phaseName, realLengthCm, gameMass], ... ] ascending; last = adult.
//             realLengthCm is the true size shown in labels; gameMass balances
//             the creature into the existing food chain.
//   regions — real regions it lives in ([] = found everywhere)
//   zones   — real depth zones it lives in ([] = any depth)
//   weight  — spawn frequency within its biome (default 10)
//   feeds   — "filter" for the strainers (baleen whales, whale/basking sharks).
//             Diet is otherwise inferred from adult size, which lands every
//             25-metre giant in the apex bucket — turning a humpback into a
//             shark-hunter that stalks the player. The gentle giants are the
//             whole point of a whale to a kid: they must be safe to swim with.

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
  snailpink: { body: "#9d174d", belly: "#fbcfe8", accent: "#f9a8d4", eye: "#f8fafc", pattern: "softSpots" },
  goldreef: { body: "#eab308", belly: "#fef9c3", accent: "#f97316", eye: "#0f172a", pattern: "stripe" },
  tangblue: { body: "#1d4ed8", belly: "#dbeafe", accent: "#facc15", eye: "#0f172a", pattern: "stripe" },
  dolphingrey: { body: "#64748b", belly: "#f1f5f9", accent: "#38bdf8", eye: "#0f172a", pattern: "countershade" },
  sealbrown: { body: "#57534e", belly: "#e7e5e4", accent: "#a8a29e", eye: "#111827", pattern: "countershade" },
  // Whale-specific looks: the cetaceans are the headline sightings, so they get
  // told apart at a glance rather than all reading as one grey mass.
  belugawhite: { body: "#e2e8f0", belly: "#f8fafc", accent: "#bae6fd", eye: "#0f172a", pattern: "softSpots" },
  narwhalspeckle: { body: "#8b93a7", belly: "#e2e8f0", accent: "#c4b5fd", eye: "#0f172a", pattern: "mottled" },
  bowheadslate: { body: "#1e293b", belly: "#f1f5f9", accent: "#475569", eye: "#0f172a", pattern: "countershade" },
  greywhale: { body: "#6b7280", belly: "#d1d5db", accent: "#a8a29e", eye: "#0f172a", pattern: "mottled" },
  rightwhale: { body: "#111827", belly: "#e5e7eb", accent: "#9ca3af", eye: "#0f172a", pattern: "softSpots" },
  beakedtaupe: { body: "#78716c", belly: "#e7e5e4", accent: "#d6d3d1", eye: "#0f172a", pattern: "scars" }
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

function s(id, common, binomial, shape, palette, stages, regions = [], zones = [], weight = 10, feeds = null) {
  return { id, common, binomial, shape, palette, stages, regions, zones, weight, feeds };
}

export const SPECIES = Object.freeze([
  // ── Sunlight Zone (epipelagic) ──────────────────────────────────────────
  s("atlantic_herring", "Atlantic Herring", "Clupea harengus", "fish", "silver",
    [["fry", 4, 6], ["juvenile", 12, 20], ["adult", 30, 70]], ["north_atlantic", "norwegian_sea", "lofoten_shelf"], ["epipelagic"], 26),
  s("european_pilchard", "European Pilchard", "Sardina pilchardus", "fish", "silver",
    [["fry", 3, 5], ["juvenile", 10, 18], ["adult", 25, 55]], ["benguela", "north_atlantic"], ["epipelagic"], 24),
  s("atlantic_mackerel", "Atlantic Mackerel", "Scomber scombrus", "fish", "blueback",
    [["fry", 5, 8], ["juvenile", 15, 40], ["adult", 40, 150]], ["north_atlantic"], ["epipelagic"], 18),
  s("atlantic_cod", "Atlantic Cod", "Gadus morhua", "fish", "mottled",
    [["fry", 5, 12], ["juvenile", 25, 120], ["adult", 100, 900]], ["north_atlantic", "norwegian_sea", "lofoten_shelf"], ["epipelagic", "mesopelagic"], 12),
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

  // Kelp Forest signatures (temperate Pacific) — a calm, distinctive nursery sea.
  s("giant_kelpfish", "Giant Kelpfish", "Heterostichus rostratus", "fish", "reefbright",
    [["juvenile", 8, 14], ["adult", 45, 160]], ["kelp_forest"], ["epipelagic"], 20),
  s("garibaldi", "Garibaldi", "Hypsypops rubicundus", "fish", "reefbright",
    [["juvenile", 6, 10], ["adult", 30, 90]], ["kelp_forest"], ["epipelagic"], 16),
  s("leopard_shark", "Leopard Shark", "Triakis semifasciata", "shark", "sharkgrey",
    [["juvenile", 30, 120], ["adult", 150, 1300]], ["kelp_forest"], ["epipelagic"], 7),
  s("california_sea_lion", "California Sea Lion", "Zalophus californianus", "whale", "sharkgrey",
    [["pup", 80, 900], ["adult", 210, 4200]], ["kelp_forest"], ["epipelagic"], 4),

  // Humboldt Current signatures (upwelling Pacific) — small fish, big predators.
  s("peruvian_anchoveta", "Peruvian Anchoveta", "Engraulis ringens", "fish", "silver",
    [["fry", 3, 4], ["adult", 18, 40]], ["humboldt_current"], ["epipelagic"], 28),
  s("jumbo_squid", "Jumbo Squid", "Dosidicus gigas", "kraken", "red",
    [["juvenile", 20, 90], ["adult", 120, 2200]], ["humboldt_current"], ["epipelagic", "mesopelagic"], 8),
  s("south_american_sea_lion", "South American Sea Lion", "Otaria flavescens", "whale", "mottled",
    [["pup", 85, 950], ["adult", 240, 5200]], ["humboldt_current"], ["epipelagic"], 4),

  // Sargasso Sea signature — the weed-mimicking ambush frogfish.
  s("sargassum_fish", "Sargassum Frogfish", "Histrio histrio", "angler", "mottled",
    [["juvenile", 3, 6], ["adult", 14, 40]], ["sargasso_sea"], ["epipelagic"], 18),

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
    [["juvenile", 60, 300], ["adult", 1200, 9000]], ["north_atlantic", "sargasso_sea", "benguela"], ["bathypelagic"], 3),
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
    [["juvenile", 20, 120], ["adult", 90, 700]], ["mariana_approach", "antarctic_convergence"], ["abyssal"], 12),
  s("deepsea_lizardfish", "Deep-sea Lizardfish", "Bathysaurus ferox", "fish", "mottled",
    [["juvenile", 20, 100], ["adult", 65, 500]], [], ["abyssal"], 10),

  // ── Hadal Zone ──────────────────────────────────────────────────────────
  s("hadal_snailfish", "Hadal Snailfish", "Pseudoliparis swirei", "fish", "snailpink",
    [["juvenile", 8, 30], ["adult", 28, 150]], ["mariana_approach"], ["hadal"], 20),
  s("abyssal_cuskeel", "Abyssal Cusk-eel", "Abyssobrotula galatheae", "serpent", "snailpink",
    [["juvenile", 10, 50], ["adult", 20, 120]], ["mariana_approach"], ["hadal"], 16),

  // ════════════════════════════════════════════════════════════════════════
  //  Expansion set — ~100 more real species, same terse rows, no rule changes.
  // ════════════════════════════════════════════════════════════════════════

  // ── Sunlight Zone: open-ocean pelagic predators ─────────────────────────
  s("albacore_tuna", "Albacore", "Thunnus alalunga", "fish", "blueback",
    [["juvenile", 40, 250], ["adult", 120, 2600]], ["coral_triangle", "humboldt_current"], ["epipelagic"], 8),
  s("wahoo", "Wahoo", "Acanthocybium solandri", "fish", "blueback",
    [["juvenile", 50, 300], ["adult", 180, 3500]], ["coral_triangle", "sargasso_sea"], ["epipelagic"], 6),
  s("king_mackerel", "King Mackerel", "Scomberomorus cavalla", "fish", "blueback",
    [["juvenile", 40, 200], ["adult", 120, 1600]], ["sargasso_sea"], ["epipelagic"], 8),
  s("atlantic_bonito", "Atlantic Bonito", "Sarda sarda", "fish", "blueback",
    [["juvenile", 25, 90], ["adult", 60, 600]], ["north_atlantic"], ["epipelagic"], 12),
  s("swordfish", "Swordfish", "Xiphias gladius", "fish", "blueback",
    [["juvenile", 60, 400], ["adult", 300, 7000]], ["north_atlantic", "sargasso_sea"], ["epipelagic", "mesopelagic"], 4),
  s("blue_marlin", "Atlantic Blue Marlin", "Makaira nigricans", "fish", "blueback",
    [["juvenile", 60, 400], ["adult", 350, 8000]], ["sargasso_sea"], ["epipelagic"], 3),
  s("bluefish", "Bluefish", "Pomatomus saltatrix", "fish", "silver",
    [["juvenile", 20, 60], ["adult", 80, 700]], ["north_atlantic", "sargasso_sea"], ["epipelagic"], 10),
  s("striped_bass", "Striped Bass", "Morone saxatilis", "fish", "silver",
    [["juvenile", 20, 70], ["adult", 100, 1100]], ["north_atlantic"], ["epipelagic"], 9),
  s("european_seabass", "European Seabass", "Dicentrarchus labrax", "fish", "silver",
    [["juvenile", 15, 50], ["adult", 80, 800]], ["north_atlantic"], ["epipelagic"], 10),
  s("gilthead_seabream", "Gilthead Seabream", "Sparus aurata", "fish", "silver",
    [["juvenile", 10, 30], ["adult", 50, 320]], ["north_atlantic"], ["epipelagic"], 11),
  s("yellowtail_amberjack", "Yellowtail Amberjack", "Seriola lalandi", "fish", "silver",
    [["juvenile", 30, 150], ["adult", 150, 2600]], ["kelp_forest"], ["epipelagic"], 7),
  s("cobia", "Cobia", "Rachycentron canadum", "fish", "darkpelagic",
    [["juvenile", 30, 120], ["adult", 120, 2000]], ["coral_triangle"], ["epipelagic"], 6),
  s("common_remora", "Common Remora", "Remora remora", "fish", "darkpelagic",
    [["juvenile", 15, 30], ["adult", 45, 220]], [], ["epipelagic"], 8),

  // ── Sunlight/Twilight: North Atlantic & Arctic groundfish ───────────────
  s("haddock", "Haddock", "Melanogrammus aeglefinus", "fish", "mottled",
    [["juvenile", 15, 60], ["adult", 70, 800]], ["north_atlantic", "norwegian_sea"], ["epipelagic", "mesopelagic"], 12),
  s("pollock", "Pollock", "Pollachius pollachius", "fish", "mottled",
    [["juvenile", 20, 80], ["adult", 90, 900]], ["north_atlantic", "norwegian_sea"], ["epipelagic", "mesopelagic"], 10),
  s("atlantic_halibut", "Atlantic Halibut", "Hippoglossus hippoglossus", "fish", "mottled",
    [["juvenile", 40, 400], ["adult", 200, 9000]], ["norwegian_sea", "lofoten_shelf"], ["epipelagic", "mesopelagic"], 5),
  s("european_plaice", "European Plaice", "Pleuronectes platessa", "ray", "mottled",
    [["juvenile", 15, 60], ["adult", 50, 400]], ["north_atlantic"], ["epipelagic"], 10),
  s("turbot", "Turbot", "Scophthalmus maximus", "ray", "mottled",
    [["juvenile", 15, 70], ["adult", 70, 900]], ["north_atlantic"], ["epipelagic"], 8),
  s("common_ling", "Common Ling", "Molva molva", "serpent", "mottled",
    [["juvenile", 30, 150], ["adult", 150, 2000]], ["norwegian_sea", "lofoten_shelf"], ["mesopelagic"], 7),
  s("atlantic_wolffish", "Atlantic Wolffish", "Anarhichas lupus", "serpent", "darkpelagic",
    [["juvenile", 25, 120], ["adult", 120, 1800]], ["norwegian_sea", "lofoten_shelf"], ["epipelagic", "mesopelagic"], 7),

  // ── Sunlight: Coral Triangle reef community ─────────────────────────────
  s("red_lionfish", "Red Lionfish", "Pterois volitans", "fish", "red",
    [["juvenile", 8, 20], ["adult", 35, 180]], ["coral_triangle"], ["epipelagic"], 12),
  s("emperor_angelfish", "Emperor Angelfish", "Pomacanthus imperator", "fish", "goldreef",
    [["juvenile", 6, 15], ["adult", 38, 240]], ["coral_triangle"], ["epipelagic"], 12),
  s("yellow_tang", "Yellow Tang", "Zebrasoma flavescens", "fish", "goldreef",
    [["juvenile", 4, 8], ["adult", 20, 60]], ["coral_triangle"], ["epipelagic"], 16),
  s("regal_blue_tang", "Regal Blue Tang", "Paracanthurus hepatus", "fish", "tangblue",
    [["juvenile", 4, 8], ["adult", 30, 120]], ["coral_triangle"], ["epipelagic"], 14),
  s("moorish_idol", "Moorish Idol", "Zanclus cornutus", "fish", "goldreef",
    [["juvenile", 5, 10], ["adult", 22, 70]], ["coral_triangle"], ["epipelagic"], 13),
  s("copperband_butterflyfish", "Copperband Butterflyfish", "Chelmon rostratus", "fish", "goldreef",
    [["juvenile", 4, 8], ["adult", 20, 55]], ["coral_triangle"], ["epipelagic"], 14),
  s("humphead_wrasse", "Humphead Wrasse", "Cheilinus undulatus", "fish", "tangblue",
    [["juvenile", 20, 120], ["adult", 180, 4500]], ["coral_triangle"], ["epipelagic"], 5),
  s("bumphead_parrotfish", "Bumphead Parrotfish", "Bolbometopon muricatum", "fish", "tangblue",
    [["juvenile", 25, 150], ["adult", 130, 4600]], ["coral_triangle"], ["epipelagic"], 5),
  s("longfin_batfish", "Longfin Batfish", "Platax teira", "fish", "silver",
    [["juvenile", 10, 40], ["adult", 60, 700]], ["coral_triangle"], ["epipelagic"], 9),
  s("mandarinfish", "Mandarinfish", "Synchiropus splendidus", "fish", "tangblue",
    [["juvenile", 2, 3], ["adult", 7, 15]], ["coral_triangle"], ["epipelagic"], 14),
  s("porcupinefish", "Spot-fin Porcupinefish", "Diodon hystrix", "fish", "mottled",
    [["juvenile", 10, 40], ["adult", 50, 600]], ["coral_triangle"], ["epipelagic"], 8),
  s("titan_triggerfish", "Titan Triggerfish", "Balistoides viridescens", "fish", "mottled",
    [["juvenile", 10, 40], ["adult", 60, 900]], ["coral_triangle"], ["epipelagic"], 8),
  s("giant_grouper", "Giant Grouper", "Epinephelus lanceolatus", "maw", "mottled",
    [["juvenile", 30, 400], ["adult", 240, 20000]], ["coral_triangle"], ["epipelagic"], 3),
  s("coral_trout", "Coral Trout", "Plectropomus leopardus", "fish", "red",
    [["juvenile", 15, 80], ["adult", 80, 1200]], ["coral_triangle"], ["epipelagic"], 9),

  // ── Sunlight: reef sharks & rays ────────────────────────────────────────
  s("blacktip_reef_shark", "Blacktip Reef Shark", "Carcharhinus melanopterus", "shark", "sharkgrey",
    [["juvenile", 50, 300], ["adult", 160, 1400]], ["coral_triangle"], ["epipelagic"], 8),
  s("whitetip_reef_shark", "Whitetip Reef Shark", "Triaenodon obesus", "shark", "sharkgrey",
    [["juvenile", 50, 250], ["adult", 160, 1300]], ["coral_triangle"], ["epipelagic"], 8),
  s("grey_reef_shark", "Grey Reef Shark", "Carcharhinus amblyrhynchos", "shark", "sharkgrey",
    [["juvenile", 60, 350], ["adult", 190, 1700]], ["coral_triangle"], ["epipelagic"], 7),
  s("zebra_shark", "Zebra Shark", "Stegostoma tigrinum", "shark", "mottled",
    [["juvenile", 40, 300], ["adult", 230, 3000]], ["coral_triangle"], ["epipelagic"], 6),
  s("tawny_nurse_shark", "Tawny Nurse Shark", "Nebrius ferrugineus", "shark", "mottled",
    [["juvenile", 60, 500], ["adult", 300, 6000]], ["coral_triangle"], ["epipelagic"], 5),
  s("whale_shark", "Whale Shark", "Rhincodon typus", "shark", "sharkgrey",
    [["juvenile", 300, 4000], ["adult", 1200, 34000]], ["coral_triangle"], ["epipelagic"], 2, "filter"),
  s("reef_manta", "Reef Manta Ray", "Mobula alfredi", "ray", "rayshadow",
    [["juvenile", 150, 1500], ["adult", 400, 20000]], ["coral_triangle"], ["epipelagic"], 4, "filter"),
  s("giant_manta", "Giant Oceanic Manta", "Mobula birostris", "ray", "rayshadow",
    [["juvenile", 200, 3000], ["adult", 700, 30000]], ["coral_triangle"], ["epipelagic"], 3, "filter"),
  s("bluespotted_ribbontail_ray", "Bluespotted Ribbontail Ray", "Taeniura lymma", "ray", "rayshadow",
    [["juvenile", 15, 60], ["adult", 35, 300]], ["coral_triangle"], ["epipelagic"], 10),
  s("southern_stingray", "Southern Stingray", "Hypanus americanus", "ray", "rayshadow",
    [["juvenile", 30, 200], ["adult", 150, 4000]], ["sargasso_sea"], ["epipelagic"], 6),

  // ── Sunlight: coastal cephalopods ───────────────────────────────────────
  s("common_octopus", "Common Octopus", "Octopus vulgaris", "kraken", "octopuspurple",
    [["juvenile", 10, 40], ["adult", 90, 900]], ["north_atlantic", "benguela"], ["epipelagic"], 9),
  s("common_cuttlefish", "Common Cuttlefish", "Sepia officinalis", "kraken", "translucent",
    [["juvenile", 6, 20], ["adult", 45, 600]], ["north_atlantic"], ["epipelagic"], 10),
  s("caribbean_reef_squid", "Caribbean Reef Squid", "Sepioteuthis sepioidea", "kraken", "translucent",
    [["juvenile", 4, 10], ["adult", 20, 120]], ["sargasso_sea"], ["epipelagic"], 12),
  s("bigfin_reef_squid", "Bigfin Reef Squid", "Sepioteuthis lessoniana", "kraken", "translucent",
    [["juvenile", 5, 15], ["adult", 33, 300]], ["coral_triangle"], ["epipelagic"], 11),

  // ── Sunlight: marine mammals ────────────────────────────────────────────
  s("bottlenose_dolphin", "Bottlenose Dolphin", "Tursiops truncatus", "whale", "dolphingrey",
    [["calf", 120, 1500], ["adult", 300, 9000]], ["coral_triangle", "north_atlantic"], ["epipelagic"], 5),
  s("common_dolphin", "Common Dolphin", "Delphinus delphis", "whale", "dolphingrey",
    [["calf", 90, 900], ["adult", 220, 6000]], ["north_atlantic"], ["epipelagic"], 6),
  s("harbor_porpoise", "Harbour Porpoise", "Phocoena phocoena", "whale", "dolphingrey",
    [["calf", 70, 600], ["adult", 160, 3500]], ["north_atlantic", "norwegian_sea"], ["epipelagic"], 6),
  s("pilot_whale", "Long-finned Pilot Whale", "Globicephala melas", "whale", "orcablack",
    [["calf", 180, 2000], ["adult", 600, 16000]], ["north_atlantic"], ["epipelagic"], 3),
  s("humpback_whale", "Humpback Whale", "Megaptera novaeangliae", "whale", "whaleblue",
    [["calf", 450, 8000], ["adult", 1400, 45000]], ["north_atlantic", "antarctic_convergence"], ["epipelagic"], 2, "filter"),
  s("fin_whale", "Fin Whale", "Balaenoptera physalus", "whale", "whaleblue",
    [["calf", 650, 12000], ["adult", 2000, 60000]], ["north_atlantic"], ["epipelagic"], 2, "filter"),
  s("minke_whale", "Minke Whale", "Balaenoptera acutorostrata", "whale", "whaleblue",
    [["calf", 270, 3000], ["adult", 850, 22000]], ["north_atlantic", "antarctic_convergence"], ["epipelagic"], 3, "filter"),
  s("sperm_whale", "Sperm Whale", "Physeter macrocephalus", "whale", "sharkgrey",
    [["calf", 400, 6000], ["adult", 1600, 55000]], ["north_atlantic", "sargasso_sea"], ["epipelagic", "mesopelagic", "bathypelagic"], 2),
  s("grey_seal", "Grey Seal", "Halichoerus grypus", "whale", "sealbrown",
    [["pup", 90, 900], ["adult", 220, 5000]], ["north_atlantic", "norwegian_sea"], ["epipelagic"], 5),
  s("harbor_seal", "Harbour Seal", "Phoca vitulina", "whale", "sealbrown",
    [["pup", 80, 700], ["adult", 170, 3500]], ["north_atlantic"], ["epipelagic"], 6),
  s("cape_fur_seal", "Cape Fur Seal", "Arctocephalus pusillus", "whale", "sealbrown",
    [["pup", 70, 700], ["adult", 210, 4500]], ["benguela"], ["epipelagic"], 5),
  s("sea_otter", "Sea Otter", "Enhydra lutris", "whale", "sealbrown",
    [["pup", 60, 300], ["adult", 130, 1400]], ["kelp_forest"], ["epipelagic"], 6),

  // ── The whales of the world ─────────────────────────────────────────────
  // Cetaceans across the whole size range, from a 1.4 m Hector's dolphin to an
  // 18 m bowhead, so "a whale" is never one animal. The baleen giants are
  // marked "filter": they are the ones you can swim alongside.

  // Arctic ice seas.
  s("beluga_whale", "Beluga Whale", "Delphinapterus leucas", "whale", "belugawhite",
    [["calf", 150, 1800], ["adult", 450, 13000]], ["norwegian_sea", "lofoten_shelf"], ["epipelagic"], 3),
  s("narwhal", "Narwhal", "Monodon monoceros", "whale", "narwhalspeckle",
    [["calf", 160, 2000], ["adult", 470, 14000]], ["norwegian_sea", "lofoten_shelf"], ["epipelagic", "mesopelagic"], 2),
  s("bowhead_whale", "Bowhead Whale", "Balaena mysticetus", "whale", "bowheadslate",
    [["calf", 450, 9000], ["adult", 1800, 58000]], ["norwegian_sea", "lofoten_shelf"], ["epipelagic"], 2, "filter"),
  s("white_beaked_dolphin", "White-beaked Dolphin", "Lagenorhynchus albirostris", "whale", "dolphingrey",
    [["calf", 120, 1400], ["adult", 280, 8000]], ["north_atlantic", "norwegian_sea"], ["epipelagic"], 3),

  // North Atlantic and Sargasso.
  s("sei_whale", "Sei Whale", "Balaenoptera borealis", "whale", "whaleblue",
    [["calf", 480, 9000], ["adult", 1600, 50000]], ["north_atlantic"], ["epipelagic"], 2, "filter"),
  s("north_atlantic_right_whale", "North Atlantic Right Whale", "Eubalaena glacialis", "whale", "rightwhale",
    [["calf", 450, 9500], ["adult", 1500, 52000]], ["north_atlantic"], ["epipelagic"], 2, "filter"),
  s("northern_bottlenose_whale", "Northern Bottlenose Whale", "Hyperoodon ampullatus", "whale", "beakedtaupe",
    [["calf", 350, 4000], ["adult", 900, 24000]], ["north_atlantic", "norwegian_sea"], ["mesopelagic", "bathypelagic"], 3),
  s("rissos_dolphin", "Risso's Dolphin", "Grampus griseus", "whale", "beakedtaupe",
    [["calf", 150, 1700], ["adult", 380, 11000]], ["north_atlantic", "sargasso_sea"], ["epipelagic"], 3),
  s("pygmy_sperm_whale", "Pygmy Sperm Whale", "Kogia breviceps", "whale", "sharkgrey",
    [["calf", 120, 1400], ["adult", 350, 10000]], ["sargasso_sea", "north_atlantic"], ["mesopelagic", "bathypelagic"], 4),
  s("dwarf_sperm_whale", "Dwarf Sperm Whale", "Kogia sima", "whale", "sharkgrey",
    [["calf", 100, 1000], ["adult", 270, 7000]], ["sargasso_sea"], ["mesopelagic"], 4),

  // Warm seas.
  s("brydes_whale", "Bryde's Whale", "Balaenoptera edeni", "whale", "whaleblue",
    [["calf", 400, 7000], ["adult", 1450, 44000]], ["coral_triangle", "benguela"], ["epipelagic"], 2, "filter"),
  s("spinner_dolphin", "Spinner Dolphin", "Stenella longirostris", "whale", "dolphingrey",
    [["calf", 80, 800], ["adult", 200, 5000]], ["coral_triangle"], ["epipelagic"], 4),
  s("melon_headed_whale", "Melon-headed Whale", "Peponocephala electra", "whale", "orcablack",
    [["calf", 110, 1200], ["adult", 270, 7000]], ["coral_triangle"], ["epipelagic"], 2),
  s("false_killer_whale", "False Killer Whale", "Pseudorca crassidens", "whale", "orcablack",
    [["calf", 180, 2200], ["adult", 500, 15000]], ["coral_triangle", "sargasso_sea"], ["epipelagic"], 2),
  s("short_finned_pilot_whale", "Short-finned Pilot Whale", "Globicephala macrorhynchus", "whale", "orcablack",
    [["calf", 170, 1900], ["adult", 550, 15000]], ["coral_triangle"], ["epipelagic"], 2),

  // Southern seas.
  s("southern_right_whale", "Southern Right Whale", "Eubalaena australis", "whale", "rightwhale",
    [["calf", 450, 9500], ["adult", 1500, 52000]], ["antarctic_convergence", "benguela"], ["epipelagic"], 2, "filter"),
  s("antarctic_minke_whale", "Antarctic Minke Whale", "Balaenoptera bonaerensis", "whale", "whaleblue",
    [["calf", 270, 3200], ["adult", 900, 24000]], ["antarctic_convergence"], ["epipelagic"], 3, "filter"),
  s("hourglass_dolphin", "Hourglass Dolphin", "Lagenorhynchus cruciger", "whale", "orcablack",
    [["calf", 90, 800], ["adult", 180, 4200]], ["antarctic_convergence"], ["epipelagic"], 3),
  s("dusky_dolphin", "Dusky Dolphin", "Lagenorhynchus obscurus", "whale", "dolphingrey",
    [["calf", 90, 900], ["adult", 200, 5000]], ["humboldt_current", "kelp_forest"], ["epipelagic"], 3),
  s("commersons_dolphin", "Commerson's Dolphin", "Cephalorhynchus commersonii", "whale", "orcablack",
    [["calf", 70, 500], ["adult", 140, 2600]], ["humboldt_current"], ["epipelagic"], 3),
  s("hectors_dolphin", "Hector's Dolphin", "Cephalorhynchus hectori", "whale", "dolphingrey",
    [["calf", 70, 500], ["adult", 140, 2600]], ["kelp_forest"], ["epipelagic"], 3),
  s("grey_whale", "Grey Whale", "Eschrichtius robustus", "whale", "greywhale",
    [["calf", 450, 8000], ["adult", 1400, 45000]], ["kelp_forest", "humboldt_current"], ["epipelagic"], 2, "filter"),

  // Deep divers — the beaked whales hunt squid far below the light.
  s("cuviers_beaked_whale", "Cuvier's Beaked Whale", "Ziphius cavirostris", "whale", "beakedtaupe",
    [["calf", 270, 3000], ["adult", 600, 18000]], [], ["mesopelagic", "bathypelagic", "abyssal"], 4),
  s("bairds_beaked_whale", "Baird's Beaked Whale", "Berardius bairdii", "whale", "beakedtaupe",
    [["calf", 450, 6000], ["adult", 1100, 30000]], ["mariana_approach", "humboldt_current"], ["mesopelagic", "bathypelagic"], 3),
  s("blainvilles_beaked_whale", "Blainville's Beaked Whale", "Mesoplodon densirostris", "whale", "beakedtaupe",
    [["calf", 200, 2200], ["adult", 450, 13000]], ["coral_triangle", "sargasso_sea"], ["mesopelagic", "bathypelagic"], 4),

  // ── Sunlight: Antarctic Convergence ─────────────────────────────────────
  s("leopard_seal", "Leopard Seal", "Hydrurga leptonyx", "whale", "sealbrown",
    [["pup", 120, 1500], ["adult", 320, 8000]], ["antarctic_convergence"], ["epipelagic"], 5),
  s("weddell_seal", "Weddell Seal", "Leptonychotes weddellii", "whale", "sealbrown",
    [["pup", 150, 1800], ["adult", 300, 9000]], ["antarctic_convergence"], ["epipelagic"], 5),
  s("antarctic_toothfish", "Antarctic Toothfish", "Dissostichus mawsoni", "fish", "darkpelagic",
    [["juvenile", 40, 400], ["adult", 170, 9000]], ["antarctic_convergence"], ["mesopelagic", "bathypelagic"], 6),
  s("antarctic_krill", "Antarctic Krill", "Euphausia superba", "fish", "translucent",
    [["adult", 6, 8]], ["antarctic_convergence"], ["epipelagic"], 24),
  s("mackerel_icefish", "Mackerel Icefish", "Champsocephalus gunnari", "fish", "silver",
    [["juvenile", 10, 30], ["adult", 35, 150]], ["antarctic_convergence"], ["mesopelagic"], 12),

  // ── Sunlight: Benguela & Humboldt upwelling ─────────────────────────────
  s("cape_hake", "Cape Hake", "Merluccius capensis", "fish", "mottled",
    [["juvenile", 20, 90], ["adult", 90, 900]], ["benguela"], ["mesopelagic"], 12),
  s("snoek", "Snoek", "Thyrsites atun", "serpent", "silver",
    [["juvenile", 30, 150], ["adult", 120, 1600]], ["benguela"], ["epipelagic"], 9),
  s("bronze_whaler", "Bronze Whaler Shark", "Carcharhinus brachyurus", "shark", "sharkgrey",
    [["juvenile", 80, 600], ["adult", 300, 7000]], ["benguela", "kelp_forest"], ["epipelagic"], 5),
  s("pacific_sardine", "Pacific Sardine", "Sardinops sagax", "fish", "silver",
    [["fry", 4, 5], ["adult", 25, 60]], ["humboldt_current", "kelp_forest"], ["epipelagic"], 24),
  s("northern_anchovy", "Northern Anchovy", "Engraulis mordax", "fish", "silver",
    [["fry", 3, 4], ["adult", 20, 45]], ["kelp_forest", "humboldt_current"], ["epipelagic"], 22),
  s("chub_mackerel", "Pacific Chub Mackerel", "Scomber japonicus", "fish", "blueback",
    [["juvenile", 12, 40], ["adult", 45, 300]], ["humboldt_current"], ["epipelagic"], 14),

  // ── Sunlight: Kelp Forest residents ─────────────────────────────────────
  s("giant_sea_bass", "Giant Sea Bass", "Stereolepis gigas", "maw", "mottled",
    [["juvenile", 30, 400], ["adult", 200, 30000]], ["kelp_forest"], ["epipelagic"], 3),
  s("kelp_bass", "Kelp Bass", "Paralabrax clathratus", "fish", "mottled",
    [["juvenile", 12, 50], ["adult", 55, 600]], ["kelp_forest"], ["epipelagic"], 10),
  s("california_sheephead", "California Sheephead", "Semicossyphus pulcher", "fish", "red",
    [["juvenile", 10, 40], ["adult", 60, 800]], ["kelp_forest"], ["epipelagic"], 9),
  s("opaleye", "Opaleye", "Girella nigricans", "fish", "mottled",
    [["juvenile", 8, 25], ["adult", 40, 300]], ["kelp_forest"], ["epipelagic"], 11),

  // ── Sunlight: Sargasso Sea ──────────────────────────────────────────────
  s("lookdown", "Lookdown", "Selene vomer", "fish", "silver",
    [["juvenile", 8, 20], ["adult", 35, 300]], ["sargasso_sea"], ["epipelagic"], 11),
  s("permit", "Permit", "Trachinotus falcatus", "fish", "silver",
    [["juvenile", 15, 80], ["adult", 90, 1600]], ["sargasso_sea"], ["epipelagic"], 7),
  s("atlantic_tarpon", "Atlantic Tarpon", "Megalops atlanticus", "fish", "silver",
    [["juvenile", 30, 200], ["adult", 200, 8000]], ["sargasso_sea"], ["epipelagic"], 5),

  // ── Sunlight: large sharks & ocean roamers ──────────────────────────────
  s("basking_shark", "Basking Shark", "Cetorhinus maximus", "shark", "sharkgrey",
    [["juvenile", 300, 4000], ["adult", 900, 30000]], ["north_atlantic", "norwegian_sea"], ["epipelagic"], 2, "filter"),
  s("thresher_shark", "Common Thresher Shark", "Alopias vulpinus", "shark", "sharkblue",
    [["juvenile", 150, 1200], ["adult", 500, 12000]], ["north_atlantic"], ["epipelagic", "mesopelagic"], 4),
  s("shortfin_mako", "Shortfin Mako", "Isurus oxyrinchus", "shark", "sharkblue",
    [["juvenile", 90, 700], ["adult", 320, 9000]], ["north_atlantic", "sargasso_sea"], ["epipelagic", "mesopelagic"], 4),
  s("tiger_shark", "Tiger Shark", "Galeocerdo cuvier", "shark", "sharkgrey",
    [["juvenile", 150, 1500], ["adult", 450, 20000]], ["coral_triangle"], ["epipelagic"], 3),
  s("bull_shark", "Bull Shark", "Carcharhinus leucas", "shark", "sharkgrey",
    [["juvenile", 90, 700], ["adult", 300, 9000]], ["coral_triangle", "sargasso_sea"], ["epipelagic"], 4),
  s("sand_tiger_shark", "Sand Tiger Shark", "Carcharias taurus", "shark", "sharkgrey",
    [["juvenile", 100, 800], ["adult", 300, 7000]], ["north_atlantic"], ["epipelagic"], 5),
  s("great_hammerhead", "Great Hammerhead", "Sphyrna mokarran", "shark", "sharkgrey",
    [["juvenile", 150, 1500], ["adult", 500, 18000]], ["coral_triangle"], ["epipelagic"], 3),
  s("oceanic_whitetip", "Oceanic Whitetip Shark", "Carcharhinus longimanus", "shark", "sharkgrey",
    [["juvenile", 80, 600], ["adult", 280, 7000]], ["sargasso_sea"], ["epipelagic"], 4),
  s("opah", "Opah", "Lampris guttatus", "fish", "red",
    [["juvenile", 40, 600], ["adult", 150, 9000]], ["north_atlantic"], ["epipelagic", "mesopelagic"], 4),

  // ── Twilight Zone (mesopelagic) ─────────────────────────────────────────
  s("pacific_hatchetfish", "Pacific Hatchetfish", "Argyropelecus affinis", "fish", "silver",
    [["juvenile", 2, 3], ["adult", 8, 11]], [], ["mesopelagic"], 20),
  s("stoplight_loosejaw", "Stoplight Loosejaw", "Malacosteus niger", "angler", "biolum",
    [["juvenile", 6, 15], ["adult", 25, 90]], [], ["mesopelagic", "bathypelagic"], 9),
  s("barreleye", "Barreleye", "Macropinna microstoma", "fish", "biolum",
    [["juvenile", 4, 8], ["adult", 15, 50]], [], ["mesopelagic"], 10),
  s("snipe_eel", "Slender Snipe Eel", "Nemichthys scolopaceus", "serpent", "biolum",
    [["juvenile", 30, 60], ["adult", 110, 300]], [], ["mesopelagic", "bathypelagic"], 9),
  s("strawberry_squid", "Strawberry Squid", "Histioteuthis heteropsis", "kraken", "red",
    [["juvenile", 6, 20], ["adult", 30, 180]], [], ["mesopelagic"], 9),
  s("velvet_belly_lanternshark", "Velvet Belly Lanternshark", "Etmopterus spinax", "shark", "biolum",
    [["juvenile", 15, 60], ["adult", 45, 300]], ["north_atlantic"], ["mesopelagic", "bathypelagic"], 8),
  s("pacific_blackdragon", "Pacific Blackdragon", "Idiacanthus antrostomus", "angler", "biolum",
    [["juvenile", 10, 30], ["adult", 55, 250]], [], ["mesopelagic", "bathypelagic"], 8),
  s("telescopefish", "Telescopefish", "Gigantura chuni", "fish", "biolum",
    [["juvenile", 8, 20], ["adult", 22, 90]], [], ["mesopelagic", "bathypelagic"], 8),

  // ── Midnight Zone (bathypelagic) ────────────────────────────────────────
  s("footballfish", "Atlantic Footballfish", "Himantolophus groenlandicus", "angler", "gulperblack",
    [["juvenile", 5, 15], ["adult", 45, 400]], [], ["bathypelagic"], 9),
  s("whipnose_angler", "Whipnose Anglerfish", "Gigantactis vanhoeffeni", "angler", "gulperblack",
    [["juvenile", 5, 12], ["adult", 40, 280]], [], ["bathypelagic", "abyssal"], 8),
  s("deepsea_anglerfish", "Deep-sea Anglerfish", "Ceratias holboelli", "angler", "gulperblack",
    [["juvenile", 10, 40], ["adult", 120, 1200]], [], ["bathypelagic", "abyssal"], 6),
  s("giant_grenadier", "Giant Grenadier", "Albatrossia pectoralis", "fish", "mottled",
    [["juvenile", 30, 200], ["adult", 180, 3000]], ["mariana_approach", "antarctic_convergence"], ["bathypelagic", "abyssal"], 8),
  s("longnose_chimaera", "Longnose Chimaera", "Rhinochimaera atlantica", "serpent", "snailpink",
    [["juvenile", 30, 150], ["adult", 140, 1600]], [], ["bathypelagic", "abyssal"], 7),

  // ── Abyssal & Hadal Zones ───────────────────────────────────────────────
  s("faceless_cusk", "Faceless Cusk", "Typhlonus nasus", "serpent", "snailpink",
    [["juvenile", 15, 80], ["adult", 45, 400]], ["mariana_approach"], ["abyssal", "hadal"], 10),
  s("spotted_ratfish", "Spotted Ratfish", "Hydrolagus colliei", "serpent", "snailpink",
    [["juvenile", 15, 80], ["adult", 60, 500]], [], ["mesopelagic", "bathypelagic"], 8),
  s("hadal_grenadier", "Hadal Grenadier", "Coryphaenoides yaquinae", "fish", "snailpink",
    [["juvenile", 20, 100], ["adult", 70, 600]], ["mariana_approach"], ["hadal"], 12),
  s("blob_sculpin", "Blob Sculpin", "Psychrolutes phrictus", "maw", "snailpink",
    [["juvenile", 15, 80], ["adult", 60, 700]], ["mariana_approach"], ["abyssal"], 9)
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

// What a strainer eats, however big it grows: krill and drifting larvae, and
// nothing that can look back at it. Deliberately excludes "tinyFish" — that is
// the size class a fresh player wears, and a baleen whale inhaling every
// hatchling that swims past would make the sea's friendliest animal its
// deadliest. Krill IS plankton + larvae, so this is also the true diet.
const FILTER_FEEDER_PREY = Object.freeze(["plankton", "larvae"]);

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
    // Only the DIET is overridden for strainers, never the tags: the size
    // bucket doubles as a size class, and a humpback must stay apex-tagged so
    // the things that genuinely outrank it can still eat it.
    diet: [{ minMass: 0, preyTags: species.feeds === "filter" ? [...FILTER_FEEDER_PREY] : dietForBucket(bucket) }],
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

// The species that specifically call a region home (excludes the "found
// everywhere" species so a signature list actually distinguishes one sea from
// another). Sorted by how common they are there — the headline residents
// first. Used by the map to answer "what lives in the Kelp Forest?".
export function signatureSpeciesForRegion(regionId, limit = 5) {
  return SPECIES.filter((species) => species.regions.includes(regionId))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((species) => ({ name: species.common, binomial: species.binomial }));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
