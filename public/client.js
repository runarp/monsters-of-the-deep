import {
  ADDON_CATALOG,
  CREATURE_CATALOG,
  FOOD_CATALOG,
  HAZARD_CATALOG,
  PLAYABLE_CREATURE_IDS,
  canConsume,
  creatureLabel,
  oversizeTier,
  scientificNameFor
} from "/shared/creatureCatalog.js";
import { DEPTH_ZONES, REGIONS, geoPositionAt, locationAt } from "/shared/geography.js";
import { signatureSpeciesForRegion } from "/shared/speciesCatalog.js";
import { clearSavedRun, createLocalSession, loadSavedRun } from "/localGame.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const joinModal = document.querySelector("#joinModal");
const joinButton = document.querySelector("#joinButton");
const playerNameInput = document.querySelector("#playerName");
const nameError = document.querySelector("#nameError");
const creaturePicker = document.querySelector("#creaturePicker");
const connectionStatus = document.querySelector("#connectionStatus");
const eventFeed = document.querySelector("#eventFeed");
const massValue = document.querySelector("#massValue");
const stageValue = document.querySelector("#stageValue");
const addonValue = document.querySelector("#addonValue");
const locusRow = document.querySelector("#locusRow");
const regionValue = document.querySelector("#regionValue");
const zoneValue = document.querySelector("#zoneValue");
const depthValue = document.querySelector("#depthValue");
const minimap = document.querySelector("#minimap");
const minimapCanvas = document.querySelector("#minimapCanvas");
const minimapCtx = minimapCanvas?.getContext("2d");
const minimapRegion = document.querySelector("#minimapRegion");
const minimapZone = document.querySelector("#minimapZone");
const regionTip = document.querySelector("#regionTip");
const depthGauge = document.querySelector("#depthGauge");
const depthTrack = document.querySelector("#depthTrack");
const depthMarker = document.querySelector("#depthMarker");
const depthMarkerLabel = document.querySelector("#depthMarkerLabel");
const zoomControl = document.querySelector("#zoomControl");
const zoomSlider = document.querySelector("#zoomSlider");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const boostButton = document.querySelector("#boostButton");
const leaderboardList = document.querySelector("#leaderboardList");
const deathBanner = document.querySelector("#deathBanner");
const pauseBanner = document.querySelector("#pauseBanner");
const deathTitle = document.querySelector("#deathTitle");
const deathDetail = document.querySelector("#deathDetail");
const resumeBlock = document.querySelector("#resumeBlock");
const resumeCheckbox = document.querySelector("#resumeCheckbox");
const resumeText = document.querySelector("#resumeText");
const clearSaveButton = document.querySelector("#clearSaveButton");
const installButton = document.querySelector("#installButton");
const hoverTip = document.querySelector("#hoverTip");
const speciesLogButton = document.querySelector("#speciesLogButton");
const speciesLogCount = document.querySelector("#speciesLogCount");
const speciesLogPanel = document.querySelector("#speciesLogPanel");
const speciesLogList = document.querySelector("#speciesLogList");
const speciesLogProgress = document.querySelector("#speciesLogProgress");

const state = {
  socket: null,
  local: null,
  mode: "online",
  everConnectedOnline: false,
  resumeOffline: true,
  sessionId: getSessionId(),
  connected: false,
  joined: false,
  playerId: null,
  selectedCreatureId: PLAYABLE_CREATURE_IDS[0],
  snapshot: null,
  renderEntities: new Map(),
  assetImages: new Map(),
  world: { endless: true, radius: null },
  camera: { x: 0, y: 0, scale: 0.8, userZoom: 1 },
  keys: new Set(),
  moveScheme: "wasd",
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false, down: false, isMouse: false },
  touchBoost: false,
  toastUntil: 0,
  lastInputAt: 0,
  reconnectTimer: null,
  onlineAttempts: 0,
  unloading: false,
  gamePaused: false
};

// Fall back to the offline solo game only after the online server has genuinely
// failed to answer several times — a slow first handshake (TLS on a school
// Chromebook, a server cold-start) must not strand a connected player in solo.
const MAX_ONLINE_ATTEMPTS = 4;
const ONLINE_HANG_TIMEOUT_MS = 6000;
const USER_ZOOM_MIN = 0.4;
const USER_ZOOM_MAX = 1.8;
const USER_ZOOM_STEP = 1.12;

