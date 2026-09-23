import {
  ADDON_CATALOG,
  canConsume,
  CREATURE_CATALOG,
  creatureLabel,
  oversizeTier
} from "/shared/creatureCatalog.js";
import { ctx } from "./dom.js";
import { isOnScreen, worldToScreen } from "./render.js";
import { state } from "./state.js";
import { blend, colorWithAlpha, hashString, roundRect } from "./util.js";

// How another creature relates to the local player, using the same diet rules
// the simulation eats with: "threat" (it can eat you — always flagged),
// "prey"/"standoff" (only for creatures big enough that relative size alone is
// ambiguous; flagging every edible minnow would wallpaper the screen). Null
// means no cue is drawn.
// Cap species labels per frame so the screen never becomes a wall of text —
// the nearest/biggest creatures win the plates (creatures are drawn small→large).
const NPC_LABELS_PER_FRAME = 14;
let npcLabelBudget = 0;

export function resetNpcLabelBudget() {
  npcLabelBudget = NPC_LABELS_PER_FRAME;
}

function threatRelation(entity) {
  const self = state.snapshot?.self;
  if (!self || self.alive === false || entity.id === self.id) {
    return null;
  }
  if (canConsume(entity, self)) {
    return "threat";
  }
  if (entity.radius < self.radius * 0.5) {
    return null;
  }
  return selfCanEat(self, entity) ? "prey" : "standoff";
}

// Mirrors the simulation's bite check, including add-on and trait bite
// bonuses the server reports on `self`.
export function selfCanEat(self, entity) {
  return canConsume(self, entity, { biteRatioBonus: self.biteRatioBonus ?? 0 });
}

const RELATION_RING_STYLES = {
  threat: "rgba(251, 113, 133, 0.6)",
  prey: "rgba(94, 234, 158, 0.42)",
  standoff: "rgba(250, 204, 21, 0.3)"
};

