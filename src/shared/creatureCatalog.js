import { buildSpeciesCreatures } from "./speciesCatalog.js";

const PLAYER_DIET = Object.freeze([
  { minMass: 0, preyTags: ["plankton", "larvae", "jelly", "tinyFish"] },
  { minMass: 32, preyTags: ["plankton", "larvae", "tinyFish", "jelly", "crustacean"] },
  { minMass: 82, preyTags: ["plankton", "larvae", "tinyFish", "smallFish", "jelly", "crustacean"] },
  { minMass: 150, preyTags: ["tinyFish", "smallFish", "mediumFish", "cephalopod", "crustacean"] },
  { minMass: 340, preyTags: ["smallFish", "mediumFish", "largeFish", "cephalopod", "ray"] },
  { minMass: 760, preyTags: ["mediumFish", "largeFish", "ray", "shark", "mammal"] },
  { minMass: 1700, preyTags: ["largeFish", "ray", "shark", "mammal", "apex", "monster"] }
]);

const GROWTH_STAGES = Object.freeze([
  { minMass: 0, name: "hatchling", label: "Hatchling", scale: 0.72 },
  { minMass: 32, name: "juvenile", label: "Juvenile", scale: 0.9 },
  { minMass: 92, name: "hunter", label: "Hunter", scale: 1.08 },
  { minMass: 260, name: "giant", label: "Giant", scale: 1.28 },
  { minMass: 760, name: "leviathan", label: "Leviathan", scale: 1.52 },
  { minMass: 1750, name: "abyss king", label: "Abyss King", scale: 1.8 },
  { minMass: 4200, name: "trench lord", label: "Trench Lord", scale: 2.1 },
  { minMass: 9500, name: "titan", label: "Titan", scale: 2.45 },
  { minMass: 22000, name: "world eater", label: "World Eater", scale: 2.85 },
  { minMass: 56000, name: "hadal god", label: "Hadal God", scale: 3.35 },
  { minMass: 140_000, name: "tide sovereign", label: "Tide Sovereign", scale: 3.9 },
  { minMass: 400_000, name: "ocean incarnate", label: "Ocean Incarnate", scale: 4.5 },
  { minMass: 1_200_000, name: "the deep itself", label: "The Deep Itself", scale: 5.2 },
  { minMass: 3_000_000, name: "maw of the world", label: "Maw of the World", scale: 6.0 },
  { minMass: 8_000_000, name: "primordial tide", label: "Primordial Tide", scale: 6.9 },
  { minMass: 20_000_000, name: "the endless deep", label: "The Endless Deep", scale: 7.9 }
]);

const SCARY_CREATURE_ATLAS = Object.freeze({
  src: "/assets/creatures/scary-creature-atlas.png",
  columns: 5,
  rows: 2
});