// Network/render diagnostics for chasing jittery motion. Toggle with the `
// (backquote) key or load with ?debug. Tracks the snapshot cadence (interval
// avg/min/max — irregular gaps are what read as jitter), hard position snaps
// (rubber-banding), fps, and round-trip ping while enabled.
const netDebug = {
  enabled: new URLSearchParams(window.location.search).has("debug"),
  intervals: [],
  lastSnapshotAt: 0,
  snapshotCount: 0,
  hardSnaps: 0,
  lastHardSnap: "",
  pingMs: null,
  pingSentAt: 0,
  lastPingAt: 0,
  fps: 0
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
initSavedRun();
renderCreaturePicker();
updateJoinState();
registerServiceWorker();
setupInstallPrompt();
setupZoomControls();
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
  if (state.local) {
    state.local.stop();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }
  state.keys.add(event.code);
  // Latch the movement layout by each scheme's EXCLUSIVE keys (W/A vs E/F).
  // S and D are shared, so they alone can't disambiguate — using them to pick
  // the scheme is what made "down" (S) veer sideways.
  if (event.code === "KeyW" || event.code === "KeyA") {
    state.moveScheme = "wasd";
  } else if (event.code === "KeyE" || event.code === "KeyF") {
    state.moveScheme = "esdf";
  }
  if (event.code === "Backquote") {
    netDebug.enabled = !netDebug.enabled;
  }
  if (event.code === "KeyL" && state.joined) {
    toggleSpeciesLog();
  }
});
window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});
canvas.addEventListener("mousemove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  state.pointer.active = true;
  state.pointer.isMouse = true;
});
canvas.addEventListener("mousedown", () => {
  state.pointer.down = true;
});
// Wheel / trackpad pinch adjusts a manual zoom factor on top of the
// mass-driven camera scale, so players can pull back to take in their size.
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    setUserZoom(state.camera.userZoom * Math.exp(-event.deltaY * 0.0011));
  },
  { passive: false }
);
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
    state.pointer.isMouse = false;
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

// Solo mode auto-pauses after IDLE_PAUSE_MS without any real user input, so a
// creature left unattended freezes instead of drifting toward the resting
// cursor and getting eaten. Any input resumes instantly.
const IDLE_PAUSE_MS = 30_000;
for (const type of ["keydown", "pointerdown", "pointermove", "touchstart", "touchmove", "touchend", "wheel"]) {
  window.addEventListener(type, markActivity, { passive: true });
}
setInterval(() => {
  if (state.mode !== "offline" || !state.local || !state.joined) {
    return;
  }
  if (performance.now() - state.lastInputAt > IDLE_PAUSE_MS) {
    state.local.setPaused(true);
  }
}, 1000);

function markActivity() {
  state.lastInputAt = performance.now();
  state.local?.setPaused(false);
}

// iPadOS often skips touchend when the app is backgrounded mid-hold, leaving
// boost stuck on and draining mass the moment play resumes.
function resetTouchInput() {
  state.pointer.down = false;
  state.pointer.active = false;
  state.touchBoost = false;
  state.keys.delete("Space");
  boostButton?.classList.remove("is-active");
}

joinButton.addEventListener("click", () => {
  joinGame();
});
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinGame();
  }
});
playerNameInput.addEventListener("input", () => {
  syncQuickNameHighlight();
  updateJoinState();
});

const quickNameButtons = [...document.querySelectorAll(".quick-name")];
for (const button of quickNameButtons) {
  button.addEventListener("click", () => {
    playerNameInput.value = button.dataset.name;
    syncQuickNameHighlight();
    updateJoinState();
  });
}