// A quiet dashed ring answering the question relative size can't: can I eat it
// (green), can it eat me (red, pulsing), or is it a standoff (faint amber)?
function drawRelationRing(position, radius, relation, now) {
  ctx.save();
  ctx.strokeStyle = RELATION_RING_STYLES[relation];
  ctx.lineWidth = Math.max(1.5, radius * 0.045);
  ctx.setLineDash([7, 9]);
  if (relation === "threat") {
    ctx.lineDashOffset = -now * 0.02;
    ctx.globalAlpha = 0.72 + Math.sin(now * 0.006) * 0.28;
  }
  ctx.beginPath();
  ctx.arc(position.x, position.y, radius * 1.16 + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawCreature(entity, now, isSelf) {
  const definition = CREATURE_CATALOG[entity.creatureId] ?? CREATURE_CATALOG.abyssal_serpent;
  const position = worldToScreen(entity.x, entity.y);
  const radius = Math.max(5, entity.radius * state.camera.scale);
  if (!isOnScreen(position, radius + 80)) {
    return;
  }

  const relation = isSelf ? null : threatRelation(entity);
  if (relation) {
    drawRelationRing(position, radius, relation, now);
  }

  drawAttachedAddons(entity, now, position, radius);

  const animation = creatureAnimation(entity, now, radius, definition.visual);
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(entity.heading + animation.turn);
  ctx.translate(0, animation.bob);
  ctx.scale(animation.scaleX, animation.scaleY);

  if (drawSpriteCreature(radius, definition.visual, animation.phase, entity.swim ?? 0)) {
    // Sprite asset rendered.
  } else if (definition.visual.shape === "serpent") {
    drawSerpent(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "kraken") {
    drawKraken(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "ray") {
    drawRay(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "maw") {
    drawMaw(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "angler") {
    drawAngler(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "shark") {
    drawShark(radius, definition.visual, animation.phase);
  } else if (definition.visual.shape === "whale") {
    drawWhale(radius, definition.visual, animation.phase);
  } else {
    drawFish(radius, definition.visual, animation.phase);
  }

  ctx.restore();
  if (entity.kind === "player") {
    drawNameplate(entity.name, position, radius * (definition.visual.animationSprite?.scale ?? 1), { self: isSelf });
  } else if (
    entity.kind === "npc" &&
    (definition.speciesBuilt || oversizeTier(entity.creatureId, entity.mass)) &&
    radius >= 17 &&
    npcLabelBudget > 0
  ) {
    // Quiet, real-species label on the creatures big enough to matter — the
    // thing chasing or fleeing you, never the whole tank. Oversized legacy
    // creatures get one too: a "Giant Blue Whale" should announce itself.
    npcLabelBudget -= 1;
    drawNameplate(creatureLabel(entity.creatureId, entity.mass), position, radius, { quiet: true, relation });
  }
}

function creatureAnimation(entity, now, radius, visual = {}) {
  const phase = now * 0.0034 + hashString(`${entity.kind}:${entity.id}`) * 0.013;
  const usesSpriteFrames = Boolean(visual.animationSprite);
  return {
    phase,
    turn: Math.sin(phase * 0.8) * (usesSpriteFrames ? 0.006 : 0.035),
    bob: Math.sin(phase * 1.45) * radius * 0.035,
    scaleX: usesSpriteFrames ? 1 : 1 + Math.sin(phase * 1.15) * 0.024,
    scaleY: usesSpriteFrames ? 1 : 1 + Math.cos(phase * 1.1) * 0.032
  };
}

// Offscreen-baked sprite frames: tinted per species and feathered into the
// water with a soft elliptical fade, so the square atlas photos read as
// creatures rather than clipped picture ovals.
const bakedSprites = new Map();

function getBakedSprite(sprite, frameIndex = sprite.index ?? 0) {
  const image = getSpriteImage(sprite);
  if (!sprite || !image?.complete || image.naturalWidth === 0) {
    return null;
  }

  const tintKey = sprite.tint ? `${sprite.tint.color}@${sprite.tint.alpha}` : "none";
  const key = `${sprite.src}|${frameIndex}|${tintKey}`;
  const existing = bakedSprites.get(key);
  if (existing) {
    return existing;
  }

  const source = spriteSourceRect(sprite, image, frameIndex);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width));
  canvas.height = Math.max(1, Math.round(source.height));
  const context = canvas.getContext("2d");
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);

  if (sprite.tint) {
    // "color" blend keeps the photo's luminance but shifts it toward the
    // species color — differentiates NPCs that share a frame with players.
    context.globalCompositeOperation = "color";
    context.fillStyle = colorWithAlpha(sprite.tint.color, sprite.tint.alpha);
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.globalCompositeOperation = "destination-in";
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(canvas.width / 2, canvas.height / 2);
  const fade = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(0.68, "rgba(0, 0, 0, 1)");
  fade.addColorStop(0.9, "rgba(0, 0, 0, 0.5)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = fade;
  context.fillRect(-1, -1, 2, 2);
  context.restore();
  context.globalCompositeOperation = "source-over";

  bakedSprites.set(key, canvas);
  return canvas;
}

function drawSpriteCreature(radius, visual, phase = 0, swim = 0) {
  const sprite = visual.animationSprite ?? visual.sprite;
  if (!sprite) {
    return false;
  }
  const baked = getBakedSprite(sprite, spriteFrameIndex(sprite, phase));
  if (!baked) {
    return false;
  }

  const destination = spriteDestination(visual.shape, radius);
  const spriteScale = sprite.scale ?? 1;
  const width = destination.width * spriteScale;
  const height = destination.height * spriteScale;

  if (visual.shape === "kraken") {
    // Radial bodies breathe and sway rather than undulate.
    const breathe = 1 + Math.sin(phase * 1.9) * (0.03 + swim * 0.035);
    ctx.save();
    ctx.rotate(Math.sin(phase * 1.1) * (0.04 + swim * 0.06));
    ctx.scale(breathe, 2 - breathe);
    ctx.drawImage(baked, -width / 2, -height / 2, width, height);
    ctx.restore();
    return true;
  }

  // Elongated bodies swim with a traveling wave: the sprite is drawn in
  // vertical strips whose offsets ripple from head to tail, with the tail
  // swinging widest — the harder the creature swims, the stronger the wave.
  const strips = 14;
  const stripWidth = width / strips;
  const sourceStripWidth = baked.width / strips;
  const amplitude = height * (0.028 + Math.min(0.085, swim * 0.075));
  for (let index = 0; index < strips; index += 1) {
    const t = index / (strips - 1);
    const tailness = Math.pow(1 - t, 1.5);
    const offset = Math.sin(phase * 2.2 - t * 4.6) * amplitude * (0.16 + tailness);
    ctx.drawImage(
      baked,
      index * sourceStripWidth,
      0,
      sourceStripWidth,
      baked.height,
      -width / 2 + index * stripWidth - 0.5,
      -height / 2 + offset,
      stripWidth + 1,
      height
    );
  }
  return true;
}

function spriteDestination(shape, radius) {
  if (shape === "kraken") {
    return { width: radius * 3.25, height: radius * 3.05 };
  }
  if (shape === "ray") {
    return { width: radius * 4.25, height: radius * 2.2 };
  }
  if (shape === "whale" || shape === "maw" || shape === "angler") {
    return { width: radius * 4.15, height: radius * 2.35 };
  }
  if (shape === "serpent") {
    return { width: radius * 4.65, height: radius * 2.4 };
  }
  return { width: radius * 3.8, height: radius * 2.15 };
}

export function getSpriteImage(sprite, onLoad) {
  if (!sprite?.src) {
    return null;
  }

  let image = state.assetImages.get(sprite.src);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = sprite.src;
    if (onLoad) {
      image.addEventListener("load", onLoad, { once: true });
    }
    state.assetImages.set(sprite.src, image);
  } else if (onLoad && !image.complete) {
    image.addEventListener("load", onLoad, { once: true });
  }
  return image;
}

function spriteFrameIndex(sprite, phase) {
  if (sprite.index !== undefined) {
    return sprite.index;
  }
  const frameCount = Math.max(1, (sprite.columns ?? 1) * (sprite.rows ?? 1));
  const frameRate = sprite.frameRate ?? 2.4;
  return Math.floor(phase * frameRate) % frameCount;
}

export function spriteSourceRect(sprite, image, sourceIndex = sprite.index ?? 0) {
  const columns = sprite.columns ?? 1;
  const rows = sprite.rows ?? 1;
  const index = sourceIndex;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const tileWidth = image.naturalWidth / columns;
  const tileHeight = image.naturalHeight / rows;
  const inset = Math.max(2, Math.min(tileWidth, tileHeight) * 0.01);
  return {
    x: column * tileWidth + inset,
    y: row * tileHeight + inset,
    width: tileWidth - inset * 2,
    height: tileHeight - inset * 2
  };
}

function drawFish(radius, visual, phase = 0) {
  const tailSwing = Math.sin(phase * 2.2) * radius * 0.22;
  const gradient = ctx.createLinearGradient(-radius * 1.6, 0, radius * 1.45, 0);
  gradient.addColorStop(0, visual.accent);
  gradient.addColorStop(0.28, visual.body);
  gradient.addColorStop(1, visual.belly);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = colorWithAlpha(visual.accent, 0.65);
  ctx.lineWidth = Math.max(1, radius * 0.06);

  ctx.beginPath();
  ctx.moveTo(-radius * 1.55, 0);
  ctx.lineTo(-radius * 2.25, -radius * 0.65 + tailSwing);
  ctx.lineTo(-radius * 2.05, tailSwing * 0.35);
  ctx.lineTo(-radius * 2.25, radius * 0.65 + tailSwing);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.7, radius * 0.72, Math.sin(phase) * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawFin(radius, visual.accent, phase);
  drawEye(radius, visual.eye);
}

function drawSerpent(radius, visual, phase = 0) {
  for (let index = 6; index >= 0; index -= 1) {
    const segmentRadius = radius * (0.42 + (6 - index) * 0.08);
    const x = -radius * 0.48 * index;
    const y = Math.sin(index * 0.9 + phase * 1.35) * radius * 0.18;
    ctx.fillStyle = index % 2 === 0 ? visual.body : blend(visual.body, visual.belly, 0.28);
    ctx.beginPath();
    ctx.ellipse(x, y, segmentRadius * 1.15, segmentRadius * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = visual.body;
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.06);
  ctx.beginPath();
  ctx.ellipse(radius * 0.42, 0, radius * 1.12, radius * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  for (let index = -1; index <= 1; index += 2) {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.15, index * radius * 0.42);
    ctx.lineTo(-radius * 0.7, index * radius * 0.95);
    ctx.lineTo(radius * 0.18, index * radius * 0.52);
    ctx.closePath();
    ctx.fillStyle = visual.accent;
    ctx.fill();
  }
  drawEye(radius, visual.eye);
}

function drawKraken(radius, visual, phase = 0) {
  ctx.strokeStyle = colorWithAlpha(visual.accent, 0.85);
  ctx.lineWidth = Math.max(2, radius * 0.08);
  for (let index = -3; index <= 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.45, index * radius * 0.15);
    ctx.quadraticCurveTo(
      -radius * 1.2,
      index * radius * 0.38,
      -radius * 1.7,
      index * radius * 0.22 + Math.sin(index + phase * 1.6) * radius * 0.24
    );
    ctx.stroke();
  }

  const gradient = ctx.createRadialGradient(radius * 0.25, -radius * 0.18, radius * 0.1, 0, 0, radius * 1.1);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.55, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.4));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(radius * 0.18, 0, radius * 0.95, radius * 1.08, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPatternSpots(radius, visual.accent);
  drawEye(radius * 0.9, visual.eye);
}

function drawRay(radius, visual, phase = 0) {
  const flap = Math.sin(phase * 1.5) * radius * 0.14;
  const gradient = ctx.createRadialGradient(radius * 0.25, 0, radius * 0.1, 0, 0, radius * 1.8);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.42, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.3));
  ctx.fillStyle = gradient;
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.045);
  ctx.beginPath();
  ctx.moveTo(radius * 1.35, 0);
  ctx.bezierCurveTo(radius * 0.45, -radius * 1.15 - flap, -radius * 1.2, -radius * 0.95 - flap, -radius * 1.6, 0);
  ctx.bezierCurveTo(-radius * 1.2, radius * 0.95 + flap, radius * 0.45, radius * 1.15 + flap, radius * 1.35, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radius * 1.22, 0);
  ctx.lineTo(-radius * 2.4, -flap * 0.45);
  ctx.stroke();
  drawEye(radius * 0.82, visual.eye);
}

function drawShark(radius, visual, phase = 0) {
  drawFish(radius, visual, phase);
  ctx.fillStyle = blend(visual.body, "#02080c", 0.35);
  ctx.beginPath();
  ctx.moveTo(-radius * 0.1, -radius * 0.62);
  ctx.lineTo(-radius * 0.55, -radius * 1.35);
  ctx.lineTo(radius * 0.35, -radius * 0.58);
  ctx.closePath();
  ctx.fill();
}

function drawMaw(radius, visual, phase = 0) {
  const mouthPulse = 1 + Math.sin(phase * 1.85) * 0.06;
  const gradient = ctx.createRadialGradient(radius * 0.32, -radius * 0.18, radius * 0.2, 0, 0, radius * 1.45);
  gradient.addColorStop(0, blend(visual.body, visual.belly, 0.28));
  gradient.addColorStop(0.58, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.52));
  ctx.fillStyle = gradient;
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.055);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.62, radius * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#02080c";
  ctx.beginPath();
  ctx.ellipse(radius * 0.42, 0, radius * 0.86 * mouthPulse, radius * 0.48 * mouthPulse, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = visual.belly;
  for (let index = -5; index <= 5; index += 1) {
    const x = radius * 0.1 + index * radius * 0.13;
    ctx.beginPath();
    ctx.moveTo(x, -radius * 0.36);
    ctx.lineTo(x + radius * 0.07, -radius * 0.02);
    ctx.lineTo(x + radius * 0.14, -radius * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, radius * 0.36);
    ctx.lineTo(x + radius * 0.07, radius * 0.02);
    ctx.lineTo(x + radius * 0.14, radius * 0.36);
    ctx.closePath();
    ctx.fill();
  }

  drawEye(radius, visual.eye);
}