const HAND_AUTHORED_CREATURES = {
  abyssal_serpent: {
    id: "abyssal_serpent",
    name: "Abyssal Serpent",
    summary: "Fast coiling hunter with narrow turns and a luminous belly.",
    trait: {
      name: "Pressure Coils",
      summary: "Swift coils in the abyss — faster and tighter below 4,000 m.",
      effects: {
        zoneBonuses: {
          abyssal: { speedMultiplier: 0.1, turnLerpBonus: 0.05 },
          hadal: { speedMultiplier: 0.14, turnLerpBonus: 0.07 }
        }
      }
    },
    playable: true,
    tags: ["monster"],
    baseMass: 14,
    baseRadius: 18,
    consumeRatio: 1.18,
    movement: { acceleration: 980, maxSpeed: 360, drag: 0.9, turnLerp: 0.22 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "serpent",
      body: "#1e6f82",
      belly: "#9be7dc",
      accent: "#83f7ff",
      pattern: "bands",
      eye: "#dbff9a",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 0 }
    }
  },
  glass_kraken: {
    id: "glass_kraken",
    name: "Glass Kraken",
    summary: "Translucent tentacled predator with strong burst control.",
    trait: {
      name: "Glass Slip",
      summary: "Translucent flesh slips through drift nets with less snagging.",
      effects: { hazardDrainResist: { drift_net: 0.45 } }
    },
    playable: true,
    tags: ["monster", "cephalopod"],
    baseMass: 13,
    baseRadius: 17,
    consumeRatio: 1.15,
    movement: { acceleration: 910, maxSpeed: 340, drag: 0.86, turnLerp: 0.26 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "kraken",
      body: "#a855f7",
      belly: "#f0d6ff",
      accent: "#5eead4",
      pattern: "spots",
      eye: "#fef08a",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 1 }
    }
  },
  reef_leviathan: {
    id: "reef_leviathan",
    name: "Reef Leviathan",
    summary: "Wide gliding beast with stable momentum and reef-bright fins.",
    trait: {
      name: "Sunlit Glide",
      summary: "Reef-bright fins catch the sunlight zone for an easy cruise.",
      effects: { zoneBonuses: { epipelagic: { speedMultiplier: 0.1 } } }
    },
    playable: true,
    tags: ["monster", "ray"],
    baseMass: 16,
    baseRadius: 19,
    consumeRatio: 1.2,
    movement: { acceleration: 880, maxSpeed: 330, drag: 0.82, turnLerp: 0.2 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "ray",
      body: "#0f766e",
      belly: "#d9fff6",
      accent: "#facc15",
      pattern: "edgeGlow",
      eye: "#f8fafc",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 2 }
    }
  },
  craken: {
    id: "craken",
    name: "Craken",
    summary: "A scarred abyss cephalopod built for quick ambushes.",
    trait: {
      name: "Ambush Ink",
      summary: "Burst sprints cost less mass — built for hit-and-run ambushes.",
      effects: { boostMassCostMultiplier: 0.58 }
    },
    playable: true,
    tags: ["monster", "cephalopod"],
    baseMass: 14,
    baseRadius: 18,
    consumeRatio: 1.12,
    movement: { acceleration: 960, maxSpeed: 355, drag: 0.87, turnLerp: 0.28 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "kraken",
      body: "#7c2d12",
      belly: "#fed7aa",
      accent: "#fb7185",
      pattern: "scars",
      eye: "#fef08a",
      artStyle: "photoreal cephalopod horror concept",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 3 }
    }
  },
  sea_eater: {
    id: "sea_eater",
    name: "Sea Eater",
    summary: "A living mouth from the trench with brutal bite reach.",
    trait: {
      name: "Rending Maw",
      summary: "A wider bite window — swallow prey just above your usual limit.",
      effects: { biteRatioBonus: 0.05 }
    },
    playable: true,
    tags: ["monster", "shark"],
    baseMass: 16,
    baseRadius: 20,
    consumeRatio: 1.08,
    movement: { acceleration: 850, maxSpeed: 320, drag: 0.8, turnLerp: 0.18 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "maw",
      body: "#111827",
      belly: "#d1d5db",
      accent: "#ef4444",
      pattern: "teeth",
      eye: "#facc15",
      artStyle: "photoreal trench predator concept",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 4 }
    }
  },
  bloop: {
    id: "bloop",
    name: "Bloop",
    summary: "A massive sonar-haunting whale phantom that grows early.",
    trait: {
      name: "Sonar Bloom",
      summary: "Early growth spurts while still a hatchling or juvenile.",
      effects: { growthMultiplier: 1.18, growthUntilMass: 220 }
    },
    playable: true,
    tags: ["monster", "mammal"],
    baseMass: 18,
    baseRadius: 21,
    consumeRatio: 1.16,
    movement: { acceleration: 800, maxSpeed: 305, drag: 0.76, turnLerp: 0.15 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "whale",
      body: "#1e3a8a",
      belly: "#bfdbfe",
      accent: "#22d3ee",
      pattern: "sonar",
      eye: "#f8fafc",
      artStyle: "cinematic deep sea whale cryptid",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 5 }
    }
  },
  katulu: {
    id: "katulu",
    name: "Katulu",
    summary: "A green-black tentacled old one with a hypnotic eye glow.",
    trait: {
      name: "Hypnotic Lure",
      summary: "A wider feeding aura — plankton drifts toward the glowing eye.",
      effects: { magnetRadius: 38 }
    },
    playable: true,
    tags: ["monster", "cephalopod"],
    baseMass: 15,
    baseRadius: 19,
    consumeRatio: 1.1,
    movement: { acceleration: 900, maxSpeed: 335, drag: 0.84, turnLerp: 0.23 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "kraken",
      body: "#064e3b",
      belly: "#ccfbf1",
      accent: "#a3e635",
      pattern: "runes",
      eye: "#bef264",
      artStyle: "high detail mythic sea monster illustration",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 6 }
    }
  },
  elgramaha: {
    id: "elgramaha",
    name: "El Gram Maga",
    summary: "A cavern-mouthed abyss glider with ribbed baleen and a heavy sweep.",
    trait: {
      name: "Filter Sweep",
      summary: "Baleen strains plankton and jelly with extra efficiency.",
      effects: { tagDigestionBonus: { plankton: 0.12, jelly: 0.12 } }
    },
    playable: true,
    tags: ["monster", "apex"],
    baseMass: 17,
    baseRadius: 21,
    consumeRatio: 1.14,
    movement: { acceleration: 830, maxSpeed: 315, drag: 0.79, turnLerp: 0.17 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "maw",
      body: "#0b3f66",
      belly: "#76d6ff",
      accent: "#2dd4ff",
      pattern: "baleen",
      eye: "#dffbff",
      artStyle: "cinematic cavern-mouthed abyssal filter leviathan",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 7 },
      animationSprite: {
        src: "/assets/creatures/el-gram-maga-frames.png",
        columns: 4,
        rows: 1,
        frameRate: 1.3,
        scale: 1.45
      }
    }
  },
  void_angler: {
    id: "void_angler",
    name: "Void Angler",
    summary: "A black-lantern hunter that lures prey with cold light.",
    trait: {
      name: "Cold Lantern",
      summary: "Patient in the twilight and midnight zones, with a faint lure radius.",
      effects: {
        zoneBonuses: {
          mesopelagic: { speedMultiplier: 0.08 },
          bathypelagic: { speedMultiplier: 0.1 }
        },
        magnetRadius: 22
      }
    },
    playable: true,
    tags: ["monster", "largeFish"],
    baseMass: 13,
    baseRadius: 18,
    consumeRatio: 1.13,
    movement: { acceleration: 980, maxSpeed: 345, drag: 0.86, turnLerp: 0.24 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "angler",
      body: "#0f172a",
      belly: "#64748b",
      accent: "#67e8f9",
      pattern: "lure",
      eye: "#f8fafc",
      artStyle: "photoreal abyssal angler monster",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 8 }
    }
  },
  umbral_manta: {
    id: "umbral_manta",
    name: "Umbral Manta",
    summary: "A shadow ray that sweeps through plankton clouds smoothly.",
    trait: {
      name: "Shadow Drift",
      summary: "Wide-winged glides resist maelstrom pull — ride the currents, don't fight them.",
      effects: { maelstromPullResist: 0.35 }
    },
    playable: true,
    tags: ["monster", "ray"],
    baseMass: 16,
    baseRadius: 22,
    consumeRatio: 1.18,
    movement: { acceleration: 820, maxSpeed: 325, drag: 0.78, turnLerp: 0.16 },
    diet: PLAYER_DIET,
    stages: GROWTH_STAGES,
    visual: {
      shape: "ray",
      body: "#312e81",
      belly: "#e0e7ff",
      accent: "#f0abfc",
      pattern: "starlit",
      eye: "#fef3c7",
      artStyle: "high quality bioluminescent manta cryptid",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 9 }
    }
  },
  lantern_fry: {
    id: "lantern_fry",
    name: "Lantern Fry",
    playable: false,
    tags: ["tinyFish"],
    baseMass: 9,
    baseRadius: 10,
    consumeRatio: 1.22,
    movement: { acceleration: 720, maxSpeed: 260, drag: 0.82, turnLerp: 0.3 },
    diet: [{ minMass: 0, preyTags: ["plankton", "larvae"] }],
    stages: [{ minMass: 0, name: "adult", label: "Lantern Fry", scale: 1 }],
    visual: {
      shape: "fish",
      body: "#38bdf8",
      belly: "#dffbff",
      accent: "#fde68a",
      pattern: "lateralGlow",
      eye: "#111827"
    }
  },
  silver_sardine: {
    id: "silver_sardine",
    name: "Silver Sardine",
    playable: false,
    tags: ["smallFish"],
    baseMass: 24,
    baseRadius: 15,
    consumeRatio: 1.2,
    movement: { acceleration: 840, maxSpeed: 300, drag: 0.8, turnLerp: 0.25 },
    diet: [{ minMass: 0, preyTags: ["plankton", "larvae", "tinyFish"] }],
    stages: [{ minMass: 0, name: "adult", label: "Silver Sardine", scale: 1 }],
    visual: {
      shape: "fish",
      body: "#94a3b8",
      belly: "#f8fafc",
      accent: "#60a5fa",
      pattern: "stripe",
      eye: "#111827"
    }
  },
  reef_cod: {
    id: "reef_cod",
    name: "Reef Cod",
    playable: false,
    tags: ["mediumFish"],
    baseMass: 90,
    baseRadius: 26,
    consumeRatio: 1.18,
    movement: { acceleration: 620, maxSpeed: 230, drag: 0.76, turnLerp: 0.19 },
    diet: [{ minMass: 0, preyTags: ["tinyFish", "smallFish", "crustacean"] }],
    stages: [{ minMass: 0, name: "adult", label: "Reef Cod", scale: 1 }],
    visual: {
      shape: "fish",
      body: "#d97706",
      belly: "#fff7ed",
      accent: "#115e59",
      pattern: "mottled",
      eye: "#111827"
    }
  },
  humboldt_squid: {
    id: "humboldt_squid",
    name: "Humboldt Squid",
    playable: false,
    tags: ["cephalopod", "mediumFish"],
    baseMass: 155,
    baseRadius: 30,
    consumeRatio: 1.14,
    movement: { acceleration: 720, maxSpeed: 280, drag: 0.84, turnLerp: 0.28 },
    diet: [{ minMass: 0, preyTags: ["tinyFish", "smallFish", "mediumFish"] }],
    stages: [{ minMass: 0, name: "adult", label: "Humboldt Squid", scale: 1 }],
    visual: {
      shape: "kraken",
      body: "#b45309",
      belly: "#fed7aa",
      accent: "#f97316",
      pattern: "spots",
      eye: "#fef08a",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 3, tint: { color: "#f97316", alpha: 0.34 } }
    }
  },
  yellowfin_tuna: {
    id: "yellowfin_tuna",
    name: "Yellowfin Tuna",
    playable: false,
    tags: ["largeFish"],
    baseMass: 330,
    baseRadius: 42,
    consumeRatio: 1.2,
    movement: { acceleration: 860, maxSpeed: 350, drag: 0.82, turnLerp: 0.18 },
    diet: [{ minMass: 0, preyTags: ["smallFish", "mediumFish", "cephalopod"] }],
    stages: [{ minMass: 0, name: "adult", label: "Yellowfin Tuna", scale: 1 }],
    visual: {
      shape: "fish",
      body: "#1d4ed8",
      belly: "#fefce8",
      accent: "#facc15",
      pattern: "finFlash",
      eye: "#111827",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 5, tint: { color: "#facc15", alpha: 0.28 } }
    }
  },
  manta_ray: {
    id: "manta_ray",
    name: "Manta Ray",
    playable: false,
    tags: ["ray", "largeFish"],
    baseMass: 520,
    baseRadius: 54,
    consumeRatio: 1.28,
    movement: { acceleration: 540, maxSpeed: 225, drag: 0.72, turnLerp: 0.16 },
    diet: [{ minMass: 0, preyTags: ["plankton", "larvae", "tinyFish"] }],
    stages: [{ minMass: 0, name: "adult", label: "Manta Ray", scale: 1 }],
    visual: {
      shape: "ray",
      body: "#334155",
      belly: "#e2e8f0",
      accent: "#38bdf8",
      pattern: "edgeGlow",
      eye: "#f8fafc",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 9, tint: { color: "#38bdf8", alpha: 0.3 } }
    }
  },
  mako_shark: {
    id: "mako_shark",
    name: "Mako Shark",
    playable: false,
    tags: ["shark", "apex"],
    baseMass: 950,
    baseRadius: 72,
    consumeRatio: 1.17,
    movement: { acceleration: 780, maxSpeed: 335, drag: 0.78, turnLerp: 0.16 },
    diet: [{ minMass: 0, preyTags: ["mediumFish", "largeFish", "ray", "cephalopod", "mammal"] }],
    stages: [{ minMass: 0, name: "adult", label: "Mako Shark", scale: 1 }],
    visual: {
      shape: "shark",
      body: "#475569",
      belly: "#f8fafc",
      accent: "#0ea5e9",
      pattern: "countershade",
      eye: "#111827",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 4, tint: { color: "#7dd3fc", alpha: 0.26 } }
    }
  },
  blue_whale: {
    id: "blue_whale",
    name: "Blue Whale",
    playable: false,
    tags: ["mammal"],
    baseMass: 1800,
    baseRadius: 118,
    consumeRatio: 1.42,
    movement: { acceleration: 360, maxSpeed: 165, drag: 0.68, turnLerp: 0.1 },
    diet: [{ minMass: 0, preyTags: ["plankton", "larvae", "tinyFish"] }],
    stages: [{ minMass: 0, name: "adult", label: "Blue Whale", scale: 1 }],
    visual: {
      shape: "whale",
      body: "#2563eb",
      belly: "#dbeafe",
      accent: "#7dd3fc",
      pattern: "softSpots",
      eye: "#0f172a",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 2, tint: { color: "#3b82f6", alpha: 0.32 } }
    }
  },
  ancient_leviathan: {
    id: "ancient_leviathan",
    name: "Ancient Leviathan",
    playable: false,
    tags: ["monster", "apex"],
    baseMass: 18000,
    baseRadius: 280,
    consumeRatio: 1.12,
    movement: { acceleration: 320, maxSpeed: 132, drag: 0.66, turnLerp: 0.08 },
    diet: [{ minMass: 0, preyTags: ["largeFish", "ray", "shark", "mammal", "monster", "apex"] }],
    stages: [{ minMass: 0, name: "adult", label: "Ancient Leviathan", scale: 1 }],
    visual: {
      shape: "serpent",
      body: "#172554",
      belly: "#67e8f9",
      accent: "#fb7185",
      pattern: "bands",
      eye: "#fef08a",
      sprite: { ...SCARY_CREATURE_ATLAS, index: 0, tint: { color: "#fb7185", alpha: 0.36 } }
    }
  }
};

