import { CREATURE_CATALOG } from "/shared/creatureCatalog.js";
import { biomeOutlook } from "/shared/gameWorld.js";
import { DEPTH_ZONES, REGION_CELL_SIZE, REGIONS, depthFractionAtY, regionIndexAt } from "/shared/geography.js";
import { minimapCanvas, minimapCtx, regionTip } from "./dom.js";
import { state, viewport } from "./state.js";
import { colorWithAlpha } from "./util.js";

// The route chart: the ocean as it really is to travel through. Seas run left
// to right in voyage order (swimming right sails on to the next one, the loop
// wraps around the world), depth zones are rows, and every sea × depth cell is
// shaded by what it means for YOU right now — the same canConsume rules the
// simulation bites with (see biomeOutlook in gameWorld.js):
//   deadly / risky — that share of the local wildlife can eat you
//   rich / calm    — safe; rich = among the best meals anywhere for your size
// Hover (or tap) a cell for who lives there and why it rates that way.

const VIEW_SEAS = 2.4;
const CHART_WIDTH = 280;
const CHART_HEIGHT = 120;
const LABEL_BAND = 15;
const ZONE_GUTTER = 24;
const ZONE_SHORT = ["Sun", "Twi", "Mid", "Aby", "Had"];
// A safe cell is "rich" when its typical catch is worth at least this share
// of the best safe cell's — richness only means something next to the options.
const RICH_FRACTION = 0.7;
const RICH_MIN_PREY_SHARE = 0.3;

export const TIER_STYLES = Object.freeze({
  deadly: { color: "#fb7185", label: "Deadly for you" },
  risky: { color: "#fbbf24", label: "Risky for you" },
  rich: { color: "#4ade80", label: "Rich hunting" },
  calm: { color: "#5eead4", label: "Calm waters" }
});

// ── Outlooks ────────────────────────────────────────────────────────────────
// Every cell in the loop, rated for the current player. Recomputed only when
// the creature, bite bonus, or size bucket (~9% steps) changes: ~7 ms.
let outlookKey = "";
const outlooks = new Map();

function refreshOutlooks(self) {
  const key = `${self.creatureId}|${Math.round(Math.log2(Math.max(1, self.mass)) * 8)}|${self.biteRatioBonus ?? 0}`;
  if (key === outlookKey) {
    return;
  }
  outlookKey = key;
  outlooks.clear();
  const bonuses = { biteRatioBonus: self.biteRatioBonus ?? 0 };
  let bestMeal = 0;
  for (const region of REGIONS) {
    for (const zone of DEPTH_ZONES) {
      const outlook = biomeOutlook(self, region.id, zone.id, bonuses);
      outlooks.set(`${region.id}|${zone.id}`, outlook);
      if (outlook.verdict === "safe") {
        bestMeal = Math.max(bestMeal, outlook.mealValue);
      }
    }
  }
  for (const outlook of outlooks.values()) {
    outlook.richness = bestMeal > 0 ? outlook.mealValue / bestMeal : 0;
    if (outlook.verdict !== "safe") {
      outlook.tier = outlook.verdict;
    } else if (outlook.preyShare >= RICH_MIN_PREY_SHARE && outlook.richness >= RICH_FRACTION) {
      outlook.tier = "rich";
    } else {
      outlook.tier = "calm";
    }
  }
}

// The rated outlook for a sea × zone, or null before the player exists.
export function outlookFor(self, regionId, zoneId) {
  if (!self || self.alive === false) {
    return null;
  }
  refreshOutlooks(self);
  return outlooks.get(`${regionId}|${zoneId}`) ?? null;
}

function creatureName(id) {
  return CREATURE_CATALOG[id]?.name ?? id;
}

// One short clause for the event feed: "deadly: Blue Shark can eat you".
export function outlookPhrase(outlook) {
  if (!outlook) {
    return "";
  }
  if (outlook.tier === "deadly" || outlook.tier === "risky") {
    const culprit = outlook.threats[0] ? `${creatureName(outlook.threats[0])} can eat you` : "big predators";
    return `${outlook.tier}: ${culprit}`;
  }
  return outlook.tier === "rich" ? "rich hunting" : "calm waters";
}

// ── Drawing ─────────────────────────────────────────────────────────────────
let layout = null;

