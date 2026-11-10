import { ADDON_CATALOG, creatureLabel, FOOD_CATALOG, scientificNameFor } from "/shared/creatureCatalog.js";
import { locationAt } from "/shared/geography.js";
import {
  addonValue,
  connectionStatus,
  deathBanner,
  deathDetail,
  deathTitle,
  depthValue,
  eventFeed,
  leaderboardList,
  locusRow,
  massValue,
  minimap,
  minimapRegion,
  minimapZone,
  regionValue,
  speciesLogButton,
  speciesLogPanel,
  stageValue,
  zoneValue
} from "./dom.js";
import { dangerPips, drawRouteChart, outlookFor, outlookPhrase, TIER_STYLES } from "./routeChart.js";
import {
  recordEatenSpecies,
  renderSpeciesLog,
  speciesLogDirty,
  updateSpeciesLogButton
} from "./speciesLog.js";
import { state } from "./state.js";
import { setText } from "./util.js";

// Bottom-centre event feed: a short stack of fading pills that everyone sees —
// joins, growth milestones, kills, disconnects — plus this player's own eats.
// This is where the reading eye rests, so all "what just happened" text lands
// here rather than floating out in the world.
const FEED_MAX = 5;

let lastEatTextAt = 0;

export function pushFeed(text, kind = "info", holdMs = 4000, subtext = null) {
  if (!text || !eventFeed) {
    return;
  }
  const item = document.createElement("div");
  item.className = `feed-item feed-${kind}`;
  item.append(document.createTextNode(text));
  if (subtext) {
    item.append(document.createTextNode(" "));
    const scientific = document.createElement("span");
    scientific.className = "eat-sci";
    scientific.textContent = subtext;
    item.append(scientific);
  }
  eventFeed.append(item);
  while (eventFeed.children.length > FEED_MAX) {
    eventFeed.firstChild.remove();
  }
  setTimeout(() => {
    item.classList.add("feed-out");
    setTimeout(() => item.remove(), 400);
  }, holdMs);
}

export function updateHud(snapshot) {
  const self = snapshot.self;
  if (self) {
    setText(massValue, self.mass.toLocaleString());
    setText(stageValue, self.stage);
    setText(addonValue, formatAddons(self));
    updateLocus(self);
    updateSpatialUi(self);
    deathBanner.hidden = self.alive !== false;
    if (self.alive === false) {
      deathTitle.textContent = "Consumed";
      deathDetail.textContent = self.lastEatenBy ? `Eaten by ${self.lastEatenBy}` : "Returning to the bloom";
    } else if (state.connected && !state.gamePaused) {
      // No constant "Swimming" — the event feed carries the interesting news.
      connectionStatus.textContent = state.mode === "offline" ? "Offline · solo" : "";
    }
  }
  // Delta snapshots only carry the board when it changed.
  if (snapshot.leaderboard) {
    renderLeaderboard(snapshot.leaderboard);
  }
  if (speciesLogPanel && !speciesLogPanel.hidden && speciesLogDirty) {
    renderSpeciesLog();
  }
}

// The ambient "where am I" line. Only rewritten when the region or zone label
// actually changes, so it stays a calm background detail rather than a ticker.
let lastLocusKey = "";
let lastLocusRegionId = "";
// Crossing into a sea or zone announces what it means for you — once per
// place per cooldown, so bobbing across a zone line doesn't spam the feed.
const TRANSITION_COOLDOWN_MS = 5000;
const lastTransitionAt = new Map();

function updateLocus(self) {
  if (self.alive === false) {
    return;
  }
  const { region, zone, depth } = locationAt(self.x, self.y);
  const key = `${region.id}|${zone.id}`;
  if (key === lastLocusKey) {
    depthValue.textContent = `${depth.toLocaleString()} m`;
    return;
  }
  const enteredSea = region.id !== lastLocusRegionId;
  lastLocusKey = key;
  lastLocusRegionId = region.id;
  announceTransition(self, region, zone, enteredSea);
  regionValue.textContent = region.name + dangerPips(region);
  zoneValue.textContent = zone.name;
  depthValue.textContent = `${depth.toLocaleString()} m`;
  locusRow.hidden = false;
}

let spatialShown = false;

let lastChartAt = 0;

// Location → route chart + its caption. The caption (where you are and what
// that means for you) updates with every snapshot; the chart redraws at
// ~10 Hz so it stays cheap on weak hardware.
function updateSpatialUi(self) {
  if (self.alive === false) {
    return;
  }
  if (!spatialShown) {
    spatialShown = true;
    if (minimap) minimap.hidden = false;
    if (speciesLogButton) {
      speciesLogButton.hidden = false;
      updateSpeciesLogButton();
    }
  }

  const { region, zone } = locationAt(self.x, self.y);
  setText(minimapRegion, `${region.name}${dangerPips(region)} · ${zone.name}`);
  const outlook = outlookFor(self, region.id, zone.id);
  if (outlook && minimapZone) {
    const style = TIER_STYLES[outlook.tier];
    setText(minimapZone, style.label);
    minimapZone.style.color = style.color;
  }

  const now = performance.now();
  if (now - lastChartAt > 100) {
    lastChartAt = now;
    drawRouteChart(self);
  }
}