// Real marine species (speciesCatalog.js) are folded in alongside the
// hand-authored monsters so getCreatureDefinition / radiusForCreature /
// canConsume / the renderer all treat them identically — no per-species rules.
export const CREATURE_CATALOG = deepFreeze({
  ...HAND_AUTHORED_CREATURES,
  ...buildSpeciesCreatures()
});

export const FOOD_CATALOG = deepFreeze({
  marine_snow: {
    id: "marine_snow",
    name: "Marine Snow",
    tags: ["plankton"],
    mass: 0.9,
    radius: 3,
    color: "#d9f99d",
    glow: "#bef264"
  },
  plankton: {
    id: "plankton",
    name: "Plankton Bloom",
    tags: ["plankton"],
    mass: 1.2,
    radius: 4,
    color: "#a7f3d0",
    glow: "#5eead4"
  },
  copepod_cluster: {
    id: "copepod_cluster",
    name: "Copepod Cluster",
    tags: ["plankton", "larvae"],
    mass: 1.8,
    radius: 5,
    color: "#99f6e4",
    glow: "#2dd4bf"
  },
  krill: {
    id: "krill",
    name: "Krill",
    tags: ["plankton", "larvae"],
    mass: 2.4,
    radius: 6,
    color: "#fda4af",
    glow: "#fecdd3"
  },
  baby_shrimp: {
    id: "baby_shrimp",
    name: "Baby Shrimp",
    tags: ["larvae", "crustacean"],
    mass: 3.4,
    radius: 7,
    color: "#fdba74",
    glow: "#fed7aa"
  },
  larval_fish: {
    id: "larval_fish",
    name: "Larval Fish",
    tags: ["larvae", "tinyFish"],
    mass: 4.5,
    radius: 8,
    color: "#bfdbfe",
    glow: "#93c5fd"
  },
  comb_jelly: {
    id: "comb_jelly",
    name: "Comb Jelly",
    tags: ["jelly", "plankton"],
    mass: 5.4,
    radius: 9,
    color: "#fbcfe8",
    glow: "#f9a8d4"
  },
  glass_eel: {
    id: "glass_eel",
    name: "Glass Eel",
    tags: ["larvae", "tinyFish"],
    mass: 6.3,
    radius: 9,
    color: "#bae6fd",
    glow: "#7dd3fc"
  },
  reef_minnow: {
    id: "reef_minnow",
    name: "Reef Minnow",
    tags: ["tinyFish"],
    mass: 8.2,
    radius: 10,
    color: "#fde68a",
    glow: "#facc15"
  },
  moon_jelly: {
    id: "moon_jelly",
    name: "Moon Jelly",
    tags: ["jelly"],
    mass: 8.5,
    radius: 12,
    color: "#e9d5ff",
    glow: "#c084fc"
  },
  coral_crab: {
    id: "coral_crab",
    name: "Coral Crab",
    tags: ["crustacean"],
    mass: 13,
    radius: 12,
    color: "#fb923c",
    glow: "#fed7aa"
  }
});