function drawAngler(radius, visual, phase = 0) {
  drawMaw(radius, visual, phase);
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.06);
  ctx.beginPath();
  ctx.moveTo(radius * 0.05, -radius * 0.6);
  ctx.quadraticCurveTo(radius * 0.72, -radius * 1.38, radius * 1.18, -radius * 1.08 + Math.sin(phase * 1.4) * radius * 0.12);
  ctx.stroke();
  ctx.fillStyle = visual.accent;
  ctx.beginPath();
  ctx.arc(radius * 1.24, -radius * 1.05, Math.max(4, radius * 0.13) * (1 + Math.sin(phase * 2.1) * 0.12), 0, Math.PI * 2);
  ctx.fill();
}

function drawWhale(radius, visual, phase = 0) {
  const tailSwing = Math.sin(phase * 1.6) * radius * 0.2;
  const gradient = ctx.createLinearGradient(-radius * 1.8, -radius, radius * 1.8, radius);
  gradient.addColorStop(0, visual.body);
  gradient.addColorStop(0.6, blend(visual.body, visual.belly, 0.24));
  gradient.addColorStop(1, visual.belly);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = colorWithAlpha(visual.accent, 0.55);
  ctx.lineWidth = Math.max(1.5, radius * 0.04);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.92, radius * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radius * 1.72, 0);
  ctx.lineTo(-radius * 2.45, -radius * 0.48 + tailSwing);
  ctx.lineTo(-radius * 2.22, tailSwing * 0.25);
  ctx.lineTo(-radius * 2.45, radius * 0.48 + tailSwing);
  ctx.closePath();
  ctx.fill();
  drawEye(radius * 0.9, visual.eye);
}