export function drawRouteChart(self) {
  if (!minimapCtx || !self || self.alive === false) {
    return;
  }
  refreshOutlooks(self);
  const dpr = viewport.dpr || 1;
  if (minimapCanvas.width !== CHART_WIDTH * dpr) {
    minimapCanvas.width = CHART_WIDTH * dpr;
    minimapCanvas.height = CHART_HEIGHT * dpr;
  }
  const context = minimapCtx;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

  const gridLeft = ZONE_GUTTER;
  const gridTop = LABEL_BAND;
  const gridWidth = CHART_WIDTH - gridLeft;
  const gridHeight = CHART_HEIGHT - gridTop;
  const span = REGION_CELL_SIZE * VIEW_SEAS;
  const worldLeft = self.x - span / 2;
  const scale = gridWidth / span;
  const rowHeight = gridHeight / DEPTH_ZONES.length;
  const toX = (worldX) => gridLeft + (worldX - worldLeft) * scale;
  layout = { gridLeft, gridTop, gridWidth, gridHeight, worldLeft, scale, rowHeight };

  const playerZone = Math.min(DEPTH_ZONES.length - 1, Math.floor(depthFractionAtY(self.y) * DEPTH_ZONES.length));
  const firstBand = Math.floor(worldLeft / REGION_CELL_SIZE);
  const lastBand = Math.floor((worldLeft + span) / REGION_CELL_SIZE);
  const playerBand = Math.floor(self.x / REGION_CELL_SIZE);

  for (let band = firstBand; band <= lastBand; band += 1) {
    const region = REGIONS[regionIndexAt(band * REGION_CELL_SIZE)];
    const x0 = Math.max(gridLeft, toX(band * REGION_CELL_SIZE));
    const x1 = Math.min(CHART_WIDTH, toX((band + 1) * REGION_CELL_SIZE));

    DEPTH_ZONES.forEach((zone, zoneIndex) => {
      const outlook = outlooks.get(`${region.id}|${zone.id}`);
      const style = TIER_STYLES[outlook.tier];
      const alpha =
        outlook.tier === "deadly" ? 0.5 : outlook.tier === "risky" ? 0.38 : outlook.tier === "rich" ? 0.22 + outlook.richness * 0.24 : 0.12;
      const y = gridTop + zoneIndex * rowHeight;
      context.fillStyle = colorWithAlpha(style.color, alpha);
      context.fillRect(x0, y + 0.5, x1 - x0, rowHeight - 1);
      if (band === playerBand && zoneIndex === playerZone) {
        context.strokeStyle = colorWithAlpha("#fde68a", 0.85);
        context.lineWidth = 1.5;
        context.strokeRect(x0 + 0.75, y + 1.25, x1 - x0 - 1.5, rowHeight - 2.5);
      }
    });

    // Sea name centred on its visible stretch, trimmed to fit.
    const name = region.name + dangerPips(region);
    context.font = band === playerBand ? "700 10px system-ui, sans-serif" : "600 10px system-ui, sans-serif";
    context.fillStyle = band === playerBand ? "#fde68a" : "rgba(223, 251, 255, 0.72)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const label = fitText(context, name, x1 - x0 - 6);
    if (label) {
      context.fillText(label, (x0 + x1) / 2, LABEL_BAND / 2 + 1);
    }
  }

  // Sea boundaries: the transitions you swim through.
  for (let band = firstBand + 1; band <= lastBand; band += 1) {
    const x = toX(band * REGION_CELL_SIZE);
    context.strokeStyle = "rgba(223, 251, 255, 0.75)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, 2);
    context.lineTo(x, CHART_HEIGHT);
    context.stroke();
  }

  // Depth rows.
  context.font = "600 9px system-ui, sans-serif";
  context.textAlign = "left";
  DEPTH_ZONES.forEach((zone, zoneIndex) => {
    const y = gridTop + (zoneIndex + 0.5) * rowHeight;
    context.fillStyle = zoneIndex === playerZone ? "#fde68a" : "rgba(223, 251, 255, 0.55)";
    context.fillText(ZONE_SHORT[zoneIndex] ?? zone.name.slice(0, 3), 2, y);
  });

  // You: centred horizontally at your true depth, with a heading tick.
  const px = toX(self.x);
  const py = gridTop + depthFractionAtY(self.y) * gridHeight;
  const heading = self.heading ?? 0;
  context.strokeStyle = "#fde68a";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(px, py);
  context.lineTo(px + Math.cos(heading) * 8, py + Math.sin(heading) * 8);
  context.stroke();
  context.beginPath();
  context.arc(px, py, 3.2, 0, Math.PI * 2);
  context.fillStyle = "#fde68a";
  context.fill();
  context.strokeStyle = "#02080c";
  context.lineWidth = 1;
  context.stroke();
}

function fitText(context, text, maxWidth) {
  if (maxWidth < 14) {
    return "";
  }
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.length > 1 ? `${trimmed.trimEnd()}…` : "";
}

// ── Hover / tap tip ─────────────────────────────────────────────────────────
let tipHideTimer = null;