export const ADDON_CATALOG = deepFreeze({
  tide_ribbon: {
    id: "tide_ribbon",
    name: "Tide Ribbon",
    durationMs: 45000,
    maxStacks: 3,
    effects: { speedMultiplier: 0.1, magnetRadius: 24 },
    color: "#38bdf8"
  },
  remora_swarm: {
    id: "remora_swarm",
    name: "Remora Swarm",
    durationMs: 60000,
    maxStacks: 4,
    effects: { digestionMultiplier: 0.08, orbitDamage: 0.02 },
    color: "#f8fafc"
  },
  coral_spurs: {
    id: "coral_spurs",
    name: "Coral Spurs",
    durationMs: 50000,
    maxStacks: 2,
    effects: { biteRatioBonus: 0.05 },
    color: "#fb7185"
  },
  pearl_shield: {
    id: "pearl_shield",
    name: "Pearl Shield",
    durationMs: 70000,
    maxStacks: 2,
    effects: { shieldCharges: 1 },
    color: "#fde68a"
  }
});

export const HAZARD_CATALOG = deepFreeze({
  maelstrom: {
    id: "maelstrom",
    name: "the Maelstrom",
    summary:
      "A spinning vortex that feeds on whatever it grinds down — every meal makes it wider and hungrier. Outgrow it, and you can wrestle it apart and swallow the storm.",
    influenceRadius: 360,
    coreRadius: 150,
    pull: 540,
    drainPerSecond: 0.16,
    lethal: true,
    // Tug-of-war economy: the vortex has its own mass. Matter it drains feeds
    // it (it grows); a creature above overpowerRatio times its mass grinds it
    // down instead and consumes it when it collapses.
    baseMass: 520,
    maxMass: 26_000,
    collapseMass: 90,
    overpowerRatio: 1.25,
    grindPerSecond: 0.5,
    consumeGain: 0.4,
    color: "#5eead4",
    accent: "#0e7490"
  },
  drift_net: {
    id: "drift_net",
    name: "a Drift Net",
    summary: "A tangled snare that slows anything caught in it and slowly strips away mass until you escape.",
    radius: 210,
    dragFactor: 0.42,
    drainPerSecond: 0.05,
    lethal: false,
    color: "#cbd5e1",
    accent: "#64748b"
  }
});

