import {
  canConsume,
  CREATURE_CATALOG,
  creatureLabel,
  FOOD_CATALOG,
  HAZARD_CATALOG,
  scientificNameFor
} from "/shared/creatureCatalog.js";
import { selfCanEat } from "./creatures.js";
import { hoverTip } from "./dom.js";
import { getRenderedEntities } from "./entities.js";
import { worldToScreen } from "./render.js";
import { state, viewport } from "./state.js";

// Mouse-over inspector: the topmost thing under the cursor gets a tooltip with
// its name and any metadata we have (species life stage + size, creature type,
// hazard). Creatures win over food when overlapping — that's what you're
// pointing at. Touch input is ignored (no hover).
export function updateHoverTip() {
  if (!hoverTip) {
    return;
  }
  if (!state.pointer.isMouse || !state.joined || !state.snapshot) {
    hoverTip.hidden = true;
    return;
  }

  const cursorX = state.pointer.x;
  const cursorY = state.pointer.y;
  const hit = findHoveredEntity(cursorX, cursorY);
  if (!hit) {
    hoverTip.hidden = true;
    return;
  }

  const content = hoverTipContent(hit);
  hoverTip.replaceChildren();
  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = content.title;
  hoverTip.append(title);
  if (content.detail || content.scientific) {
    const detail = document.createElement("div");
    detail.className = "tip-detail";
    if (content.detail) {
      detail.append(document.createTextNode(content.detail));
    }
    if (content.scientific) {
      if (content.detail) {
        detail.append(document.createTextNode(" "));
      }
      const sci = document.createElement("span");
      sci.className = "tip-sci";
      sci.textContent = content.scientific;
      detail.append(sci);
    }
    hoverTip.append(detail);
  }

  // Position near the cursor, flipping away from the screen edges.
  hoverTip.hidden = false;
  const rect = hoverTip.getBoundingClientRect();
  let left = cursorX + 16;
  let top = cursorY + 16;
  if (left + rect.width > viewport.width - 8) {
    left = cursorX - rect.width - 16;
  }
  if (top + rect.height > viewport.height - 8) {
    top = cursorY - rect.height - 16;
  }
  hoverTip.style.left = `${Math.max(8, left)}px`;
  hoverTip.style.top = `${Math.max(8, top)}px`;
}

function findHoveredEntity(cursorX, cursorY) {
  const snapshot = state.snapshot;
  let best = null;
  let bestDistance = Infinity;
  const consider = (entity, kind, minRadius) => {
    const position = worldToScreen(entity.x, entity.y);
    const radius = Math.max(minRadius, entity.radius * state.camera.scale);
    const distance = Math.hypot(position.x - cursorX, position.y - cursorY);
    if (distance <= radius + 6 && distance < bestDistance) {
      bestDistance = distance;
      best = { entity, kind };
    }
  };

  // Creatures first so they win ties over the food they're eating.
  for (const npc of getRenderedEntities(snapshot.npcs)) {
    consider(npc, "npc", 12);
  }
  for (const player of getRenderedEntities(snapshot.players)) {
    consider(player, "player", 12);
  }
  if (best) {
    return best;
  }
  for (const hazard of snapshot.hazards ?? []) {
    consider(hazard, "hazard", 14);
  }
  if (best) {
    return best;
  }
  for (const food of getRenderedEntities(snapshot.food)) {
    consider(food, "food", 8);
  }
  return best;
}

// Hover verdict comparing a creature to you: relative mass plus the blunt
// answer the diet rules give — the thing relative size on screen can't show.
function relationDetail(entity) {
  const self = state.snapshot?.self;
  if (!self || self.alive === false || entity.id === self.id) {
    return null;
  }
  const ratio = entity.mass / Math.max(1, self.mass);
  let size;
  if (ratio >= 0.92 && ratio <= 1.08) {
    size = "about your mass";
  } else if (ratio >= 10) {
    size = `${Math.round(ratio).toLocaleString()}× your mass`;
  } else if (ratio >= 0.01) {
    size = `${ratio.toFixed(ratio >= 1 ? 1 : 2)}× your mass`;
  } else {
    size = "a speck next to you";
  }
  if (canConsume(entity, self)) {
    return `${size} · it can eat you`;
  }
  if (selfCanEat(self, entity)) {
    return `${size} · you can eat it`;
  }
  return `${size} · neither can eat the other`;
}

function hoverTipContent({ entity, kind }) {
  if (kind === "npc") {
    const definition = CREATURE_CATALOG[entity.creatureId];
    return {
      title: creatureLabel(entity.creatureId, entity.mass),
      detail: relationDetail(entity),
      scientific: definition?.speciesBuilt ? scientificNameFor(entity.creatureId) : null
    };
  }
  if (kind === "player") {
    const creatureName = CREATURE_CATALOG[entity.creatureId]?.name ?? "creature";
    const isSelf = entity.id === state.playerId;
    const verdict = isSelf ? null : relationDetail(entity);
    return {
      title: isSelf ? `${entity.name} (you)` : entity.name,
      detail: [`${creatureName} · ${entity.stage} · ${entity.mass.toLocaleString()}`, verdict]
        .filter(Boolean)
        .join(" · ")
    };
  }
  if (kind === "hazard") {
    const definition = HAZARD_CATALOG[entity.hazardType];
    return {
      title: entity.name ?? definition?.name ?? "Hazard",
      detail: definition?.summary ?? null
    };
  }
  const food = FOOD_CATALOG[entity.foodId];
  return { title: food?.name ?? "Food", detail: food?.tags?.join(", ") ?? null };
}