// Highlight the quick-name chip that matches the current field value (if any),
// so a picked name reads as selected and a typed one clears the highlight.
function syncQuickNameHighlight() {
  const current = playerNameInput.value.trim().toLowerCase();
  for (const button of quickNameButtons) {
    button.classList.toggle("is-active", button.dataset.name.toLowerCase() === current);
  }
}
resumeCheckbox?.addEventListener("change", () => {
  state.resumeOffline = resumeCheckbox.checked;
});
clearSaveButton?.addEventListener("click", () => {
  clearSavedRun();
  state.resumeOffline = false;
  if (resumeBlock) {
    resumeBlock.hidden = true;
  }
});
speciesLogButton?.addEventListener("click", () => {
  toggleSpeciesLog();
});
minimapCanvas?.addEventListener("mousemove", (event) => {
  updateRegionTip(event.clientX, event.clientY);
});
minimapCanvas?.addEventListener("mouseleave", () => {
  if (regionTip) {
    regionTip.hidden = true;
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
    description.textContent = creature.summary ?? descriptorFor(creature);

    if (creature.trait) {
      const traitLine = document.createElement("span");
      traitLine.className = "creature-trait";
      traitLine.textContent = `${creature.trait.name} — ${creature.trait.summary}`;
      option.append(swatch, title, description, traitLine);
    } else {
      option.append(swatch, title, description);
    }
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

  if (drawSpritePortrait(context, visual, canvasWidth, canvasHeight)) {
    return;
  }

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

function drawSpritePortrait(context, visual, canvasWidth, canvasHeight) {
  const sprite = visual.animationSprite ?? visual.sprite;
  const image = getSpriteImage(sprite, () => renderCreaturePicker());
  if (!sprite || !image?.complete || image.naturalWidth === 0) {
    return false;
  }

  const source = spriteSourceRect(sprite, image);
  context.save();
  context.fillStyle = "#020c12";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvasWidth, canvasHeight);

  const shade = context.createLinearGradient(0, 0, 0, canvasHeight);
  shade.addColorStop(0, "rgba(255,255,255,0.05)");
  shade.addColorStop(0.62, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.34)");
  context.fillStyle = shade;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.strokeStyle = colorWithAlpha(visual.accent, 0.7);
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, canvasWidth - 3, canvasHeight - 3);
  context.restore();
  return true;
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
  if (state.mode === "offline") {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.onlineAttempts += 1;
  let socket;
  try {
    socket = new WebSocket(`${protocol}//${window.location.host}`);
  } catch {
    retryOnlineOrFallback();
    return;
  }
  state.socket = socket;
  state.connected = false;
  connectionStatus.textContent = "Connecting";

  // Only treats a hung handshake as a failure; a live-but-slow server still has
  // several seconds to open before we retry.
  const fallbackTimer = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        // Ignore: the close handler will decide what to do next.
      }
    }
  }, ONLINE_HANG_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    clearTimeout(fallbackTimer);
    state.connected = true;
    state.everConnectedOnline = true;
    state.onlineAttempts = 0;
    connectionStatus.textContent = "Connected";
    if (state.joined) {
      sendJoin();
    }
  });

  socket.addEventListener("message", (event) => {
    handleMessage(JSON.parse(event.data));
  });

  socket.addEventListener("close", (event) => {
    clearTimeout(fallbackTimer);
    state.connected = false;
    if (event.code === 4001 || state.unloading || state.mode === "offline") {
      return;
    }
    // A live session that dropped keeps reconnecting indefinitely.
    if (state.everConnectedOnline) {
      connectionStatus.textContent = "Reconnecting";
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      state.reconnectTimer = setTimeout(connect, 900);
      return;
    }
    // Never connected yet: retry a few times before giving up to solo.
    retryOnlineOrFallback();
  });

  socket.addEventListener("error", () => {
    // The close handler runs next and decides whether to retry or go offline.
  });
}

function retryOnlineOrFallback() {
  if (state.mode === "offline") {
    return;
  }
  if (state.onlineAttempts >= MAX_ONLINE_ATTEMPTS) {
    goOffline();
    return;
  }
  connectionStatus.textContent = "Connecting";
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }
  state.reconnectTimer = setTimeout(connect, 700);
}

function goOffline() {
  if (state.mode === "offline") {
    return;
  }
  state.mode = "offline";
  state.socket = null;
  state.connected = true;
  connectionStatus.textContent = "Offline · solo";
  state.local = createLocalSession({ onMessage: handleMessage, resume: state.resumeOffline });
  if (state.joined) {
    sendJoin();
  }
}

function handleMessage(message) {
  if (message.type === "hello") {
    state.world = message.world;
    renderLeaderboard(message.leaderboard ?? []);
    return;
  }
  if (message.type === "error") {
    handleServerError(message);
    return;
  }
  if (message.type === "paused") {
    state.gamePaused = true;
    resetTouchInput();
    if (pauseBanner) {
      pauseBanner.hidden = !state.joined;
    }
    connectionStatus.textContent = "Paused";
    return;
  }
  if (message.type === "resumed") {
    state.gamePaused = false;
    state.lastInputAt = performance.now();
    if (pauseBanner) {
      pauseBanner.hidden = true;
    }
    connectionStatus.textContent = state.mode === "offline" ? "Offline · solo" : "Swimming";
    return;
  }
  if (message.type === "welcome") {
    state.playerId = message.playerId;
    state.world = message.world;
    state.joined = true;
    state.lastInputAt = performance.now();
    joinModal.hidden = true;
    setZoomControlVisible(true);
    connectionStatus.textContent = state.mode === "offline" ? "Offline · solo" : "Swimming";
    renderLeaderboard(message.leaderboard ?? []);
    if (message.resumed) {
      showToast(`Resumed solo run (mass ${message.resumedMass})`);
    }
    return;
  }
  if (message.type === "pong") {
    if (netDebug.pingSentAt) {
      netDebug.pingMs = performance.now() - netDebug.pingSentAt;
    }
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
}

function transportSend(message) {
  if (state.mode === "offline") {
    state.local?.send(message);
    return;
  }
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
  }
}