export const PLAYABLE_CREATURE_IDS = Object.freeze(
  Object.values(CREATURE_CATALOG)
    .filter((creature) => creature.playable)
    .map((creature) => creature.id)
);

// Roughly the mass at which a creature fills the screen — growth continues
// well past it so the late game keeps a sense of ever-larger scale.
export const PLAYER_FULL_SCREEN_MASS = 120_000;
// The hard growth ceiling lands exactly on the final growth stage, so hitting
// the cap reads as reaching the ultimate form rather than a number stalling.
export const PLAYER_MAX_MASS = 20_000_000;

export function getCreatureDefinition(creatureId) {
  return CREATURE_CATALOG[creatureId] ?? CREATURE_CATALOG.abyssal_serpent;
}

export function getFoodDefinition(foodId) {
  return FOOD_CATALOG[foodId] ?? FOOD_CATALOG.plankton;
}

export function getAddonDefinition(addonId) {
  return ADDON_CATALOG[addonId] ?? ADDON_CATALOG.tide_ribbon;
}

export function getHazardDefinition(hazardType) {
  return HAZARD_CATALOG[hazardType] ?? HAZARD_CATALOG.drift_net;
}

// Gameplay-oversized specimens. Past ~5× a species' real adult mass a creature
// is beyond any real-world record, so the label says so honestly: "Giant …",
// then "Monster …". Thresholds are relative to adult mass so a monster herring
// and a monster whale both read right. The spawner uses the same threshold to
// decide when an individual has earned the prefix.
export const OVERSIZE_TIERS = Object.freeze([
  { minRatio: 25, prefix: "Monster" },
  { minRatio: 5, prefix: "Giant" }
]);