function formatAddons(self) {
  // Shield add-ons are listed once, as their charge count.
  const names =
    self.addons
      ?.filter((addon) => !ADDON_CATALOG[addon.addonId]?.effects.shieldCharges)
      .map((addon) => ADDON_CATALOG[addon.addonId]?.name)
      .filter(Boolean) ?? [];
  if (self.shieldCharges > 0) {
    names.push(`Shield ${self.shieldCharges}`);
  }
  return names.length ? names.slice(0, 3).join(", ") : "None";
}

function announceTransition(self, region, zone, enteredSea) {
  const now = performance.now();
  const key = enteredSea ? region.id : `${region.id}|${zone.id}`;
  if (now - (lastTransitionAt.get(key) ?? -Infinity) < TRANSITION_COOLDOWN_MS) {
    return;
  }
  lastTransitionAt.set(key, now);
  const outlook = outlookFor(self, region.id, zone.id);
  const phrase = outlookPhrase(outlook);
  const place = enteredSea ? `Entering ${region.name}${dangerPips(region)}` : `Into the ${zone.name}`;
  const kind = outlook?.tier === "deadly" || outlook?.tier === "risky" ? "eaten" : "info";
  pushFeed(phrase ? `${place} — ${phrase}` : place, kind, 3600);
}

// The board changes slowly, so only rebuild its DOM when the entries actually
// change instead of 24×/second — cuts a lot of layout churn on weak hardware.
let lastLeaderboardSignature = "";

export function renderLeaderboard(leaderboard) {
  const signature = leaderboard.map((player) => `${player.name}:${player.score}:${player.online ? 1 : 0}`).join("|");
  if (signature === lastLeaderboardSignature) {
    return;
  }
  lastLeaderboardSignature = signature;
  leaderboardList.replaceChildren();
  for (let index = 0; index < leaderboard.length; index += 1) {
    const player = leaderboard[index];
    const item = document.createElement("li");
    if (player.online) {
      item.classList.add("is-online");
    }
    const rank = document.createElement("span");
    rank.textContent = String(index + 1);
    const name = document.createElement("span");
    name.className = "leader-name";
    name.textContent = player.name;
    const score = document.createElement("span");
    score.className = "leader-score";
    score.textContent = String(player.score);
    item.append(rank, name, score);
    leaderboardList.append(item);
  }
}

export function handleEvents(events) {
  for (const event of events) {
    const isSelf = event.playerId === state.playerId;
    if (event.type === "player_joined") {
      // Everyone but the joiner hears about a new arrival.
      if (!isSelf) {
        pushFeed(`${event.name} entered the deep`, "join", 5000);
      }
    } else if (event.type === "player_left") {
      pushFeed(`${event.name} left the deep`, "left", 4000);
    } else if (event.type === "player_grew") {
      pushFeed(isSelf ? `You grew to ${event.stage}` : `${event.name} grew to ${event.stage}`, "grow", 4500);
    } else if (event.type === "player_eaten") {
      if (event.victimId === state.playerId) {
        pushFeed(`You were eaten by ${event.predatorName}`, "eaten", 5000);
      } else {
        pushFeed(`${event.victimName} was eaten by ${event.predatorName}`, "eaten", 4500);
      }
    } else if (event.type === "shield_block" && isSelf) {
      pushFeed("Pearl shield cracked", "info", 2600);
    } else if (event.type === "collected_addon" && isSelf) {
      pushFeed(`${ADDON_CATALOG[event.addonId]?.name ?? "Add-on"} attached`, "info", 2600);
    } else if (event.type === "ate_creature" && isSelf) {
      // Rarer, meaningful eat: species label + scientific name, held longer.
      lastEatTextAt = performance.now();
      recordEatenSpecies(event.creatureId);
      pushFeed(`Ate ${creatureLabel(event.creatureId, event.mass)}`, "info", 2600, scientificNameFor(event.creatureId));
    } else if (event.type === "ate_food" && isSelf) {
      // Food is eaten constantly, so sample the stream sparingly and briefly so
      // it never crowds out joins, kills, and growth milestones.
      const now = performance.now();
      if (now - lastEatTextAt > 2000) {
        lastEatTextAt = now;
        pushFeed(`Ate ${FOOD_CATALOG[event.foodId]?.name ?? "food"}`, "info", 1200);
      }
    } else if (event.type === "apex_hunter" && isSelf) {
      // Your guaranteed bigger fish just slid into the neighbourhood.
      pushFeed(`Something vast stirs nearby: ${creatureLabel(event.creatureId, event.mass)}`, "eaten", 5200);
    } else if (event.type === "hazard_consumed") {
      pushFeed(
        isSelf ? `You devoured ${event.hazardName}!` : `${event.playerName} devoured ${event.hazardName}`,
        "grow",
        4000
      );
    }
  }
}

export function showToast(message) {
  pushFeed(message, "info", 2600);
}
