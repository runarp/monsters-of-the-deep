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

  function persist() {
    if (!playerId) {
      return;
    }
    const player = world.players.get(playerId);
    if (!player || !player.alive) {
      return;
    }
    saveRun({
      name: player.name,
      creatureId: player.creatureId,
      mass: Math.round(player.mass),
      score: player.score,
      eatenCount: player.eatenCount,
      savedAt: Date.now()
    });
  }

  function startLoops() {
    if (tickTimer) {
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
    stop() {
      clearInterval(tickTimer);
      clearInterval(broadcastTimer);
      clearInterval(saveTimer);
      tickTimer = null;
      broadcastTimer = null;
      saveTimer = null;
      persist();
    }
  };
}