function transportReady() {
  if (state.mode === "offline") {
    return Boolean(state.local);
  }
  return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
}

function initSavedRun() {
  const saved = loadSavedRun();
  if (!saved) {
    state.resumeOffline = false;
    return;
  }
  state.resumeOffline = true;
  if (PLAYABLE_CREATURE_IDS.includes(saved.creatureId)) {
    state.selectedCreatureId = saved.creatureId;
  }
  if (saved.name && !playerNameInput.value) {
    playerNameInput.value = saved.name;
  }
  if (resumeBlock && resumeText) {
    const creatureName = CREATURE_CATALOG[saved.creatureId]?.name ?? "creature";
    resumeText.textContent = `Resume solo run · ${creatureName} · mass ${Math.round(saved.mass).toLocaleString()}`;
    resumeBlock.hidden = false;
    if (resumeCheckbox) {
      resumeCheckbox.checked = true;
    }
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline precaching is a progressive enhancement; ignore failures.
    });
  });
}

// Surfaces a one-tap "Install" button when the browser (e.g. Chrome on a
// Chromebook) reports the app is installable, so there's no installer to run.
function setUserZoom(value) {
  state.camera.userZoom = clamp(value, USER_ZOOM_MIN, USER_ZOOM_MAX);
  if (zoomSlider) {
    const rounded = Number(state.camera.userZoom.toFixed(2));
    zoomSlider.value = String(rounded);
    zoomSlider.setAttribute("aria-valuenow", String(rounded));
  }
}

function adjustUserZoom(factor) {
  setUserZoom(state.camera.userZoom * factor);
}

function setZoomControlVisible(visible) {
  if (zoomControl) {
    zoomControl.hidden = !visible;
  }
}

function setupZoomControls() {
  if (!zoomControl) {
    return;
  }
  zoomOutButton?.addEventListener("click", () => adjustUserZoom(1 / USER_ZOOM_STEP));
  zoomInButton?.addEventListener("click", () => adjustUserZoom(USER_ZOOM_STEP));
  zoomSlider?.addEventListener("input", () => {
    setUserZoom(Number(zoomSlider.value));
  });
  boostButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    state.touchBoost = true;
    boostButton.classList.add("is-active");
    boostButton.setPointerCapture(event.pointerId);
  });
  const releaseBoost = () => {
    state.touchBoost = false;
    boostButton?.classList.remove("is-active");
  };
  boostButton?.addEventListener("pointerup", releaseBoost);
  boostButton?.addEventListener("pointercancel", releaseBoost);
  setUserZoom(state.camera.userZoom);
}

function setupInstallPrompt() {
  if (!installButton) {
    return;
  }
  if (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone) {
    return;
  }

  // iOS/iPadOS browsers are all WebKit and never fire beforeinstallprompt, so
  // the install button can't work there. Show the manual Add to Home Screen hint.
  const userAgent = window.navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.maxTouchPoints > 1 && /Macintosh/.test(userAgent));
  if (isIOS) {
    const iosHint = document.querySelector("#iosInstallHint");
    if (iosHint) {
      iosHint.hidden = false;
    }
    return;
  }

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      return;
    }
    installButton.disabled = true;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.hidden = true;
    installButton.disabled = false;
    if (choice?.outcome === "accepted") {
      showToast("Installed — look on your shelf");
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButton.hidden = true;
    showToast("Installed — look on your shelf");
  });
}

function joinGame() {
  if (!isValidNameInput()) {
    updateJoinState("Enter a name to join.");
    playerNameInput.focus();
    return;
  }

  state.joined = true;
  sendJoin();
}

function sendJoin() {
  if (!transportReady()) {
    return;
  }
  transportSend({
    type: "join",
    sessionId: state.sessionId,
    name: sanitizedNameInput(),
    creatureId: state.selectedCreatureId
  });
}

function updateJoinState(errorText = "") {
  const valid = isValidNameInput();
  joinButton.disabled = !valid;
  nameError.textContent = valid ? "" : errorText;
}

