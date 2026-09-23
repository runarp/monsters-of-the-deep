import { ADDON_CATALOG, FOOD_CATALOG, HAZARD_CATALOG } from "/shared/creatureCatalog.js";
import { locationAt } from "/shared/geography.js";
import { drawCreature, resetNpcLabelBudget } from "./creatures.js";
import { canvas, ctx } from "./dom.js";
import { getRenderedEntities, getRenderedEntity, updateRenderEntities } from "./entities.js";
import { updateHoverTip } from "./hover.js";
import { transportSend } from "./network.js";
import { netDebug, state, viewport } from "./state.js";
import { clamp, clamp01, colorWithAlpha, wrap } from "./util.js";

const particles = Array.from({ length: 170 }, (_, index) => ({
  x: Math.random(),
  y: Math.random(),
  radius: 0.7 + Math.random() * 2.4,
  depth: 0.12 + Math.random() * 0.88,
  drift: 0.08 + Math.random() * 0.24,
  color: index % 9 === 0 ? "#f7d794" : index % 5 === 0 ? "#fda4af" : "#9ff7eb"
}));

let lastFrame = performance.now();

export function resize() {
  viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  canvas.width = Math.floor(viewport.width * viewport.dpr);
  canvas.height = Math.floor(viewport.height * viewport.dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

export function frame(now) {
  const dt = Math.min(48, now - lastFrame) / 1000;
  lastFrame = now;
  render(now, dt);
  requestAnimationFrame(frame);
}

function render(now, dt) {
  updateRenderEntities(dt, now);
  resetNpcLabelBudget();
  const self =
    state.snapshot?.self?.alive === false
      ? state.snapshot.self
      : getRenderedEntity(state.snapshot?.self) ?? state.snapshot?.self;
  updateCamera(self, dt);

  ctx.clearRect(0, 0, viewport.width, viewport.height);
  drawOcean(now);

  if (state.snapshot) {
    drawWorldBoundary();
    // Hazards are smoothed like creatures so a feeding maelstrom's radius
    // grows instead of popping at snapshot rate.
    for (const hazard of getRenderedEntities(state.snapshot.hazards ?? [])) {
      drawHazard(hazard, now);
    }
    for (const food of getRenderedEntities(state.snapshot.food)) {
      drawFood(food, now);
    }
    for (const addon of getRenderedEntities(state.snapshot.addons)) {
      drawAddonPickup(addon, now);
    }

    const creatures = [...getRenderedEntities(state.snapshot.npcs), ...getRenderedEntities(state.snapshot.players)]
      .filter((entity) => entity.alive !== false)
      .sort((a, b) => a.radius - b.radius);

    for (const creature of creatures) {
      drawCreature(creature, now, creature.id === state.playerId);
    }
  }

  updateHoverTip();

  if (!state.joined) {
    drawMenuBackdrop(now);
  }

  if (netDebug.enabled) {
    drawNetDebug(now, dt);
  }
}

// Diagnostics overlay (backquote or ?debug): everything needed to tell
// network jitter from render jitter at a glance, plus console warnings on
// hard snaps.
function drawNetDebug(now, dt) {
  netDebug.fps += (1 / Math.max(dt, 0.001) - netDebug.fps) * 0.05;
  if (state.mode !== "offline" && state.connected && now - netDebug.lastPingAt > 2000) {
    netDebug.lastPingAt = now;
    netDebug.pingSentAt = now;
    transportSend({ type: "ping" });
  }

  const gaps = netDebug.intervals;
  const avg = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
  const min = gaps.length ? Math.min(...gaps) : 0;
  const max = gaps.length ? Math.max(...gaps) : 0;
  const age = netDebug.lastSnapshotAt ? now - netDebug.lastSnapshotAt : 0;
  const snapshot = state.snapshot;
  const self = snapshot?.self;
  const lines = [
    `mode ${state.mode}${state.connected ? "" : " (disconnected)"} · fps ${Math.round(netDebug.fps)}`,
    `snapshots ${netDebug.snapshotCount} · ${avg ? (1000 / avg).toFixed(1) : "–"}/s · age ${Math.round(age)} ms`,
    `gap avg ${Math.round(avg)} · min ${Math.round(min)} · max ${Math.round(max)} ms · jitter ${Math.round(max - min)} ms`,
    `ping ${netDebug.pingMs === null ? "–" : `${Math.round(netDebug.pingMs)} ms`}`,
    `entities ${state.renderEntities.size} cached · npc ${snapshot?.npcs?.length ?? 0} · food ${snapshot?.food?.length ?? 0} · haz ${snapshot?.hazards?.length ?? 0}`,
    `hard snaps ${netDebug.hardSnaps}${netDebug.lastHardSnap ? ` (last ${netDebug.lastHardSnap})` : ""}`
  ];
  if (self) {
    const { region, zone, depth } = locationAt(self.x, self.y);
    lines.push(`self ${Math.round(self.x)}, ${Math.round(self.y)} · mass ${self.mass}`);
    lines.push(`${region.name} (danger ${region.danger ?? 1}) · ${zone.name} · ${depth} m`);
  }

  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lineHeight = 15;
  const pad = 8;
  const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + pad * 2;
  const top = 172;
  ctx.fillStyle = "rgba(2, 8, 12, 0.72)";
  ctx.fillRect(12, top, boxWidth, lines.length * lineHeight + pad * 2);
  ctx.fillStyle = "#9ff7eb";
  lines.forEach((line, index) => {
    ctx.fillText(line, 12 + pad, top + pad + index * lineHeight);
  });
  ctx.restore();
}

function updateCamera(self, dt) {
  if (self && self.alive) {
    state.camera.x += (self.x - state.camera.x) * clamp01(dt * 7.8);
    state.camera.y += (self.y - state.camera.y) * clamp01(dt * 7.8);
    let targetScale = 1.12 - Math.log10(Math.max(1, self.mass / 12)) * 0.24;
    if (targetScale < 0.36) {
      // Past mid-game the camera zooms out more slowly than the creature
      // grows, so a true giant visibly overflows the screen — scale you can
      // feel, not just a number. The floor sits below the compressed curve's
      // value at the 20M mass cap (~0.054): the old 0.14 floor stopped the
      // zoom-out around 2M mass and let the body swallow the whole screen.
      targetScale = 0.36 - (0.36 - targetScale) * (0.1 / 0.24);
    }
    targetScale = clamp(clamp(targetScale, 0.045, 1.08) * state.camera.userZoom, 0.03, 1.6);
    state.camera.scale += (targetScale - state.camera.scale) * clamp01(dt * 5.5);
  }
}

function drawOcean(now) {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
  gradient.addColorStop(0, "#031b23");
  gradient.addColorStop(0.48, "#021018");
  gradient.addColorStop(1, "#000407");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#6bd7d1";
  ctx.lineWidth = 1;
  for (let row = -1; row < 12; row += 1) {
    const y = ((row * 92 + now * 0.012 - state.camera.y * 0.018) % (viewport.height + 160)) - 80;
    ctx.beginPath();
    for (let x = -80; x <= viewport.width + 80; x += 32) {
      const wave = Math.sin(x * 0.021 + now * 0.0011 + row) * 9;
      if (x === -80) {
        ctx.moveTo(x, y + wave);
      } else {
        ctx.lineTo(x, y + wave);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  for (const particle of particles) {
    const x = wrap(
      particle.x * viewport.width + now * particle.drift * 0.05 - state.camera.x * particle.depth * 0.025,
      viewport.width
    );
    const y = wrap(
      particle.y * viewport.height + now * particle.drift * 0.03 - state.camera.y * particle.depth * 0.025,
      viewport.height
    );
    ctx.globalAlpha = 0.14 + particle.depth * 0.26;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, particle.radius * particle.depth, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMenuBackdrop(now) {
  const centerX = viewport.width * 0.5;
  const centerY = viewport.height * 0.52;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.translate(centerX, centerY);
  ctx.rotate(Math.sin(now * 0.0002) * 0.12);
  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 3;
  for (let index = 0; index < 7; index += 1) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 190 + index * 58, 74 + index * 22, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorldBoundary() {
  if (state.world.endless || !Number.isFinite(state.world.radius)) {
    return;
  }
  const center = worldToScreen(0, 0);
  const radius = state.world.radius * state.camera.scale;
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFood(food, now) {
  const definition = FOOD_CATALOG[food.foodId] ?? FOOD_CATALOG.plankton;
  const position = worldToScreen(food.x, food.y);
  const radius = Math.max(2.5, food.radius * state.camera.scale);
  if (!isOnScreen(position, radius + 20)) {
    return;
  }

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = definition.color;
  ctx.strokeStyle = definition.glow;
  ctx.lineWidth = Math.max(1, radius * 0.14);

  if (food.foodId === "moon_jelly") {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.1, radius * 0.78, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    for (let index = -2; index <= 2; index += 1) {
      ctx.beginPath();
      ctx.moveTo(index * radius * 0.27, radius * 0.1);
      ctx.quadraticCurveTo(index * radius * 0.18, radius * 0.8, Math.sin(now * 0.003 + index) * radius * 0.25, radius * 1.38);
      ctx.stroke();
    }
  } else if (food.foodId === "coral_crab") {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.05, radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.7, -radius * 0.1);
    ctx.lineTo(-radius * 1.35, -radius * 0.45);
    ctx.moveTo(radius * 0.7, -radius * 0.1);
    ctx.lineTo(radius * 1.35, -radius * 0.45);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.4, radius * 0.72, Math.sin(now * 0.002 + food.x) * 0.4, 0, Math.PI * 2);
    ctx.fill();
    if (radius > 4) {
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHazard(hazard, now) {
  const definition = HAZARD_CATALOG[hazard.hazardType];
  if (!definition) {
    return;
  }
  const position = worldToScreen(hazard.x, hazard.y);
  const radius = Math.max(6, hazard.radius * state.camera.scale);
  if (!isOnScreen(position, radius + 40)) {
    return;
  }

  ctx.save();
  ctx.translate(position.x, position.y);

  if (hazard.hazardType === "maelstrom") {
    // A fed vortex spins faster, darker, and with more arms; a ground-down one
    // visibly weakens — the tug of war reads at a glance.
    const fedRatio = clamp((hazard.mass ?? definition.baseMass) / (definition.baseMass || 1), 0.2, 12);
    const armCount = Math.round(clamp(3 + Math.log2(fedRatio) * 1.6, 3, 9));
    ctx.rotate(now * 0.0006 * clamp(0.7 + fedRatio * 0.24, 0.7, 2.6) + (hazard.heading ?? 0));
    ctx.strokeStyle = colorWithAlpha(definition.accent, clamp(0.34 + fedRatio * 0.09, 0.34, 0.85));
    ctx.lineWidth = Math.max(2, radius * 0.05);
    for (let arm = 0; arm < armCount; arm += 1) {
      const startAngle = arm * ((Math.PI * 2) / armCount);
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.08) {
        const angle = startAngle + t * 3.2;
        const armRadius = radius * t;
        const x = Math.cos(angle) * armRadius;
        const y = Math.sin(angle) * armRadius;
        if (t === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(0, 0, 1, 0, 0, radius);
    core.addColorStop(0, colorWithAlpha("#02080c", 0.88));
    core.addColorStop(0.5, colorWithAlpha(definition.accent, 0.22));
    core.addColorStop(1, colorWithAlpha(definition.color, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(definition.color, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = colorWithAlpha(definition.accent, 0.12);
    ctx.strokeStyle = colorWithAlpha(definition.color, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const step = Math.max(10, radius * 0.18);
    for (let offset = -radius; offset <= radius; offset += step) {
      const half = Math.sqrt(Math.max(0, radius * radius - offset * offset));
      ctx.moveTo(offset, -half);
      ctx.lineTo(offset, half);
      ctx.moveTo(-half, offset);
      ctx.lineTo(half, offset);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawAddonPickup(addon, now) {
  const definition = ADDON_CATALOG[addon.addonId] ?? ADDON_CATALOG.tide_ribbon;
  const position = worldToScreen(addon.x, addon.y);
  const radius = Math.max(8, addon.radius * state.camera.scale);
  if (!isOnScreen(position, radius + 20)) {
    return;
  }

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(now * 0.0015 + addon.heading);
  ctx.strokeStyle = definition.color;
  ctx.fillStyle = colorWithAlpha(definition.color, 0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius * 0.75, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius * 0.75, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function worldToScreen(x, y) {
  return {
    x: (x - state.camera.x) * state.camera.scale + viewport.width / 2,
    y: (y - state.camera.y) * state.camera.scale + viewport.height / 2
  };
}

export function isOnScreen(position, margin) {
  return position.x > -margin && position.x < viewport.width + margin && position.y > -margin && position.y < viewport.height + margin;
}
