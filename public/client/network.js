import { PROTOCOL_VERSION } from "/shared/gameWorld.js";
import { createLocalSession } from "/localGame.js";
import { connectionStatus, joinModal, pauseBanner, playerNameInput } from "./dom.js";
import { ingestSnapshot } from "./entities.js";
import { handleEvents, renderLeaderboard, showToast, updateHud } from "./hud.js";
import { resetTouchInput, setZoomControlVisible } from "./input.js";
import { isValidNameInput, sanitizedNameInput, updateJoinState } from "./menu.js";
import { netDebug, state } from "./state.js";

// Fall back to the offline solo game only after the online server has genuinely
// failed to answer several times — a slow first handshake (TLS on a school
// Chromebook, a server cold-start) must not strand a connected player in solo.
const MAX_ONLINE_ATTEMPTS = 4;

const ONLINE_HANG_TIMEOUT_MS = 6000;

export function connect() {
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
    if (reloadIfOutdated(message.protocol)) {
      return;
    }
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
    state.food.clear();
    state.lastSentInput = null;
    state.playerId = message.playerId;
    state.world = message.world;
    state.joined = true;
    state.lastInputAt = performance.now();
    joinModal.hidden = true;
    // A session that paused before the join (e.g. opened in a background tab)
    // must still say so, or the frozen HUD reads as a broken game.
    if (pauseBanner && state.gamePaused) {
      pauseBanner.hidden = false;
    }
    setZoomControlVisible(true);
    connectionStatus.textContent = state.mode === "offline" ? "Offline · solo" : "Swimming";
    renderLeaderboard(message.leaderboard ?? []);
    if (message.resumed) {
      showToast(`Resumed solo run (mass ${message.resumedMass})`);
    }
    if (message.reconnected) {
      showToast(`Reconnected · mass ${message.reconnectedMass.toLocaleString()}`);
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
    applyFoodDelta(message);
    state.snapshot = message;
    state.world = message.world;
    ingestSnapshot(message);
    if (message.events) {
      handleEvents(message.events);
    }
    updateHud(message);
  }
}

// Snapshots stream food as changes against what this connection has already
// been sent (see GameWorld.createViewState). Rebuild the full visible list here
// so everything downstream still sees a plain `snapshot.food` array.
function applyFoodDelta(snapshot) {
  if (snapshot.foodKeyframe) {
    state.food.clear();
  }
  if (snapshot.food && !snapshot.foodKeyframe) {
    // Undelta'd snapshot: the list is already complete.
    return;
  }
  for (const food of snapshot.food ?? []) {
    state.food.set(food.id, food);
  }
  for (const food of snapshot.foodAdded ?? []) {
    state.food.set(food.id, food);
  }
  for (const [id, x, y] of snapshot.foodMoved ?? []) {
    const food = state.food.get(id);
    if (food) {
      state.food.set(id, { ...food, x, y });
    }
  }
  for (const id of snapshot.foodRemoved ?? []) {
    state.food.delete(id);
  }
  snapshot.food = [...state.food.values()];
}

// A server that speaks a newer protocol means this page is a stale cached
// client. Refresh the service worker and reload — once per protocol, so a
// server/client mismatch can never become a reload loop.
function reloadIfOutdated(serverProtocol) {
  if (!Number.isFinite(serverProtocol) || serverProtocol <= PROTOCOL_VERSION) {
    return false;
  }
  const key = "monstersOfTheDeep.reloadedForProtocol";
  try {
    if (window.sessionStorage.getItem(key) === String(serverProtocol)) {
      return false;
    }
    window.sessionStorage.setItem(key, String(serverProtocol));
  } catch {
    return false;
  }
  connectionStatus.textContent = "Updating";
  const update = navigator.serviceWorker?.getRegistration?.().then((registration) => registration?.update());
  Promise.resolve(update)
    .catch(() => {})
    .finally(() => window.location.reload());
  return true;
}

export function transportSend(message) {
  if (state.mode === "offline") {
    state.local?.send(message);
    return;
  }
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
  }
}

export function transportReady() {
  if (state.mode === "offline") {
    return Boolean(state.local);
  }
  return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline precaching is a progressive enhancement; ignore failures.
    });
  });
}

export function joinGame() {
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
    protocol: PROTOCOL_VERSION,
    sessionId: state.sessionId,
    name: sanitizedNameInput(),
    creatureId: state.selectedCreatureId
  });
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