function sanitizedNameInput() {
  return playerNameInput.value
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function isValidNameInput() {
  return sanitizedNameInput().length > 0;
}

function handleServerError(message) {
  if (message.code === "invalid_name") {
    state.joined = false;
    joinModal.hidden = false;
    updateJoinState(message.message ?? "Enter a name to join.");
    playerNameInput.focus();
    return;
  }

  showToast(message.message ?? "Connection error");
}

function sendInput() {
  if (!state.joined || !transportReady()) {
    return;
  }
  if (state.snapshot?.self?.won || state.gamePaused) {
    return;
  }
  const input = calculateInput();
  transportSend({ type: "input", ...input });
}

function calculateInput() {
  let x = 0;
  let y = 0;

  if (state.moveScheme === "esdf") {
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
    boost: state.keys.has("Space") || (state.pointer.down && state.pointer.isMouse) || state.touchBoost
  };
}

function frame(now) {
  const dt = Math.min(48, now - lastFrame) / 1000;
  lastFrame = now;
  render(now, dt);
  requestAnimationFrame(frame);
}

let npcLabelBudget = 0;

// Bottom-centre event feed: a short stack of fading pills that everyone sees —
// joins, growth milestones, kills, disconnects — plus this player's own eats.
// This is where the reading eye rests, so all "what just happened" text lands
// here rather than floating out in the world.
const FEED_MAX = 5;
let lastEatTextAt = 0;

function pushFeed(text, kind = "info", holdMs = 4000, subtext = null) {
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

function render(now, dt) {
  updateRenderEntities(dt, now);
  // Cap species labels per frame so the screen never becomes a wall of text —
  // the nearest/biggest creatures win the plates (creatures are drawn small→large).
  npcLabelBudget = 14;
  const self =
    state.snapshot?.self?.alive === false
      ? state.snapshot.self
      : getRenderedEntity(state.snapshot?.self) ?? state.snapshot?.self;
  updateCamera(self, dt);

  ctx.clearRect(0, 0, width, height);
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

// Mouse-over inspector: the topmost thing under the cursor gets a tooltip with
// its name and any metadata we have (species life stage + size, creature type,
// hazard). Creatures win over food when overlapping — that's what you're
// pointing at. Touch input is ignored (no hover).
function updateHoverTip() {
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
  if (left + rect.width > width - 8) {
    left = cursorX - rect.width - 16;
  }
  if (top + rect.height > height - 8) {
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
  if (canConsume(self, entity)) {
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

function ingestSnapshot(snapshot) {
  const seenAt = performance.now();
  if (netDebug.lastSnapshotAt > 0) {
    netDebug.intervals.push(seenAt - netDebug.lastSnapshotAt);
    if (netDebug.intervals.length > 48) {
      netDebug.intervals.shift();
    }
  }
  netDebug.lastSnapshotAt = seenAt;
  netDebug.snapshotCount += 1;

  const entities = [
    ...snapshot.players,
    ...snapshot.npcs,
    ...snapshot.food,
    ...snapshot.addons,
    ...(snapshot.hazards ?? [])
  ];
  if (snapshot.self?.alive === false) {
    entities.push(snapshot.self);
  }

  for (const entity of entities) {
    const key = renderKey(entity);
    const cached = state.renderEntities.get(key);
    if (!cached) {
      state.renderEntities.set(key, createRenderEntity(entity, seenAt));
      recordSighting(entity);
      continue;
    }

    // Interpolation window: the previous snapshot's state becomes the "from"
    // pose and the fresh one the target, replayed over the measured snapshot
    // gap. Chasing only the latest target instead turns any cadence
    // irregularity (network jitter, the 30 Hz tick vs 24 Hz broadcast beat)
    // straight into visible speed wobble.
    cached.data = entity;
    cached.fromX = cached.targetX;
    cached.fromY = cached.targetY;
    cached.fromRadius = cached.targetRadius;
    cached.fromHeading = cached.targetHeading;
    cached.targetX = entity.x;
    cached.targetY = entity.y;
    cached.targetRadius = entity.radius;
    cached.targetHeading = entity.heading ?? cached.targetHeading;
    cached.snapInterval = clamp(seenAt - cached.snapAt, 20, 250);
    cached.snapAt = seenAt;
    cached.lastSeenAt = seenAt;

    const jumpDistance = Math.hypot(cached.targetX - cached.x, cached.targetY - cached.y);
    if (jumpDistance > Math.max(700, cached.radius * 10)) {
      cached.x = cached.targetX;
      cached.y = cached.targetY;
      cached.radius = cached.targetRadius;
      cached.heading = cached.targetHeading;
      cached.fromX = cached.targetX;
      cached.fromY = cached.targetY;
      cached.fromRadius = cached.targetRadius;
      cached.fromHeading = cached.targetHeading;
      netDebug.hardSnaps += 1;
      netDebug.lastHardSnap = `${key} ${Math.round(jumpDistance)}u`;
      if (netDebug.enabled) {
        console.warn(`[net] hard snap: ${key} jumped ${Math.round(jumpDistance)} units`);
      }
    }
    recordSighting(entity);
  }
}

function createRenderEntity(entity, seenAt) {
  return {
    data: entity,
    x: entity.x,
    y: entity.y,
    radius: entity.radius,
    heading: entity.heading ?? 0,
    swim: 0,
    fromX: entity.x,
    fromY: entity.y,
    fromRadius: entity.radius,
    fromHeading: entity.heading ?? 0,
    targetX: entity.x,
    targetY: entity.y,
    targetRadius: entity.radius,
    targetHeading: entity.heading ?? 0,
    snapAt: seenAt,
    snapInterval: 50,
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
    // Replay the from→target pose over the measured snapshot gap, then chase
    // that moving point with a light exponential blend. The interpolation
    // supplies constant velocity between snapshots; the blend hides the brief
    // hold when a snapshot arrives late.
    const t = clamp01((now - entity.snapAt) / entity.snapInterval);
    const desiredX = entity.fromX + (entity.targetX - entity.fromX) * t;
    const desiredY = entity.fromY + (entity.targetY - entity.fromY) * t;
    const desiredRadius = entity.fromRadius + (entity.targetRadius - entity.fromRadius) * t;
    const desiredHeading = lerpAngle(entity.fromHeading, entity.targetHeading, t);

    // How hard the creature is swimming right now (0..1) — drives how much its
    // body works in the animation.
    const distanceToTarget = Math.hypot(entity.targetX - entity.x, entity.targetY - entity.y);
    entity.swim += (clamp01(distanceToTarget / Math.max(40, entity.radius * 1.4)) - entity.swim) * radiusSmoothing;

    entity.x += (desiredX - entity.x) * smoothing;
    entity.y += (desiredY - entity.y) * smoothing;
    entity.radius += (desiredRadius - entity.radius) * radiusSmoothing;
    entity.heading = lerpAngle(entity.heading, desiredHeading, smoothing);
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
    heading: cached.heading,
    swim: cached.swim
  };
}

function renderKey(entity) {
  return `${entity.kind}:${entity.id}`;
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
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#031b23");
  gradient.addColorStop(0.48, "#021018");
  gradient.addColorStop(1, "#000407");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#6bd7d1";
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
    ctx.globalAlpha = 0.14 + particle.depth * 0.26;
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

// How another creature relates to the local player, using the same diet rules
// the simulation eats with: "threat" (it can eat you — always flagged),
// "prey"/"standoff" (only for creatures big enough that relative size alone is
// ambiguous; flagging every edible minnow would wallpaper the screen). Null
// means no cue is drawn.
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
  return canConsume(self, entity) ? "prey" : "standoff";
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

function drawCreature(entity, now, isSelf) {
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

function getSpriteImage(sprite, onLoad) {
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

function spriteSourceRect(sprite, image, sourceIndex = sprite.index ?? 0) {
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

function setText(node, value) {
  // Avoid replacing identical text nodes 24×/s — a real saving on weak devices.
  if (node.textContent !== value) {
    node.textContent = value;
  }
}

function updateHud(snapshot) {
  const self = snapshot.self;
  if (self) {
    setText(massValue, self.mass.toLocaleString());
    setText(stageValue, self.stage);
    setText(addonValue, formatAddons(self));
    updateLocus(self);
    updateSpatialUi(self);
    deathBanner.hidden = !self.won && self.alive !== false;
    deathBanner.classList.toggle("is-victory", Boolean(self.won));
    if (self.won) {
      deathTitle.textContent = "Apex reached";
      deathDetail.textContent = `Final mass ${self.mass.toLocaleString()}`;
      connectionStatus.textContent = "Run complete";
    } else if (self.alive === false) {
      deathTitle.textContent = "Consumed";
      deathDetail.textContent = self.lastEatenBy ? `Eaten by ${self.lastEatenBy}` : "Returning to the bloom";
    } else if (state.connected && !state.gamePaused) {
      // No constant "Swimming" — the event feed carries the interesting news.
      connectionStatus.textContent = state.mode === "offline" ? "Offline · solo" : "";
    }
  }
  renderLeaderboard(snapshot.leaderboard);
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

const MAX_DEPTH_M = DEPTH_ZONES[DEPTH_ZONES.length - 1].max;
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

// Each ocean gets its own water colour, so the globe reads as real basins:
// swimming east carries you Atlantic → Arctic → Southern → Pacific and home.
const OCEAN_COLORS = {
  "Atlantic Ocean": "#1d5c8a",
  "Arctic Ocean": "#2b6f86",
  "Southern Ocean": "#3a5a86",
  "Pacific Ocean": "#155e6b",
  "Indian Ocean": "#1f6b7a"
};
const DEG = Math.PI / 180;

// The player's world x maps to a real longitude/latitude (see geoPositionAt),
// and the minimap is an orthographic globe centred on that point — so the
// player dot sits at the centre and the world literally turns beneath them as
// they swim. Region homes are plotted at their real coordinates; the ones on
// the near hemisphere are hoverable dots.
let projectedRegions = [];

function drawGlobe(worldX) {
  if (!minimapCtx) {
    return;
  }
  const size = minimapCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;
  const geo = geoPositionAt(worldX);
  const lon0 = geo.lon * DEG;
  const lat0 = geo.lat * DEG;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);

  const project = (latDeg, lonDeg) => {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const dLon = lon - lon0;
    const cosc = sinLat0 * Math.sin(lat) + cosLat0 * Math.cos(lat) * Math.cos(dLon);
    const px = Math.cos(lat) * Math.sin(dLon);
    const py = cosLat0 * Math.sin(lat) - sinLat0 * Math.cos(lat) * Math.cos(dLon);
    return { x: cx + radius * px, y: cy - radius * py, visible: cosc >= -0.02 };
  };

  minimapCtx.clearRect(0, 0, size, size);

  // Ocean sphere: a soft radial gradient reads as a lit globe. Tinted toward
  // the ocean the player is currently in.
  const currentRegion = REGIONS[regionIndexForGlobe(worldX)];
  const water = OCEAN_COLORS[currentRegion.ocean] ?? "#155e6b";
  const sphere = minimapCtx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.2, cx, cy, radius);
  sphere.addColorStop(0, blend(water, "#dffbff", 0.28));
  sphere.addColorStop(0.7, water);
  sphere.addColorStop(1, blend(water, "#02080c", 0.6));
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  minimapCtx.fillStyle = sphere;
  minimapCtx.fill();

  // Graticule (front hemisphere only) for a globe feel.
  minimapCtx.strokeStyle = "rgba(223, 251, 255, 0.14)";
  minimapCtx.lineWidth = 0.6;
  for (const lat of [-60, -30, 0, 30, 60]) {
    strokeArc(minimapCtx, (lon) => project(lat, lon), -180, 180, lat === 0 ? 0.22 : 0.14);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    strokeArc(minimapCtx, (lat) => project(lat, lon), -90, 90, 0.14);
  }

  // Region dots at their real coordinates.
  projectedRegions = [];
  for (let index = 0; index < REGIONS.length; index += 1) {
    const region = REGIONS[index];
    const point = project(region.lat, region.lon);
    projectedRegions.push({ region, x: point.x, y: point.y, visible: point.visible });
    if (!point.visible) {
      continue;
    }
    const isCurrent = region.id === currentRegion.id;
    const dotColor =
      region.danger >= 3 ? "#fb7185" : region.danger === 2 ? "#fbbf24" : "#5eead4";
    minimapCtx.beginPath();
    minimapCtx.arc(point.x, point.y, isCurrent ? 4.5 : 3, 0, Math.PI * 2);
    minimapCtx.fillStyle = dotColor;
    minimapCtx.fill();
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeStyle = "rgba(2, 8, 12, 0.7)";
    minimapCtx.stroke();
    if (isCurrent) {
      minimapCtx.beginPath();
      minimapCtx.arc(point.x, point.y, 7.5, 0, Math.PI * 2);
      minimapCtx.strokeStyle = "rgba(253, 230, 138, 0.9)";
      minimapCtx.lineWidth = 1.5;
      minimapCtx.stroke();
    }
  }

  // Limb outline on top so dots near the edge stay contained.
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  minimapCtx.strokeStyle = "rgba(223, 251, 255, 0.4)";
  minimapCtx.lineWidth = 1;
  minimapCtx.stroke();

  // Player marker at the centre (the globe is centred on them).
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#fde68a";
  minimapCtx.fill();
  minimapCtx.strokeStyle = "#02080c";
  minimapCtx.lineWidth = 1;
  minimapCtx.stroke();
}

// Local mirror of geography.regionIndexAt (client keeps geography's REGIONS but
// not its private helpers).
function regionIndexForGlobe(worldX) {
  return REGIONS.indexOf(regionAtGlobe(worldX));
}

function regionAtGlobe(worldX) {
  const cell = 9000 * REGIONS.length;
  const wrapped = ((worldX % cell) + cell) % cell;
  return REGIONS[Math.floor(wrapped / 9000)];
}

// Stroke a projected great-circle arc, lifting the pen when it passes behind
// the globe so only the visible hemisphere is drawn.
function strokeArc(context, projectAt, from, to, alpha) {
  context.save();
  context.globalAlpha = alpha / 0.22; // keep the equator a touch brighter
  context.beginPath();
  let drawing = false;
  for (let t = from; t <= to; t += 6) {
    const point = projectAt(t);
    if (point.visible) {
      if (drawing) {
        context.lineTo(point.x, point.y);
      } else {
        context.moveTo(point.x, point.y);
        drawing = true;
      }
    } else {
      drawing = false;
    }
  }
  context.stroke();
  context.restore();
}

// Hover on the globe: report the nearest near-side region dot under the cursor.
function updateRegionTip(clientX, clientY) {
  if (!regionTip || !minimapCanvas) {
    return;
  }
  const rect = minimapCanvas.getBoundingClientRect();
  const scaleX = minimapCanvas.width / rect.width;
  const scaleY = minimapCanvas.height / rect.height;
  const localX = (clientX - rect.left) * scaleX;
  const localY = (clientY - rect.top) * scaleY;

  let best = null;
  let bestDistance = 11;
  for (const dot of projectedRegions) {
    if (!dot.visible) {
      continue;
    }
    const distance = Math.hypot(dot.x - localX, dot.y - localY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dot.region;
    }
  }

  if (!best) {
    regionTip.hidden = true;
    return;
  }

  const species = signatureSpeciesForRegion(best.id, 4)
    .map((entry) => entry.name)
    .join(", ");
  regionTip.replaceChildren();
  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = best.name + dangerPips(best);
  const meta = document.createElement("div");
  meta.className = "tip-detail";
  meta.textContent = `${best.ocean} · ${dangerWord(best)}`;
  regionTip.append(title, meta);
  if (species) {
    const life = document.createElement("div");
    life.className = "tip-detail";
    life.textContent = species;
    regionTip.append(life);
  }
  regionTip.hidden = false;
  const tipRect = regionTip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - tipRect.height - 10;
  if (left + tipRect.width > width - 8) {
    left = clientX - tipRect.width - 14;
  }
  if (top < 8) {
    top = clientY + 14;
  }
  regionTip.style.left = `${Math.max(8, left)}px`;
  regionTip.style.top = `${Math.max(8, top)}px`;
}

function dangerWord(region) {
  const danger = region.danger ?? 1;
  return danger >= 3 ? "perilous waters" : danger === 2 ? "open hunting" : "calm nursery";
}

// Danger pips after a sea's name: nothing for calm seas, ⚠/⚠⚠ for waters that
// breed bigger creatures — readable long before you learn it the hard way.
function dangerPips(region) {
  const danger = region.danger ?? 1;
  return danger > 1 ? ` ${"⚠".repeat(danger - 1)}` : "";
}

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
let speciesLogDirty = true;
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

function recordSighting(entity) {
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

function recordEatenSpecies(creatureId) {
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

function updateSpeciesLogButton() {
  if (speciesLogCount) {
    setText(speciesLogCount, `${Object.keys(speciesLog.species).length}/${SPOTTABLE_SPECIES.length}`);
  }
}

function toggleSpeciesLog() {
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

function renderSpeciesLog() {
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

function formatAddons(self) {
  if (self.won) {
    return "Complete";
  }
  const names = self.addons?.map((addon) => ADDON_CATALOG[addon.addonId]?.name).filter(Boolean) ?? [];
  if (self.shieldCharges > 0) {
    names.push(`Shield ${self.shieldCharges}`);
  }
  return names.length ? names.slice(0, 3).join(", ") : "None";
}

// The board changes slowly, so only rebuild its DOM when the entries actually
// change instead of 24×/second — cuts a lot of layout churn on weak hardware.
let lastLeaderboardSignature = "";
function renderLeaderboard(leaderboard) {
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

function handleEvents(events) {
  let victoryEvent = null;
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
    } else if (event.type === "player_won") {
      victoryEvent = event;
    }
  }
  if (victoryEvent) {
    pushFeed(
      victoryEvent.playerId === state.playerId ? "Apex reached" : `${victoryEvent.playerName} reached the apex`,
      "grow",
      6000
    );
  }
}

function showToast(message) {
  pushFeed(message, "info", 2600);
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

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 1000;
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
