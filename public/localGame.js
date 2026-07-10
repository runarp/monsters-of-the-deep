import { radiusForCreature } from "/shared/creatureCatalog.js";
import { GameWorld } from "/shared/gameWorld.js";

const SAVE_KEY = "monstersOfTheDeep.solo";

export function loadSavedRun() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data.mass !== "number" || typeof data.creatureId !== "string") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearSavedRun() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function saveRun(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage failures.
  }
}

// Runs the shared GameWorld entirely in the browser and speaks the same message
// shapes the WebSocket server does, so the renderer cannot tell them apart.
export function createLocalSession({ onMessage, resume = true } = {}) {
  const world = new GameWorld({ endless: true });
  const tickRate = 30;
  const broadcastRate = 24;
  let playerId = null;
  let tickTimer = null;
  let broadcastTimer = null;
  let saveTimer = null;

  function worldInfo() {
    return { endless: world.endless, radius: world.endless ? null : world.radius };
  }

  // The save is a high-water checkpoint: a run with the same creature never
  // shrinks it, so dying (especially unattended, where respawning at base mass
  // used to overwrite the save within 2s) can't wipe progress. Picking a
  // different creature starts a fresh checkpoint; the Clear Save button is the
  // explicit reset.
  function persist() {
    if (!playerId) {
      return;
    }
    const player = world.players.get(playerId);
    if (!player || !player.alive) {
      return;
    }
    const saved = loadSavedRun();
    const sameRun = saved && saved.creatureId === player.creatureId;
    saveRun({
      name: player.name,
      creatureId: player.creatureId,
      mass: Math.round(sameRun ? Math.max(saved.mass, player.mass) : player.mass),
      score: sameRun ? Math.max(saved.score ?? 0, player.score) : player.score,
      eatenCount: sameRun ? Math.max(saved.eatenCount ?? 0, player.eatenCount) : player.eatenCount,
      savedAt: Date.now()
    });
  }

  function startLoops() {
    if (tickTimer || pauseReasons.size > 0) {
      return;
    }
    tickTimer = setInterval(() => world.tick(1000 / tickRate), 1000 / tickRate);
    broadcastTimer = setInterval(() => {
      if (!playerId) {
        return;
      }
      const snapshot = world.getSnapshot(playerId);
      const events = world.drainEvents();
      if (events.length > 0) {
        snapshot.events = events;
      }
      onMessage(snapshot);
    }, 1000 / broadcastRate);
    saveTimer = setInterval(persist, 2000);
  }

  function stopLoops() {
    clearInterval(tickTimer);
    clearInterval(broadcastTimer);
    clearInterval(saveTimer);
    tickTimer = null;
    broadcastTimer = null;
    saveTimer = null;
  }

  // The world freezes while any pause reason is held ("hidden" when the tab is
  // backgrounded, "idle" when the client reports no user input) so a creature
  // left unattended can't be eaten. Progress is persisted at the moment of
  // pausing.
  const pauseReasons = new Set();

  function setPauseReason(reason, value) {
    const wasPaused = pauseReasons.size > 0;
    if (value) {
      pauseReasons.add(reason);
    } else {
      pauseReasons.delete(reason);
    }
    const isPaused = pauseReasons.size > 0;
    if (isPaused === wasPaused) {
      return;
    }
    if (isPaused) {
      persist();
      stopLoops();
      onMessage({ type: "paused" });
    } else {
      if (playerId) {
        startLoops();
      }
      onMessage({ type: "resumed" });
    }
  }

  function handleVisibilityChange() {
    setPauseReason("hidden", document.visibilityState === "hidden");
  }

  function handleFreeze() {
    setPauseReason("hidden", true);
    persist();
  }

  function handleResume() {
    setPauseReason("hidden", document.visibilityState === "hidden");
  }

  function handlePageShow() {
    setPauseReason("hidden", document.visibilityState === "hidden");
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  // pagehide fires on tab close and mobile/PWA app-switch, where beforeunload
  // often doesn't; persist directly so the checkpoint survives abrupt exits.
  window.addEventListener("pagehide", persist);
  // Safari/iPadOS Page Lifecycle: freeze can arrive without a final tick.
  document.addEventListener("freeze", handleFreeze);
  document.addEventListener("resume", handleResume);
  // BFCache restore: visibility may already be "visible" but loops were stopped.
  window.addEventListener("pageshow", handlePageShow);
  setPauseReason("hidden", document.visibilityState === "hidden");

  function handleJoin(message) {
    if (playerId) {
      world.removePlayer(playerId);
    }
    const player = world.addPlayer({
      name: message.name,
      creatureId: message.creatureId,
      leaderboardId: message.sessionId
    });
    playerId = player.id;

    const saved = resume ? loadSavedRun() : null;
    let resumed = false;
    if (saved && saved.creatureId === player.creatureId && saved.mass > player.mass) {
      player.mass = saved.mass;
      player.radius = radiusForCreature(player.creatureId, player.mass);
      player.score = Math.max(player.score, saved.score ?? 0);
      player.eatenCount = saved.eatenCount ?? player.eatenCount;
      resumed = true;
    }

    onMessage({
      type: "welcome",
      playerId,
      world: worldInfo(),
      leaderboard: world.getLeaderboard(),
      resumed,
      resumedMass: resumed ? Math.round(player.mass) : null
    });
    startLoops();
  }

  // Mirror the server's initial greeting.
  onMessage({ type: "hello", world: worldInfo(), leaderboard: world.getLeaderboard() });

  return {
    mode: "offline",
    send(message) {
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (message.type === "join") {
        handleJoin(message);
      } else if (message.type === "input" && playerId) {
        world.setPlayerInput(playerId, message);
      }
    },
    // Client-driven pause for idle detection; the session handles tab
    // visibility itself.
    setPaused(value) {
      setPauseReason("idle", Boolean(value));
    },
    stop() {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("freeze", handleFreeze);
      document.removeEventListener("resume", handleResume);
      window.removeEventListener("pageshow", handlePageShow);
      stopLoops();
      persist();
    }
  };
}