export function oversizeTier(creatureId, mass) {
  const creature = getCreatureDefinition(creatureId);
  if (!Number.isFinite(mass) || !creature.baseMass) {
    return null;
  }
  const ratio = mass / creature.baseMass;
  for (const tier of OVERSIZE_TIERS) {
    if (ratio >= tier.minRatio) {
      return tier;
    }
  }
  return null;
}

export function getGrowthStage(creatureId, mass) {
  const stages = getCreatureDefinition(creatureId).stages;
  let active = stages[0];
  for (const stage of stages) {
    if (mass >= stage.minMass) {
      active = stage;
    }
  }
  return active;
}

// A quiet, information-dense label for an NPC: "[common name] · [life phase] ·
// [real size]". Built species carry real per-phase lengths; the hand-authored
// monsters and single-stage NPCs just show their name (no "· adult"). The kids
// absorb that animals grow through named sequences purely by reading the thing
// trying to eat them — no facts are ever pushed on screen.
export function creatureLabel(creatureId, mass) {
  const definition = getCreatureDefinition(creatureId);
  const name = definition.commonName ?? definition.name;
  // An oversized specimen is beyond its real life-cycle chart, so the label is
  // just "[Giant|Monster] [name]" — quoting a real length would be a lie.
  const tier = definition.playable ? null : oversizeTier(creatureId, mass);
  if (tier) {
    return `${tier.prefix} ${name}`;
  }
  if (!definition.speciesBuilt || definition.stages.length <= 1) {
    return name;
  }
  const stage = getGrowthStage(creatureId, mass);
  const cm = stage.cm;
  if (!Number.isFinite(cm)) {
    return `${name} · ${stage.name}`;
  }
  const size = cm >= 100 ? `${(cm / 100).toFixed(cm >= 1000 ? 0 : 1)} m` : `${Math.round(cm)} cm`;
  return `${name} · ${stage.name} · ${size}`;
}

