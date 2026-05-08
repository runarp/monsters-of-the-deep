const PLAYER_DIET = Object.freeze([
  { minMass: 0, preyTags: ["plankton", "larvae"] },
  { minMass: 28, preyTags: ["plankton", "larvae", "tinyFish", "jelly"] },
  { minMass: 70, preyTags: ["plankton", "larvae", "tinyFish", "smallFish", "crustacean"] },
  { minMass: 160, preyTags: ["tinyFish", "smallFish", "mediumFish", "cephalopod", "crustacean"] },
  { minMass: 390, preyTags: ["smallFish", "mediumFish", "largeFish", "cephalopod", "ray"] },
  { minMass: 900, preyTags: ["mediumFish", "largeFish", "ray", "shark", "mammal"] },
  { minMass: 1900, preyTags: ["largeFish", "ray", "shark", "mammal", "apex", "monster"] }
]);

const GROWTH_STAGES = Object.freeze([
  { minMass: 0, name: "hatchling", label: "Hatchling", scale: 0.72 },
  { minMass: 45, name: "juvenile", label: "Juvenile", scale: 0.9 },
  { minMass: 130, name: "hunter", label: "Hunter", scale: 1.08 },
  { minMass: 360, name: "giant", label: "Giant", scale: 1.28 },
  { minMass: 1000, name: "leviathan", label: "Leviathan", scale: 1.52 },
  { minMass: 2400, name: "abyss king", label: "Abyss King", scale: 1.8 }
]);

export const CREATURE_CATALOG = deepFreeze({
  abyssal_serpent: {
    id: "abyssal_serpent",
    name: "Abyssal Serpent",
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
      eye: "#dbff9a"
    }
  },
  glass_kraken: {
    id: "glass_kraken",
    name: "Glass Kraken",
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
      eye: "#fef08a"
    }
  },
  reef_leviathan: {
    id: "reef_leviathan",
    name: "Reef Leviathan",
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
      eye: "#f8fafc"
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
      eye: "#fef08a"
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
      eye: "#111827"
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
      eye: "#f8fafc"
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
      eye: "#111827"
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
      eye: "#0f172a"
    }
  },
  ancient_leviathan: {
    id: "ancient_leviathan",
    name: "Ancient Leviathan",
    playable: false,
    tags: ["monster", "apex"],
    baseMass: 3100,
    baseRadius: 140,
    consumeRatio: 1.12,
    movement: { acceleration: 420, maxSpeed: 185, drag: 0.7, turnLerp: 0.12 },
    diet: [{ minMass: 0, preyTags: ["largeFish", "ray", "shark", "mammal", "monster", "apex"] }],
    stages: [{ minMass: 0, name: "adult", label: "Ancient Leviathan", scale: 1 }],
    visual: {
      shape: "serpent",
      body: "#172554",
      belly: "#67e8f9",
      accent: "#fb7185",
      pattern: "bands",
      eye: "#fef08a"
    }
  }
});

export const FOOD_CATALOG = deepFreeze({
  plankton: {
    id: "plankton",
    name: "Plankton Bloom",
    tags: ["plankton"],
    mass: 1.2,
    radius: 4,
    color: "#a7f3d0",
    glow: "#5eead4"
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
  larval_fish: {
    id: "larval_fish",
    name: "Larval Fish",
    tags: ["larvae", "tinyFish"],
    mass: 4.5,
    radius: 8,
    color: "#bfdbfe",
    glow: "#93c5fd"
  },
  moon_jelly: {
    id: "moon_jelly",
    name: "Moon Jelly",
    tags: ["jelly"],
    mass: 9,
    radius: 12,
    color: "#e9d5ff",
    glow: "#c084fc"
  },
  coral_crab: {
    id: "coral_crab",
    name: "Coral Crab",
    tags: ["crustacean"],
    mass: 16,
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

export const PLAYABLE_CREATURE_IDS = Object.freeze(
  Object.values(CREATURE_CATALOG)
    .filter((creature) => creature.playable)
    .map((creature) => creature.id)
);

export function getCreatureDefinition(creatureId) {
  return CREATURE_CATALOG[creatureId] ?? CREATURE_CATALOG.abyssal_serpent;
}

export function getFoodDefinition(foodId) {
  return FOOD_CATALOG[foodId] ?? FOOD_CATALOG.plankton;
}

export function getAddonDefinition(addonId) {
  return ADDON_CATALOG[addonId] ?? ADDON_CATALOG.tide_ribbon;
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

export function getDietTags(creatureId, mass) {
  const diet = getCreatureDefinition(creatureId).diet;
  let active = diet[0];
  for (const entry of diet) {
    if (mass >= entry.minMass) {
      active = entry;
    }
  }
  return active.preyTags;
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

export function radiusForCreature(creatureId, mass) {
  const creature = getCreatureDefinition(creatureId);
  return creature.baseRadius * Math.pow(Math.max(0.1, mass / creature.baseMass), 0.43);
}

export function publicCreatureCatalog() {
  return {
    playable: PLAYABLE_CREATURE_IDS.map((id) => {
      const creature = getCreatureDefinition(id);
      return {
        id: creature.id,
        name: creature.name,
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
          visual: creature.visual,
          tags: creature.tags
        }
      ])
    ),
    food: FOOD_CATALOG,
    addons: ADDON_CATALOG
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
  if (!hasDietMatch) {
    return false;
  }

  const biteRatioBonus = bonuses.biteRatioBonus ?? 0;
  if (target.kind === "food") {
    return target.mass <= consumer.mass * (0.72 + biteRatioBonus);
  }

  const creature = getCreatureDefinition(consumer.creatureId);
  const requiredRatio = Math.max(1.04, creature.consumeRatio - biteRatioBonus);
  return consumer.mass >= target.mass * requiredRatio;
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

function sizeTagForMass(mass) {
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
