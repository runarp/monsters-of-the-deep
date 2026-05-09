import {
  ADDON_CATALOG,
  CREATURE_CATALOG,
  FOOD_CATALOG,
  PLAYABLE_CREATURE_IDS
} from "/shared/creatureCatalog.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const joinModal = document.querySelector("#joinModal");
const joinButton = document.querySelector("#joinButton");
const playerNameInput = document.querySelector("#playerName");
const creaturePicker = document.querySelector("#creaturePicker");
const connectionStatus = document.querySelector("#connectionStatus");
const eventToast = document.querySelector("#eventToast");
const massValue = document.querySelector("#massValue");
const stageValue = document.querySelector("#stageValue");
const addonValue = document.querySelector("#addonValue");
const leaderboardList = document.querySelector("#leaderboardList");
const deathBanner = document.querySelector("#deathBanner");
const deathDetail = document.querySelector("#deathDetail");

const state = {
  socket: null,
  sessionId: getSessionId(),
  connected: false,
  joined: false,
  playerId: null,
  selectedCreatureId: PLAYABLE_CREATURE_IDS[0],
  snapshot: null,
  renderEntities: new Map(),
  world: { endless: true, radius: null },
  camera: { x: 0, y: 0, scale: 0.8 },
  keys: new Set(),
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false, down: false },
  toastUntil: 0,
  lastInputAt: 0,
  reconnectTimer: null,
  unloading: false
};

const particles = Array.from({ length: 170 }, (_, index) => ({
  x: Math.random(),
  y: Math.random(),
  radius: 0.7 + Math.random() * 2.4,
  depth: 0.12 + Math.random() * 0.88,
  drift: 0.08 + Math.random() * 0.24,
  color: index % 9 === 0 ? "#f7d794" : index % 5 === 0 ? "#fda4af" : "#9ff7eb"
}));

let width = 0;
let height = 0;
let dpr = 1;
let lastFrame = performance.now();

resize();
renderCreaturePicker();
connect();
requestAnimationFrame(frame);
setInterval(sendInput, 16);

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  state.unloading = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.close(1000, "page unload");
  }
});
window.addEventListener("keydown", (event) => {
  state.keys.add(event.code);
});
window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});
canvas.addEventListener("mousemove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  state.pointer.active = true;
});
canvas.addEventListener("mousedown", () => {
  state.pointer.down = true;
});
window.addEventListener("mouseup", () => {
  state.pointer.down = false;
});
canvas.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    state.pointer.x = touch.clientX;
    state.pointer.y = touch.clientY;
    state.pointer.active = true;
    state.pointer.down = true;
    event.preventDefault();
  },
  { passive: false }
);
canvas.addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];
    state.pointer.x = touch.clientX;
    state.pointer.y = touch.clientY;
    state.pointer.active = true;
    event.preventDefault();
  },
  { passive: false }
);
window.addEventListener("touchend", () => {
  state.pointer.down = false;
});

joinButton.addEventListener("click", () => {
  joinGame();
});
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinGame();
  }
});

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderCreaturePicker() {
  creaturePicker.replaceChildren();
  for (const creatureId of PLAYABLE_CREATURE_IDS) {
    const creature = CREATURE_CATALOG[creatureId];
    const option = document.createElement("button");
    option.type = "button";
    option.className = "creature-option";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(creature.id === state.selectedCreatureId));

    const swatch = document.createElement("canvas");
    swatch.className = "creature-portrait";
    swatch.width = 420;
    swatch.height = 150;

    const title = document.createElement("strong");
    title.textContent = creature.name;

    const description = document.createElement("span");
    description.textContent = descriptorFor(creature);

    option.append(swatch, title, description);
    drawCreaturePortrait(swatch, creature);
    option.addEventListener("click", () => {
      state.selectedCreatureId = creature.id;
      renderCreaturePicker();
    });
    creaturePicker.append(option);
  }
}