export function scientificNameFor(creatureId) {
  return getCreatureDefinition(creatureId).binomial ?? null;
}

export function getDietTags(creatureId, mass) {
  const diet = getCreatureDefinition(creatureId).diet;
  const tags = new Set();
  for (const entry of diet) {
    if (mass >= entry.minMass) {
      for (const tag of entry.preyTags) {
        tags.add(tag);
      }
    }
  }
  return tags.size > 0 ? [...tags] : diet[0].preyTags;
}

export function getEntityTags(entity) {
  if (entity.kind === "food") {
    return getFoodDefinition(entity.foodId).tags;
  }
  if (entity.creatureId) {
    const tags = getCreatureDefinition(entity.creatureId).tags;
    if (entity.kind === "player") {
      return [...tags, sizeTagForMass(entity.mass)];
    }
    return tags;
  }
  return [];
}

const RADIUS_MASS_EXPONENT = 0.43;

export function radiusForCreature(creatureId, mass) {
  const creature = getCreatureDefinition(creatureId);
  return creature.baseRadius * Math.pow(Math.max(0.1, mass / creature.baseMass), RADIUS_MASS_EXPONENT);
}

// Inverse of radiusForCreature: the mass this species needs to present a given
// radius. Species differ wildly in mass→radius scale (real lengths vs balanced
// masses), so anything that wants "visibly as big as X" must aim by radius.
export function massForCreatureRadius(creatureId, radius) {
  const creature = getCreatureDefinition(creatureId);
  return creature.baseMass * Math.pow(Math.max(1, radius) / creature.baseRadius, 1 / RADIUS_MASS_EXPONENT);
}

export function getCreatureTrait(creatureId) {
  return getCreatureDefinition(creatureId).trait ?? null;
}

