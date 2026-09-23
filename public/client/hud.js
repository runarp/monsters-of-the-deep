import { ADDON_CATALOG, creatureLabel, FOOD_CATALOG, scientificNameFor } from "/shared/creatureCatalog.js";
import { DEPTH_ZONES, locationAt } from "/shared/geography.js";
import {
  addonValue,
  connectionStatus,
  deathBanner,
  deathDetail,
  deathTitle,
  depthGauge,
  depthMarker,
  depthMarkerLabel,
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
import { dangerPips, drawGlobe } from "./globe.js";
import {
  recordEatenSpecies,
  renderSpeciesLog,
  speciesLogDirty,
  updateSpeciesLogButton
} from "./speciesLog.js";
import { state } from "./state.js";
import { clamp, setText } from "./util.js";

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
  lastLocusKey = key;
  regionValue.textContent = region.name + dangerPips(region);
  zoneValue.textContent = zone.name;
  depthValue.textContent = `${depth.toLocaleString()} m`;
  locusRow.hidden = false;
}

let depthGaugeBuilt = false;

let spatialShown = false;

let lastMinimapAt = 0;

// Build the vertical depth chart's zone bands + labels once.
function buildDepthGauge() {
  if (depthGaugeBuilt || !depthGauge) {
    return;
  }
  // Equal segments per zone (not scaled by real metres) so every label gets
  // room — the thin real surface zones would otherwise overlap. The marker
  // maps the true depth within its zone's segment, and its number carries the
  // real scale.
  const segment = 100 / DEPTH_ZONES.length;
  DEPTH_ZONES.forEach((zone, index) => {
    const band = document.createElement("div");
    band.className = "depth-zone";
    band.style.top = `${index * segment}%`;
    band.style.height = `${segment}%`;
    const label = document.createElement("span");
    label.textContent = zone.name;
    band.append(label);
    // Appended to the gauge (not the overflow-clipped track) so labels can sit
    // just outside the track. Inserted before the marker so it stays on top.
    depthGauge.insertBefore(band, depthMarker);
  });
  depthGaugeBuilt = true;
}

// Location → minimap, depth → vertical gauge. Depth marker moves every frame
// (one style write); the minimap redraws at ~6 Hz so it stays cheap on weak
// hardware.
function updateSpatialUi(self) {
  if (self.alive === false) {
    return;
  }
  buildDepthGauge();
  if (!spatialShown) {
    spatialShown = true;
    if (minimap) minimap.hidden = false;
    if (depthGauge) depthGauge.hidden = false;
    if (speciesLogButton) {
      speciesLogButton.hidden = false;
      updateSpeciesLogButton();
    }
  }

  const { region, zone, depth } = locationAt(self.x, self.y);
  if (depthMarker) {
    // Position within the zone's equal segment (see buildDepthGauge).
    const zoneIndex = Math.max(0, DEPTH_ZONES.indexOf(zone));
    const withinZone = clamp((depth - zone.min) / Math.max(1, zone.max - zone.min), 0, 1);
    depthMarker.style.top = `${((zoneIndex + withinZone) / DEPTH_ZONES.length) * 100}%`;
    setText(depthMarkerLabel, `${depth.toLocaleString()} m`);
  }
  setText(minimapRegion, region.name + dangerPips(region));
  setText(minimapZone, zone.name);

  const now = performance.now();
  if (now - lastMinimapAt > 160) {
    lastMinimapAt = now;
    drawGlobe(self.x);
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