function descriptorFor(creature) {
  if (creature.summary) {
    return creature.summary;
  }
  if (creature.visual.shape === "serpent") {
    return "Fast coils, sharp growth spikes, narrow turns.";
  }
  if (creature.visual.shape === "kraken") {
    return "Agile bursts, soft body, strong add-on control.";
  }
  return "Wide glide, heavy momentum, stable late growth.";
}

function drawCreaturePortrait(canvas, creature) {
  const context = canvas.getContext("2d");
  const visual = creature.visual;
  const { width: canvasWidth, height: canvasHeight } = canvas;

  const gradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  gradient.addColorStop(0, "#03151b");
  gradient.addColorStop(0.48, blend(visual.body, "#02080c", 0.58));
  gradient.addColorStop(1, "#061b25");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.save();
  context.globalAlpha = 0.26;
  context.strokeStyle = visual.accent;
  context.lineWidth = 2;
  for (let index = 0; index < 5; index += 1) {
    const y = 24 + index * 25;
    context.beginPath();
    for (let x = -20; x <= canvasWidth + 20; x += 28) {
      const wave = Math.sin(x * 0.04 + index) * 5;
      if (x === -20) {
        context.moveTo(x, y + wave);
      } else {
        context.lineTo(x, y + wave);
      }
    }
    context.stroke();
  }
  context.restore();

  context.save();
  context.translate(canvasWidth * 0.54, canvasHeight * 0.54);
  context.rotate(-0.08);
  const radius = 40;
  if (visual.shape === "kraken") {
    drawPortraitKraken(context, radius, visual);
  } else if (visual.shape === "ray") {
    drawPortraitRay(context, radius, visual);
  } else if (visual.shape === "whale") {
    drawPortraitWhale(context, radius, visual);
  } else if (visual.shape === "maw") {
    drawPortraitMaw(context, radius, visual);
  } else if (visual.shape === "angler") {
    drawPortraitAngler(context, radius, visual);
  } else {
    drawPortraitSerpent(context, radius, visual);
  }
  context.restore();
}

function drawPortraitSerpent(context, radius, visual) {
  for (let index = 6; index >= 0; index -= 1) {
    context.fillStyle = index % 2 === 0 ? visual.body : blend(visual.body, visual.belly, 0.22);
    context.beginPath();
    context.ellipse(-index * radius * 0.5, Math.sin(index) * 9, radius * (0.72 - index * 0.035), radius * 0.42, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(radius * 0.4, 0, radius * 1.05, radius * 0.62, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  portraitEye(context, radius, visual);
}

function drawPortraitKraken(context, radius, visual) {
  context.strokeStyle = visual.accent;
  context.lineWidth = 5;
  for (let index = -3; index <= 3; index += 1) {
    context.beginPath();
    context.moveTo(-radius * 0.25, index * 7);
    context.quadraticCurveTo(-radius * 1.4, index * 14, -radius * 2.1, index * 11 + Math.sin(index) * 12);
    context.stroke();
  }
  const gradient = context.createRadialGradient(radius * 0.25, -radius * 0.2, 6, 0, 0, radius * 1.15);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.45, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.45));
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(radius * 0.18, 0, radius * 0.95, radius * 1.05, 0, 0, Math.PI * 2);
  context.fill();
  portraitEye(context, radius * 0.9, visual);
}

function drawPortraitRay(context, radius, visual) {
  const gradient = context.createRadialGradient(radius * 0.22, 0, 4, 0, 0, radius * 1.9);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.48, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.4));
  context.fillStyle = gradient;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(radius * 1.6, 0);
  context.bezierCurveTo(radius * 0.42, -radius * 1.2, -radius * 1.55, -radius, -radius * 1.9, 0);
  context.bezierCurveTo(-radius * 1.55, radius, radius * 0.42, radius * 1.2, radius * 1.6, 0);
  context.closePath();
  context.fill();
  context.stroke();
  portraitEye(context, radius * 0.82, visual);
}