export function resolveTraitBonuses(creatureId, { zoneId, mass } = {}) {
  const trait = getCreatureTrait(creatureId);
  const effects = trait?.effects;
  const bonuses = {
    speedMultiplier: 0,
    turnLerpBonus: 0,
    magnetRadius: 0,
    digestionMultiplier: 0,
    biteRatioBonus: 0,
    growthMultiplier: 1,
    boostMassCostMultiplier: 1,
    maelstromPullResist: 0,
    tagDigestionBonus: {}
  };

  if (!effects) {
    return bonuses;
  }

  if (zoneId && effects.zoneBonuses?.[zoneId]) {
    const zone = effects.zoneBonuses[zoneId];
    bonuses.speedMultiplier += zone.speedMultiplier ?? 0;
    bonuses.turnLerpBonus += zone.turnLerpBonus ?? 0;
  }

  bonuses.magnetRadius += effects.magnetRadius ?? 0;
  bonuses.digestionMultiplier += effects.digestionMultiplier ?? 0;
  bonuses.biteRatioBonus += effects.biteRatioBonus ?? 0;
  bonuses.maelstromPullResist += effects.maelstromPullResist ?? 0;

  if (effects.boostMassCostMultiplier !== undefined) {
    bonuses.boostMassCostMultiplier = effects.boostMassCostMultiplier;
  }

  if (effects.growthMultiplier && mass !== undefined && mass < (effects.growthUntilMass ?? Infinity)) {
    bonuses.growthMultiplier = effects.growthMultiplier;
  }

  if (effects.tagDigestionBonus) {
    bonuses.tagDigestionBonus = { ...effects.tagDigestionBonus };
  }

  return bonuses;
}

export function traitHazardDrainResist(creatureId, hazardType) {
  const resist = getCreatureTrait(creatureId)?.effects?.hazardDrainResist;
  return resist?.[hazardType] ?? 0;
}

export function publicCreatureCatalog() {
  return {
    playable: PLAYABLE_CREATURE_IDS.map((id) => {
      const creature = getCreatureDefinition(id);
      return {
        id: creature.id,
        name: creature.name,
        summary: creature.summary,
        trait: creature.trait
          ? { name: creature.trait.name, summary: creature.trait.summary }
          : null,
        baseMass: creature.baseMass,
        visual: creature.visual,
        stages: creature.stages
      };
    }),
    creatures: Object.fromEntries(
      Object.values(CREATURE_CATALOG).map((creature) => [
        creature.id,
        {
          id: creature.id,
          name: creature.name,
          summary: creature.summary,
          visual: creature.visual,
          tags: creature.tags
        }
      ])
    ),
    food: FOOD_CATALOG,
    addons: ADDON_CATALOG,
    hazards: HAZARD_CATALOG
  };
}

export function canConsume(consumer, target, bonuses = {}) {
  if (!consumer || !target || consumer.id === target.id) {
    return false;
  }
  if (consumer.kind === "food" || consumer.kind === "addon" || target.kind === "addon") {
    return false;
  }

  const preyTags = getDietTags(consumer.creatureId, consumer.mass);
  const targetTags = getEntityTags(target);
  const hasDietMatch = targetTags.some((tag) => preyTags.includes(tag));

  const biteRatioBonus = bonuses.biteRatioBonus ?? 0;
  if (target.kind === "food") {
    if (consumer.kind !== "player" && !hasDietMatch) {
      return false;
    }
    return target.mass <= consumer.mass * (0.95 + biteRatioBonus);
  }

  const creature = getCreatureDefinition(consumer.creatureId);
  const requiredRatio = Math.max(1.04, creature.consumeRatio - biteRatioBonus);
  if (!hasCreatureSizeAdvantage(consumer, target, requiredRatio)) {
    return false;
  }
  if (consumer.kind === "player") {
    return true;
  }
  if (!hasDietMatch) {
    return false;
  }
  return consumer.mass >= target.mass * requiredRatio;
}

function hasCreatureSizeAdvantage(consumer, target, requiredMassRatio) {
  const consumerRadius = radiusForEntity(consumer);
  const targetRadius = radiusForEntity(target);
  if (!Number.isFinite(consumerRadius) || !Number.isFinite(targetRadius)) {
    return true;
  }

  const requiredRadiusRatio = Math.max(1.03, Math.pow(requiredMassRatio, 0.43));
  return consumerRadius >= targetRadius * requiredRadiusRatio;
}

function radiusForEntity(entity) {
  if (Number.isFinite(entity.radius) && entity.radius > 0) {
    return entity.radius;
  }
  if (entity.creatureId && Number.isFinite(entity.mass)) {
    return radiusForCreature(entity.creatureId, entity.mass);
  }
  return null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);
  for (const property of Object.values(value)) {
    deepFreeze(property);
  }
  return value;
}

export function sizeTagForMass(mass) {
  if (mass < 35) {
    return "tinyFish";
  }
  if (mass < 90) {
    return "smallFish";
  }
  if (mass < 220) {
    return "mediumFish";
  }
  if (mass < 620) {
    return "largeFish";
  }
  if (mass < 1500) {
    return "shark";
  }
  return "apex";
}
