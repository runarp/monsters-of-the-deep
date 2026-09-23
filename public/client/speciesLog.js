import { CREATURE_CATALOG, oversizeTier } from "/shared/creatureCatalog.js";
import { DEPTH_ZONES } from "/shared/geography.js";
import { speciesLogCount, speciesLogList, speciesLogPanel, speciesLogProgress } from "./dom.js";
import { pushFeed } from "./hud.js";
import { setText } from "./util.js";

// ── Species log ─────────────────────────────────────────────────────────────
// A personal field guide: every real species (and legacy creature) spotted or
// eaten is recorded to localStorage, with badges for Giant/Monster sightings.
// Discovery and achievements grant progress that isn't tied to score.
const SPECIES_LOG_KEY = "monstersOfTheDeep.speciesLog";

const SPOTTABLE_SPECIES = Object.values(CREATURE_CATALOG).filter((creature) => !creature.playable);

const SPECIES_ACHIEVEMENTS = [
  { count: 5, title: "Tidepool Observer" },
  { count: 12, title: "Reef Naturalist" },
  { count: 24, title: "Deep-Sea Chronicler" },
  { count: SPOTTABLE_SPECIES.length, title: "Master of the Bestiary" }
];

const speciesLog = loadSpeciesLog();

const sightedEntityIds = new Set();

export let speciesLogDirty = true;

let speciesLogSaveTimer = null;

function loadSpeciesLog() {
  try {
    const data = JSON.parse(window.localStorage.getItem(SPECIES_LOG_KEY));
    if (data && typeof data === "object" && data.species && typeof data.species === "object") {
      return { species: data.species, achievements: Array.isArray(data.achievements) ? data.achievements : [] };
    }
  } catch {
    // Corrupt or unavailable storage: start a fresh log.
  }
  return { species: {}, achievements: [] };
}

function scheduleSpeciesLogSave() {
  if (speciesLogSaveTimer) {
    return;
  }
  speciesLogSaveTimer = setTimeout(() => {
    speciesLogSaveTimer = null;
    try {
      window.localStorage.setItem(SPECIES_LOG_KEY, JSON.stringify(speciesLog));
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }, 1500);
}

export function recordSighting(entity) {
  if (entity.kind !== "npc" || sightedEntityIds.has(entity.id)) {
    return;
  }
  const definition = CREATURE_CATALOG[entity.creatureId];
  if (!definition || definition.playable) {
    return;
  }
  sightedEntityIds.add(entity.id);
  if (sightedEntityIds.size > 8000) {
    sightedEntityIds.clear();
  }

  let entry = speciesLog.species[entity.creatureId];
  const isNew = !entry;
  if (!entry) {
    entry = { count: 0, eaten: 0, maxMass: 0, firstAt: Date.now() };
    speciesLog.species[entity.creatureId] = entry;
  }
  entry.count += 1;
  entry.maxMass = Math.max(entry.maxMass ?? 0, entity.mass);

  const tier = oversizeTier(entity.creatureId, entity.mass);
  let firstOfTier = null;
  if (tier) {
    const flag = tier.prefix.toLowerCase();
    if (!entry[flag]) {
      entry[flag] = true;
      firstOfTier = tier;
    }
  }

  const name = definition.commonName ?? definition.name;
  if (isNew) {
    const rare = (definition.spawnWeight ?? 10) <= 3;
    pushFeed(
      `${rare ? "Rare species" : "New species"} spotted: ${name}`,
      rare ? "grow" : "spot",
      rare ? 5200 : 4200,
      definition.binomial ?? null
    );
    checkSpeciesAchievements();
  } else if (firstOfTier) {
    pushFeed(`Rare sighting: ${firstOfTier.prefix} ${name}!`, "grow", 5200);
  }
  speciesLogDirty = true;
  scheduleSpeciesLogSave();
  updateSpeciesLogButton();
}

export function recordEatenSpecies(creatureId) {
  const definition = CREATURE_CATALOG[creatureId];
  if (!definition || definition.playable) {
    return;
  }
  let entry = speciesLog.species[creatureId];
  if (!entry) {
    entry = { count: 1, eaten: 0, maxMass: 0, firstAt: Date.now() };
    speciesLog.species[creatureId] = entry;
  }
  entry.eaten = (entry.eaten ?? 0) + 1;
  speciesLogDirty = true;
  scheduleSpeciesLogSave();
}

function checkSpeciesAchievements() {
  const spotted = Object.keys(speciesLog.species).length;
  for (const achievement of SPECIES_ACHIEVEMENTS) {
    if (spotted >= achievement.count && !speciesLog.achievements.includes(achievement.title)) {
      speciesLog.achievements.push(achievement.title);
      pushFeed(`Achievement: ${achievement.title} — ${achievement.count} species spotted`, "grow", 6200);
    }
  }
}

export function updateSpeciesLogButton() {
  if (speciesLogCount) {
    setText(speciesLogCount, `${Object.keys(speciesLog.species).length}/${SPOTTABLE_SPECIES.length}`);
  }
}

export function toggleSpeciesLog() {
  if (!speciesLogPanel) {
    return;
  }
  speciesLogPanel.hidden = !speciesLogPanel.hidden;
  if (!speciesLogPanel.hidden) {
    renderSpeciesLog();
  }
}

function zoneHintFor(creature) {
  const zones = creature.zones ?? [];
  if (zones.length === 0) {
    return "roams the open ocean";
  }
  const names = zones
    .map((zoneId) => DEPTH_ZONES.find((zone) => zone.id === zoneId)?.name)
    .filter(Boolean);
  return names.length ? `lives in the ${names.join(" / ")}` : "roams the open ocean";
}

export function renderSpeciesLog() {
  if (!speciesLogList || !speciesLogProgress) {
    return;
  }
  speciesLogDirty = false;
  const byName = (a, b) => (a.commonName ?? a.name).localeCompare(b.commonName ?? b.name);
  const spotted = SPOTTABLE_SPECIES.filter((creature) => speciesLog.species[creature.id]).sort(byName);
  const unseen = SPOTTABLE_SPECIES.filter((creature) => !speciesLog.species[creature.id]).sort(byName);

  const latestAchievement = speciesLog.achievements.at(-1);
  speciesLogProgress.textContent =
    `${spotted.length} / ${SPOTTABLE_SPECIES.length} species spotted` +
    (latestAchievement ? ` · ${latestAchievement}` : "");

  speciesLogList.replaceChildren();
  for (const creature of spotted) {
    const entry = speciesLog.species[creature.id];
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = creature.commonName ?? creature.name;
    item.append(title);
    if (entry.monster || entry.giant) {
      const badge = document.createElement("span");
      badge.className = `log-badge${entry.monster ? " log-badge-monster" : ""}`;
      badge.textContent = entry.monster ? "Monster" : "Giant";
      item.append(badge);
    }
    const detail = document.createElement("span");
    detail.className = "log-detail";
    const bits = [];
    if (creature.binomial) {
      bits.push(creature.binomial);
    }
    bits.push(`spotted ×${entry.count}`);
    if (entry.eaten) {
      bits.push(`eaten ×${entry.eaten}`);
    }
    detail.textContent = bits.join(" · ");
    item.append(detail);
    speciesLogList.append(item);
  }
  for (const creature of unseen) {
    const item = document.createElement("li");
    item.className = "log-unknown";
    const title = document.createElement("strong");
    title.textContent = "???";
    const detail = document.createElement("span");
    detail.className = "log-detail";
    detail.textContent = zoneHintFor(creature);
    item.append(title, detail);
    speciesLogList.append(item);
  }
}