export function showRouteTip(clientX, clientY, { autoHide = false } = {}) {
  const self = state.snapshot?.self;
  if (!regionTip || !minimapCanvas || !layout || !self || self.alive === false) {
    return;
  }
  const rect = minimapCanvas.getBoundingClientRect();
  const localX = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
  const localY = ((clientY - rect.top) / rect.height) * CHART_HEIGHT;
  if (localX < layout.gridLeft || localY < layout.gridTop) {
    hideRouteTip();
    return;
  }
  const worldX = layout.worldLeft + (localX - layout.gridLeft) / layout.scale;
  const band = Math.floor(worldX / REGION_CELL_SIZE);
  const zoneIndex = Math.min(DEPTH_ZONES.length - 1, Math.floor((localY - layout.gridTop) / layout.rowHeight));
  const region = REGIONS[regionIndexAt(band * REGION_CELL_SIZE)];
  const zone = DEPTH_ZONES[zoneIndex];
  const outlook = outlookFor(self, region.id, zone.id);
  if (!outlook) {
    return;
  }

  const style = TIER_STYLES[outlook.tier];
  regionTip.replaceChildren();
  addLine("tip-title", `${region.name}${dangerPips(region)} · ${zone.name}`);
  const verdict = addLine("tip-verdict", style.label);
  verdict.style.color = style.color;
  addLine("tip-detail", `${region.ocean} · ${dangerWord(region)}`);
  // A species on both lists is a life-stage story, not a contradiction: its
  // young are your prey while its grown adults can eat you.
  const both = new Set(outlook.prey.filter((id) => outlook.threats.includes(id)));
  const named = (id, stage) => (both.has(id) ? `${creatureName(id)} (${stage})` : creatureName(id));
  if (outlook.prey.length > 0) {
    addLine("tip-detail", `Prey: ${outlook.prey.map((id) => named(id, "young")).join(", ")}`);
  }
  if (outlook.threats.length > 0) {
    addLine("tip-detail tip-threat", `Can eat you: ${outlook.threats.map((id) => named(id, "adults")).join(", ")}`);
  }
  const why = whyLine(outlook);
  if (why) {
    addLine("tip-detail tip-why", why);
  }
  addLine("tip-detail tip-route", routeLine(band, zoneIndex, self));

  regionTip.hidden = false;
  const tipRect = regionTip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - tipRect.height - 10;
  if (left + tipRect.width > viewport.width - 8) {
    left = clientX - tipRect.width - 14;
  }
  if (top < 8) {
    top = clientY + 14;
  }
  regionTip.style.left = `${Math.max(8, left)}px`;
  regionTip.style.top = `${Math.max(8, top)}px`;

  clearTimeout(tipHideTimer);
  if (autoHide) {
    tipHideTimer = setTimeout(hideRouteTip, 3000);
  }
}

export function hideRouteTip() {
  clearTimeout(tipHideTimer);
  if (regionTip) {
    regionTip.hidden = true;
  }
}

function addLine(className, text) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  regionTip.append(line);
  return line;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

// Why the cell rates the way it does, in one line of plain facts.
function whyLine(outlook) {
  const parts = [];
  if (outlook.threatShare >= 0.05) {
    parts.push(`${percent(outlook.threatShare)} of what lives here can eat you`);
  }
  if (outlook.sizeFactor >= 1.1) {
    // Upsizing grows with depth × sea danger, so it never applies at the surface.
    const where = outlook.danger >= 2 ? "this deep in a wild sea" : "this deep";
    parts.push(`creatures run ~${outlook.sizeFactor.toFixed(1)}× bigger ${where}`);
  }
  if (outlook.tier === "rich" || outlook.tier === "calm") {
    if (outlook.preyShare > 0) {
      parts.push(`a catch is worth ~${percent(outlook.mealValue)} of your mass`);
    } else {
      parts.push("nothing here you can catch yet");
    }
  }
  return parts.length > 0 ? `Why: ${parts.join("; ")}` : "";
}

// How to get there from where you are.
function routeLine(band, zoneIndex, self) {
  const playerBand = Math.floor(self.x / REGION_CELL_SIZE);
  const playerZone = Math.min(DEPTH_ZONES.length - 1, Math.floor(depthFractionAtY(self.y) * DEPTH_ZONES.length));
  const seas = band - playerBand;
  const vertical = zoneIndex > playerZone ? "dive" : zoneIndex < playerZone ? "rise" : "";
  if (seas === 0) {
    return vertical ? `This sea — ${vertical} to get there` : "You are here";
  }
  const count = Math.abs(seas) === 1 ? "next sea" : `${Math.abs(seas)} seas`;
  const direction = seas > 0 ? `Swim right → ${count}` : `Swim left ← ${count}`;
  return vertical ? `${direction}, then ${vertical}` : direction;
}

function dangerWord(region) {
  const danger = region.danger ?? 1;
  // About the sea (how big its creatures run), not about you — the verdict
  // line above says what it means for you.
  return danger >= 3 ? "perilous waters" : danger === 2 ? "wild sea" : "gentle sea";
}

// Danger pips after a sea's name: nothing for calm seas, ⚠/⚠⚠ for waters that
// breed bigger creatures — readable long before you learn it the hard way.
export function dangerPips(region) {
  const danger = region.danger ?? 1;
  return danger > 1 ? ` ${"⚠".repeat(danger - 1)}` : "";
}