function drawPortraitWhale(context, radius, visual) {
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 0, radius * 1.9, radius * 0.76, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = visual.belly;
  context.beginPath();
  context.ellipse(radius * 0.38, radius * 0.22, radius * 1.1, radius * 0.28, 0, 0, Math.PI * 2);
  context.fill();
  portraitEye(context, radius, visual);
}

function drawPortraitMaw(context, radius, visual) {
  context.fillStyle = visual.body;
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 0, radius * 1.55, radius * 0.92, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#02080c";
  context.beginPath();
  context.ellipse(radius * 0.38, 0, radius * 0.78, radius * 0.46, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = visual.belly;
  for (let index = -4; index <= 4; index += 1) {
    context.beginPath();
    context.moveTo(radius * 0.08 + index * 7, -radius * 0.3);
    context.lineTo(radius * 0.18 + index * 7, -radius * 0.02);
    context.lineTo(radius * 0.28 + index * 7, -radius * 0.3);
    context.fill();
  }
  portraitEye(context, radius, visual);
}

function drawPortraitAngler(context, radius, visual) {
  drawPortraitMaw(context, radius, visual);
  context.strokeStyle = visual.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(radius * 0.2, -radius * 0.6);
  context.quadraticCurveTo(radius * 0.7, -radius * 1.35, radius * 1.1, -radius * 1.05);
  context.stroke();
  context.fillStyle = visual.accent;
  context.beginPath();
  context.arc(radius * 1.18, -radius * 1.02, 7, 0, Math.PI * 2);
  context.fill();
}

function portraitEye(context, radius, visual) {
  context.fillStyle = visual.eye;
  context.beginPath();
  context.arc(radius * 0.7, -radius * 0.22, Math.max(4, radius * 0.11), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#02080c";
  context.beginPath();
  context.arc(radius * 0.73, -radius * 0.22, Math.max(2, radius * 0.05), 0, Math.PI * 2);
  context.fill();
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}`);
  state.socket = socket;
  state.connected = false;
  connectionStatus.textContent = "Connecting";

  socket.addEventListener("open", () => {
    state.connected = true;
    connectionStatus.textContent = "Connected";
    if (state.joined) {
      sendJoin();
    }
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hello") {
      state.world = message.world;
      return;
    }
    if (message.type === "welcome") {
      state.playerId = message.playerId;
      state.world = message.world;
      state.joined = true;
      joinModal.hidden = true;
      connectionStatus.textContent = "Swimming";
      renderLeaderboard(message.leaderboard ?? []);
      return;
    }
    if (message.type === "snapshot") {
      state.snapshot = message;
      state.world = message.world;
      ingestSnapshot(message);
      if (message.events) {
        handleEvents(message.events);
      }
      updateHud(message);
    }
  });

  socket.addEventListener("close", (event) => {
    state.connected = false;
    if (event.code === 4001) {
      return;
    }
    if (state.unloading) {
      return;
    }
    connectionStatus.textContent = "Reconnecting";
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }
    state.reconnectTimer = setTimeout(connect, 900);
  });
}

function joinGame() {
  state.joined = true;
  sendJoin();
}

function sendJoin() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: "join",
      sessionId: state.sessionId,
      name: playerNameInput.value,
      creatureId: state.selectedCreatureId
    })
  );
}

function sendInput() {
  if (!state.joined || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const input = calculateInput();
  state.socket.send(JSON.stringify({ type: "input", ...input }));
}

function calculateInput() {
  let x = 0;
  let y = 0;

  const usingEsdf =
    state.keys.has("KeyE") || state.keys.has("KeyS") || state.keys.has("KeyD") || state.keys.has("KeyF");

  if (usingEsdf) {
    if (state.keys.has("KeyS")) {
      x -= 1;
    }
    if (state.keys.has("KeyF")) {
      x += 1;
    }
    if (state.keys.has("KeyE")) {
      y -= 1;
    }
    if (state.keys.has("KeyD")) {
      y += 1;
    }
  } else {
    if (state.keys.has("KeyA")) {
      x -= 1;
    }
    if (state.keys.has("KeyD")) {
      x += 1;
    }
    if (state.keys.has("KeyW")) {
      y -= 1;
    }
    if (state.keys.has("KeyS")) {
      y += 1;
    }
  }

  if (state.keys.has("ArrowLeft")) {
    x -= 1;
  }
  if (state.keys.has("ArrowRight")) {
    x += 1;
  }
  if (state.keys.has("ArrowUp")) {
    y -= 1;
  }
  if (state.keys.has("ArrowDown")) {
    y += 1;
  }

  if (x === 0 && y === 0 && state.pointer.active) {
    const dx = state.pointer.x - width / 2;
    const dy = state.pointer.y - height / 2;
    const distance = Math.hypot(dx, dy);
    if (distance > 22) {
      x = dx / distance;
      y = dy / distance;
    }
  } else {
    const distance = Math.hypot(x, y);
    if (distance > 0) {
      x /= distance;
      y /= distance;
    }
  }

  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    boost: state.keys.has("Space") || state.pointer.down
  };
}

function frame(now) {
  const dt = Math.min(48, now - lastFrame) / 1000;
  lastFrame = now;
  render(now, dt);
  requestAnimationFrame(frame);
}

function render(now, dt) {
  updateRenderEntities(dt, now);
  const self =
    state.snapshot?.self?.alive === false
      ? state.snapshot.self
      : getRenderedEntity(state.snapshot?.self) ?? state.snapshot?.self;
  updateCamera(self, dt);

  ctx.clearRect(0, 0, width, height);
  drawOcean(now);

  if (state.snapshot) {
    drawWorldBoundary();
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

  if (!state.joined) {
    drawMenuBackdrop(now);
  }
}

function ingestSnapshot(snapshot) {
  const seenAt = performance.now();
  const entities = [...snapshot.players, ...snapshot.npcs, ...snapshot.food, ...snapshot.addons];
  if (snapshot.self?.alive === false) {
    entities.push(snapshot.self);
  }

  for (const entity of entities) {
    const key = renderKey(entity);
    const cached = state.renderEntities.get(key);
    if (!cached) {
      state.renderEntities.set(key, createRenderEntity(entity, seenAt));
      continue;
    }

    cached.data = entity;
    cached.targetX = entity.x;
    cached.targetY = entity.y;
    cached.targetRadius = entity.radius;
    cached.targetHeading = entity.heading ?? cached.targetHeading;
    cached.lastSeenAt = seenAt;

    const jumpDistance = Math.hypot(cached.targetX - cached.x, cached.targetY - cached.y);
    if (jumpDistance > Math.max(700, cached.radius * 10)) {
      cached.x = cached.targetX;
      cached.y = cached.targetY;
      cached.radius = cached.targetRadius;
      cached.heading = cached.targetHeading;
    }
  }
}

function createRenderEntity(entity, seenAt) {
  return {
    data: entity,
    x: entity.x,
    y: entity.y,
    radius: entity.radius,
    heading: entity.heading ?? 0,
    targetX: entity.x,
    targetY: entity.y,
    targetRadius: entity.radius,
    targetHeading: entity.heading ?? 0,
    lastSeenAt: seenAt
  };
}

function updateRenderEntities(dt, now) {
  const smoothing = 1 - Math.exp(-dt * 18);
  const radiusSmoothing = 1 - Math.exp(-dt * 10);
  const staleAfterMs = 1400;

  for (const [key, entity] of state.renderEntities.entries()) {
    if (now - entity.lastSeenAt > staleAfterMs) {
      state.renderEntities.delete(key);
      continue;
    }
    entity.x += (entity.targetX - entity.x) * smoothing;
    entity.y += (entity.targetY - entity.y) * smoothing;
    entity.radius += (entity.targetRadius - entity.radius) * radiusSmoothing;
    entity.heading = lerpAngle(entity.heading, entity.targetHeading, smoothing);
  }
}

function getRenderedEntities(entities) {
  return entities.map((entity) => getRenderedEntity(entity) ?? entity);
}

function getRenderedEntity(entity) {
  if (!entity) {
    return null;
  }
  const cached = state.renderEntities.get(renderKey(entity));
  if (!cached) {
    return null;
  }
  return {
    ...cached.data,
    x: cached.x,
    y: cached.y,
    radius: cached.radius,
    heading: cached.heading
  };
}

function renderKey(entity) {
  return `${entity.kind}:${entity.id}`;
}

function updateCamera(self, dt) {
  if (self && self.alive) {
    state.camera.x += (self.x - state.camera.x) * clamp01(dt * 7.8);
    state.camera.y += (self.y - state.camera.y) * clamp01(dt * 7.8);
    const targetScale = clamp(1.12 - Math.log10(Math.max(1, self.mass / 12)) * 0.24, 0.36, 1.08);
    state.camera.scale += (targetScale - state.camera.scale) * clamp01(dt * 5.5);
  }
}

function drawOcean(now) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#073640");
  gradient.addColorStop(0.42, "#05242e");
  gradient.addColorStop(1, "#02080c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#89f7e5";
  ctx.lineWidth = 1;
  for (let row = -1; row < 12; row += 1) {
    const y = ((row * 92 + now * 0.012 - state.camera.y * 0.018) % (height + 160)) - 80;
    ctx.beginPath();
    for (let x = -80; x <= width + 80; x += 32) {
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
      particle.x * width + now * particle.drift * 0.05 - state.camera.x * particle.depth * 0.025,
      width
    );
    const y = wrap(
      particle.y * height + now * particle.drift * 0.03 - state.camera.y * particle.depth * 0.025,
      height
    );
    ctx.globalAlpha = 0.26 + particle.depth * 0.42;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, particle.radius * particle.depth, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMenuBackdrop(now) {
  const centerX = width * 0.5;
  const centerY = height * 0.52;
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

function drawCreature(entity, now, isSelf) {
  const definition = CREATURE_CATALOG[entity.creatureId] ?? CREATURE_CATALOG.abyssal_serpent;
  const position = worldToScreen(entity.x, entity.y);
  const radius = Math.max(5, entity.radius * state.camera.scale);
  if (!isOnScreen(position, radius + 80)) {
    return;
  }

  drawAttachedAddons(entity, now, position, radius);

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(entity.heading);
  if (isSelf) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = Math.max(2, radius * 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.7, radius * 1.15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (definition.visual.shape === "serpent") {
    drawSerpent(radius, definition.visual);
  } else if (definition.visual.shape === "kraken") {
    drawKraken(radius, definition.visual);
  } else if (definition.visual.shape === "ray") {
    drawRay(radius, definition.visual);
  } else if (definition.visual.shape === "maw") {
    drawMaw(radius, definition.visual);
  } else if (definition.visual.shape === "angler") {
    drawAngler(radius, definition.visual);
  } else if (definition.visual.shape === "shark") {
    drawShark(radius, definition.visual);
  } else if (definition.visual.shape === "whale") {
    drawWhale(radius, definition.visual);
  } else {
    drawFish(radius, definition.visual);
  }

  ctx.restore();
  if (entity.kind === "player") {
    drawNameplate(entity, position, radius, isSelf);
  }
}

function drawFish(radius, visual) {
  const gradient = ctx.createLinearGradient(-radius * 1.6, 0, radius * 1.45, 0);
  gradient.addColorStop(0, visual.accent);
  gradient.addColorStop(0.28, visual.body);
  gradient.addColorStop(1, visual.belly);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = colorWithAlpha(visual.accent, 0.65);
  ctx.lineWidth = Math.max(1, radius * 0.06);

  ctx.beginPath();
  ctx.moveTo(-radius * 1.55, 0);
  ctx.lineTo(-radius * 2.25, -radius * 0.65);
  ctx.lineTo(-radius * 2.05, 0);
  ctx.lineTo(-radius * 2.25, radius * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.7, radius * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawFin(radius, visual.accent);
  drawEye(radius, visual.eye);
}

function drawSerpent(radius, visual) {
  for (let index = 6; index >= 0; index -= 1) {
    const segmentRadius = radius * (0.42 + (6 - index) * 0.08);
    const x = -radius * 0.48 * index;
    const y = Math.sin(index * 0.9) * radius * 0.18;
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

function drawKraken(radius, visual) {
  ctx.strokeStyle = colorWithAlpha(visual.accent, 0.85);
  ctx.lineWidth = Math.max(2, radius * 0.08);
  for (let index = -3; index <= 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.45, index * radius * 0.15);
    ctx.quadraticCurveTo(
      -radius * 1.2,
      index * radius * 0.38,
      -radius * 1.7,
      index * radius * 0.22 + Math.sin(index) * radius * 0.22
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

function drawRay(radius, visual) {
  const gradient = ctx.createRadialGradient(radius * 0.25, 0, radius * 0.1, 0, 0, radius * 1.8);
  gradient.addColorStop(0, visual.belly);
  gradient.addColorStop(0.42, visual.body);
  gradient.addColorStop(1, blend(visual.body, "#02080c", 0.3));
  ctx.fillStyle = gradient;
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.045);
  ctx.beginPath();
  ctx.moveTo(radius * 1.35, 0);
  ctx.bezierCurveTo(radius * 0.45, -radius * 1.15, -radius * 1.2, -radius * 0.95, -radius * 1.6, 0);
  ctx.bezierCurveTo(-radius * 1.2, radius * 0.95, radius * 0.45, radius * 1.15, radius * 1.35, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radius * 1.22, 0);
  ctx.lineTo(-radius * 2.4, 0);
  ctx.stroke();
  drawEye(radius * 0.82, visual.eye);
}

function drawShark(radius, visual) {
  drawFish(radius, visual);
  ctx.fillStyle = blend(visual.body, "#02080c", 0.35);
  ctx.beginPath();
  ctx.moveTo(-radius * 0.1, -radius * 0.62);
  ctx.lineTo(-radius * 0.55, -radius * 1.35);
  ctx.lineTo(radius * 0.35, -radius * 0.58);
  ctx.closePath();
  ctx.fill();
}

function drawMaw(radius, visual) {
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
  ctx.ellipse(radius * 0.42, 0, radius * 0.86, radius * 0.48, 0, 0, Math.PI * 2);
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

function drawAngler(radius, visual) {
  drawMaw(radius, visual);
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = Math.max(1.5, radius * 0.06);
  ctx.beginPath();
  ctx.moveTo(radius * 0.05, -radius * 0.6);
  ctx.quadraticCurveTo(radius * 0.72, -radius * 1.38, radius * 1.18, -radius * 1.08);
  ctx.stroke();
  ctx.fillStyle = visual.accent;
  ctx.beginPath();
  ctx.arc(radius * 1.24, -radius * 1.05, Math.max(4, radius * 0.13), 0, Math.PI * 2);
  ctx.fill();
}

function drawWhale(radius, visual) {
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
  ctx.lineTo(-radius * 2.45, -radius * 0.48);
  ctx.lineTo(-radius * 2.22, 0);
  ctx.lineTo(-radius * 2.45, radius * 0.48);
  ctx.closePath();
  ctx.fill();
  drawEye(radius * 0.9, visual.eye);
}

function drawFin(radius, color) {
  ctx.fillStyle = colorWithAlpha(color, 0.82);
  ctx.beginPath();
  ctx.moveTo(-radius * 0.12, -radius * 0.42);
  ctx.lineTo(-radius * 0.54, -radius * 1.02);
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

function drawNameplate(entity, position, radius, isSelf) {
  const y = position.y - radius - 18;
  ctx.save();
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const widthText = ctx.measureText(entity.name).width + 18;
  ctx.fillStyle = isSelf ? "rgba(253, 230, 138, 0.82)" : "rgba(5, 20, 26, 0.72)";
  ctx.strokeStyle = isSelf ? "rgba(19, 32, 37, 0.5)" : "rgba(182, 241, 244, 0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, position.x - widthText / 2, y - 10, widthText, 20, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = isSelf ? "#132025" : "#e6fbff";
  ctx.fillText(entity.name, position.x, y + 0.5);
  ctx.restore();
}

function updateHud(snapshot) {
  const self = snapshot.self;
  if (self) {
    massValue.textContent = String(self.mass);
    stageValue.textContent = self.stage;
    addonValue.textContent = formatAddons(self);
    deathBanner.hidden = self.alive !== false;
    if (self.alive === false) {
      deathDetail.textContent = self.lastEatenBy ? `Eaten by ${self.lastEatenBy}` : "Returning to the bloom";
    }
  }
  renderLeaderboard(snapshot.leaderboard);

  if (performance.now() > state.toastUntil) {
    eventToast.textContent = "";
  }
}

function formatAddons(self) {
  const names = self.addons?.map((addon) => ADDON_CATALOG[addon.addonId]?.name).filter(Boolean) ?? [];
  if (self.shieldCharges > 0) {
    names.push(`Shield ${self.shieldCharges}`);
  }
  return names.length ? names.slice(0, 3).join(", ") : "None";
}

function renderLeaderboard(leaderboard) {
  leaderboardList.replaceChildren();
  for (let index = 0; index < leaderboard.length; index += 1) {
    const player = leaderboard[index];
    const item = document.createElement("li");
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

function handleEvents(events) {
  for (const event of events) {
    if (event.type === "player_eaten") {
      if (event.victimId === state.playerId) {
        showToast(`Eaten by ${event.predatorName}`);
      } else {
        showToast(`${event.victimName} was eaten by ${event.predatorName}`);
      }
    } else if (event.type === "shield_block" && event.playerId === state.playerId) {
      showToast("Pearl shield cracked");
    } else if (event.type === "collected_addon" && event.playerId === state.playerId) {
      showToast(`${ADDON_CATALOG[event.addonId]?.name ?? "Add-on"} attached`);
    } else if (event.type === "ate_creature" && event.playerId === state.playerId) {
      const creature = CREATURE_CATALOG[event.creatureId]?.name ?? "creature";
      showToast(`Consumed ${creature}`);
    }
  }
}

function showToast(message) {
  eventToast.textContent = message;
  state.toastUntil = performance.now() + 2200;
}

function worldToScreen(x, y) {
  return {
    x: (x - state.camera.x) * state.camera.scale + width / 2,
    y: (y - state.camera.y) * state.camera.scale + height / 2
  };
}

function isOnScreen(position, margin) {
  return position.x > -margin && position.x < width + margin && position.y > -margin && position.y < height + margin;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerpAngle(from, to, amount) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * amount;
}

function wrap(value, max) {
  return ((value % max) + max) % max;
}

function colorWithAlpha(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function blend(hexA, hexB, amount) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(a.r + (b.r - a.r) * amount)}, ${Math.round(a.g + (b.g - a.g) * amount)}, ${Math.round(a.b + (b.b - a.b) * amount)})`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function roundRect(context, x, y, rectWidth, rectHeight, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + rectWidth - radius, y);
  context.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + radius);
  context.lineTo(x + rectWidth, y + rectHeight - radius);
  context.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - radius, y + rectHeight);
  context.lineTo(x + radius, y + rectHeight);
  context.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function getSessionId() {
  const key = "monstersOfTheDeep.sessionId";
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created =
    window.crypto?.randomUUID?.() ??
    `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}