function drawFin(radius, color, phase = 0) {
  const finLift = Math.sin(phase * 1.7) * radius * 0.08;
  ctx.fillStyle = colorWithAlpha(color, 0.82);
  ctx.beginPath();
  ctx.moveTo(-radius * 0.12, -radius * 0.42);
  ctx.lineTo(-radius * 0.54, -radius * 1.02 + finLift);
  ctx.lineTo(radius * 0.34, -radius * 0.48);
  ctx.closePath();
  ctx.fill();
}

function drawEye(radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(radius * 0.72, -radius * 0.22, Math.max(2, radius * 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#02080c";
  ctx.beginPath();
  ctx.arc(radius * 0.75, -radius * 0.22, Math.max(1, radius * 0.045), 0, Math.PI * 2);
  ctx.fill();
}

function drawPatternSpots(radius, color) {
  ctx.fillStyle = colorWithAlpha(color, 0.34);
  for (let index = 0; index < 9; index += 1) {
    const angle = index * 2.4;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius * 0.36, Math.sin(angle) * radius * 0.6, radius * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAttachedAddons(entity, now, position, radius) {
  if (!entity.addons?.length) {
    return;
  }
  for (let index = 0; index < entity.addons.length; index += 1) {
    const addon = entity.addons[index];
    const definition = ADDON_CATALOG[addon.addonId] ?? ADDON_CATALOG.tide_ribbon;
    const angle = addon.angle + now * (0.0012 + index * 0.00013);
    const orbit = radius + 16 + index * 4;
    const x = position.x + Math.cos(angle) * orbit;
    const y = position.y + Math.sin(angle) * orbit;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = definition.color;
    ctx.strokeStyle = colorWithAlpha(definition.color, 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, radius * 0.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawNameplate(text, position, radius, { self = false, quiet = false, relation = null } = {}) {
  if (!text) {
    return;
  }
  const y = position.y - radius - (quiet ? 14 : 18);
  ctx.save();
  ctx.font = quiet ? "600 11px Inter, system-ui, sans-serif" : "700 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const height = quiet ? 17 : 20;
  const widthText = ctx.measureText(text).width + (quiet ? 14 : 18);
  if (quiet) {
    // Faint slate chip that reads as ambient labelling, not a shouty banner.
    // The border echoes the relation ring so the label itself says eat/flee.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(5, 20, 26, 0.5)";
    ctx.strokeStyle = relation ? RELATION_RING_STYLES[relation] : "rgba(182, 241, 244, 0.16)";
  } else {
    ctx.fillStyle = self ? "rgba(253, 230, 138, 0.82)" : "rgba(5, 20, 26, 0.72)";
    ctx.strokeStyle = self ? "rgba(19, 32, 37, 0.5)" : "rgba(182, 241, 244, 0.22)";
  }
  ctx.lineWidth = 1;
  roundRect(ctx, position.x - widthText / 2, y - height / 2, widthText, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = quiet ? "rgba(207, 238, 233, 0.92)" : self ? "#132025" : "#e6fbff";
  ctx.fillText(text, position.x, y + 0.5);
  ctx.restore();
}
