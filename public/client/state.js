import { PLAYABLE_CREATURE_IDS } from "/shared/creatureCatalog.js";

export const state = {
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
  food: new Map(),
  assetImages: new Map(),
  world: { endless: true, radius: null },
  camera: { x: 0, y: 0, scale: 0.8, userZoom: 1 },
  keys: new Set(),
  moveScheme: "wasd",
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false, down: false, isMouse: false },
  touchBoost: false,
  toastUntil: 0,
  lastInputAt: 0,
  lastSentInput: null,
  lastSentInputAt: 0,
  reconnectTimer: null,
  onlineAttempts: 0,
  unloading: false,
  gamePaused: false
};

// Network/render diagnostics for chasing jittery motion. Toggle with the `
// (backquote) key or load with ?debug. Tracks the snapshot cadence (interval
// avg/min/max — irregular gaps are what read as jitter), hard position snaps
// (rubber-banding), fps, and round-trip ping while enabled.
export const netDebug = {
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

// Canvas size in CSS pixels and the backing-store ratio, updated by resize().
export const viewport = { width: 0, height: 0, dpr: 1 };

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
