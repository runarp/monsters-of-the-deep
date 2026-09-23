import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { PLAYABLE_CREATURE_IDS, publicCreatureCatalog } from "../shared/creatureCatalog.js";
import { GameWorld, PROTOCOL_VERSION, isValidPlayerName, sanitizeName } from "../shared/gameWorld.js";
import { loadLeaderboard, saveLeaderboard } from "./leaderboardStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SHARED_DIR = path.join(ROOT_DIR, "src/shared");

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
});

// Client messages are tiny (a join is a few hundred bytes); ws would otherwise
// buffer up to 100 MiB per message before we ever see it.
const MAX_MESSAGE_BYTES = 4096;
// Per-socket message budget per second, comfortably above what the real client
// sends. Past the soft limit messages are dropped; a socket that floods far
// past it is disconnected.
const MESSAGE_SOFT_LIMIT = 120;
const MESSAGE_HARD_LIMIT = 600;

export function createGameServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? "0.0.0.0";
  const world = options.world ?? new GameWorld(options.worldOptions);
  const tickRate = options.tickRate ?? 30;
  const broadcastRate = options.broadcastRate ?? 24;
  // HTTP-only mode hosts the static client without a live world, so the browser
  // can't open a socket and auto-falls back to the local offline solo game.
  const enableWebSocket = options.enableWebSocket !== false;
  // When set, the server-wide high scores are loaded on start and saved
  // periodically + on shutdown, so they survive restarts and deploys.
  const leaderboardFile = options.leaderboardFile ?? null;
  const leaderboardSaveMs = options.leaderboardSaveMs ?? 30_000;
  const clients = new Map();
  // Fingerprint of the served files, stamped into sw.js so every deploy
  // installs a fresh service worker (and precache) without a manual bump.
  const buildId = computeBuildId().catch(() => "unversioned");
  const sessions = createSessionKeeper(world, options.disconnectGraceMs ?? DISCONNECT_GRACE_MS);

  const server = createHttpServer((request, response) => {
    serveHttp(request, response, world, buildId).catch((error) => {
      console.error(error);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal server error");
    });
  });
  // Snapshots are repetitive JSON and compress ~5×; level 1 keeps the CPU
  // cost per broadcast small.
  const wss = enableWebSocket
    ? new WebSocketServer({
        server,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 1024 }
      })
    : null;

  let tickInterval = null;
  let broadcastInterval = null;
  let heartbeatInterval = null;
  let leaderboardInterval = null;

  async function persistLeaderboard() {
    if (!leaderboardFile) {
      return;
    }
    try {
      await saveLeaderboard(leaderboardFile, world.exportLeaderboard());
    } catch (error) {
      console.error("Failed to save leaderboard:", error);
    }
  }

  wss?.on("connection", (socket) => {
    const client = { playerId: null, sessionId: null, view: null, windowStart: 0, windowCount: 0 };
    socket.isAlive = true;
    clients.set(socket, client);
    send(socket, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      world: worldInfo(world),
      catalog: publicCreatureCatalog(),
      leaderboard: world.getLeaderboard()
    });

    socket.on("message", (raw) => {
      const allowance = messageAllowance(client, Date.now());
      if (allowance === "drop") {
        return;
      }
      if (allowance === "close") {
        socket.close(1008, "rate limit");
        return;
      }
      handleSocketMessage({ socket, raw, client, world, clients, sessions });
    });

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      releaseClient(socket, client, clients, sessions);
    });

    socket.on("error", () => {
      releaseClient(socket, client, clients, sessions);
    });
  });

  function tick() {
    world.tick(1000 / tickRate);
  }

  function broadcast() {
    const events = world.drainEvents();
    for (const [socket, client] of clients.entries()) {
      if (socket.readyState !== WebSocket.OPEN || !client.playerId) {
        continue;
      }
      const snapshot = world.getSnapshot(client.playerId, client.view);
      const ownEvents = world.eventsFor(events, client.playerId);
      if (ownEvents.length > 0) {
        snapshot.events = ownEvents;
      }
      send(socket, snapshot);
    }
  }

  function heartbeat() {
    for (const [socket, client] of clients.entries()) {
      if (socket.isAlive === false) {
        releaseClient(socket, client, clients, sessions);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }

  return {
    server,
    wss,
    world,
    clients,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, async () => {
          server.off("error", reject);
          if (leaderboardFile) {
            try {
              world.importLeaderboard(await loadLeaderboard(leaderboardFile));
            } catch (error) {
              console.error("Failed to load leaderboard:", error);
            }
            leaderboardInterval = setInterval(() => {
              persistLeaderboard();
            }, leaderboardSaveMs);
          }
          if (enableWebSocket) {
            tickInterval = setInterval(tick, 1000 / tickRate);
            broadcastInterval = setInterval(broadcast, 1000 / broadcastRate);
            heartbeatInterval = setInterval(heartbeat, 15000);
          }
          resolve(this);
        });
      });
    },
    async stop() {
      clearInterval(tickInterval);
      clearInterval(broadcastInterval);
      clearInterval(heartbeatInterval);
      clearInterval(leaderboardInterval);
      sessions.clear();
      await persistLeaderboard();
      const closeHttp = () =>
        new Promise((resolve, reject) => {
          server.close((serverError) => (serverError ? reject(serverError) : resolve()));
        });
      if (!wss) {
        return closeHttp();
      }
      for (const socket of wss.clients) {
        socket.close();
      }
      return new Promise((resolve, reject) => {
        wss.close((webSocketError) => (webSocketError ? reject(webSocketError) : resolve(closeHttp())));
      });
    },
    address() {
      return server.address();
    }
  };
}

function handleSocketMessage({ socket, raw, client, world, clients, sessions }) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    send(socket, { type: "error", message: "Invalid JSON message." });
    return;
  }

  if (message.type === "join") {
    const creatureId = PLAYABLE_CREATURE_IDS.includes(message.creatureId)
      ? message.creatureId
      : PLAYABLE_CREATURE_IDS[0];
    const sessionId = sanitizeSessionId(message.sessionId);
    const name = sanitizeName(message.name);

    if (!isValidPlayerName(name)) {
      send(socket, {
        type: "error",
        code: "invalid_name",
        message: "Enter a name to join."
      });
      return;
    }

    replaceExistingSession({ socket, sessionId, clients, sessions });

    if (client.playerId) {
      world.removePlayer(client.playerId);
      client.playerId = null;
    }

    client.sessionId = sessionId;
    // A session that dropped moments ago gets its creature back — size,
    // add-ons and all — as long as it rejoins as the same creature. Picking a
    // different creature is a deliberate fresh start.
    let player = sessions.reclaim(sessionId);
    const reconnected = Boolean(player && player.creatureId === creatureId);
    if (player && !reconnected) {
      world.removePlayer(player.id);
    }
    if (reconnected) {
      player.name = name;
    } else {
      player = world.addPlayer({
        name,
        creatureId,
        leaderboardId: sessionId
      });
    }
    client.playerId = player.id;
    // Delta snapshots only for clients that can read them — a stale cached
    // client sends no protocol and keeps getting full snapshots.
    client.view = Number(message.protocol) >= 2 ? world.createViewState() : null;
    send(socket, {
      type: "welcome",
      playerId: player.id,
      world: worldInfo(world),
      catalog: publicCreatureCatalog(),
      leaderboard: world.getLeaderboard(),
      reconnected,
      reconnectedMass: reconnected ? Math.round(player.mass) : null
    });
    return;
  }

  if (message.type === "input") {
    if (!client.playerId) {
      return;
    }
    world.setPlayerInput(client.playerId, {
      x: message.x,
      y: message.y,
      boost: message.boost
    });
    return;
  }

  if (message.type === "ping") {
    send(socket, { type: "pong", now: Date.now() });
  }
}

function messageAllowance(client, now) {
  if (now - client.windowStart >= 1000) {
    client.windowStart = now;
    client.windowCount = 0;
  }
  client.windowCount += 1;
  if (client.windowCount > MESSAGE_HARD_LIMIT) {
    return "close";
  }
  return client.windowCount > MESSAGE_SOFT_LIMIT ? "drop" : "ok";
}

// The same session joining from a new socket usually means the old one died
// and the server hasn't noticed yet (half-open TCP after a network blip), so
// its creature is handed over for reclaiming rather than thrown away.
function replaceExistingSession({ socket, sessionId, clients, sessions }) {
  for (const [otherSocket, otherClient] of clients.entries()) {
    if (otherSocket === socket || otherClient.sessionId !== sessionId) {
      continue;
    }
    releaseClient(otherSocket, otherClient, clients, sessions);
    otherSocket.close(4001, "session replaced");
  }
}

function releaseClient(socket, client, clients, sessions) {
  clients.delete(socket);
  if (client.playerId) {
    sessions.detach(client.sessionId, client.playerId);
    client.playerId = null;
  }
}

// How long a disconnected player's creature waits in the world for its
// session to come back. It stops swimming and stays vulnerable meanwhile, so
// dropping the connection is never a way to dodge a predator.
const DISCONNECT_GRACE_MS = 15_000;

function createSessionKeeper(world, graceMs) {
  const detached = new Map();

  function expire(sessionId) {
    const entry = detached.get(sessionId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    detached.delete(sessionId);
    world.removePlayer(entry.playerId);
  }

  return {
    detach(sessionId, playerId) {
      if (!sessionId || graceMs <= 0) {
        world.removePlayer(playerId);
        return;
      }
      expire(sessionId);
      world.setPlayerInput(playerId, { x: 0, y: 0, boost: false });
      const player = world.players.get(playerId);
      if (player) {
        // Bank the score now, as removePlayer would have, so the board other
        // clients see doesn't wait on the grace period.
        world.recordLeaderboardScore(player);
      }
      const timer = setTimeout(() => expire(sessionId), graceMs);
      timer.unref?.();
      detached.set(sessionId, { playerId, timer });
    },
    reclaim(sessionId) {
      const entry = detached.get(sessionId);
      if (!entry) {
        return null;
      }
      clearTimeout(entry.timer);
      detached.delete(sessionId);
      return world.players.get(entry.playerId) ?? null;
    },
    clear() {
      for (const sessionId of [...detached.keys()]) {
        expire(sessionId);
      }
    }
  };
}

function sanitizeSessionId(value) {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return cleaned || randomUUID();
}

async function serveHttp(request, response, world, buildId) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        ok: true,
        endless: world.endless,
        players: world.players.size,
        npcs: world.npcs.size,
        food: world.food.size,
        addons: world.addons.size,
        hazards: world.hazards.size
      })
    );
    return;
  }

  const target = resolveStaticPath(requestUrl.pathname);
  if (!target) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fs.stat(target.filePath);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (!stat.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const contentType = MIME_TYPES[path.extname(target.filePath)] ?? "application/octet-stream";
  if (target.filePath === SERVICE_WORKER_PATH) {
    const source = await fs.readFile(target.filePath, "utf8");
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(source.replaceAll("__BUILD_ID__", await buildId));
    return;
  }

  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  createReadStream(target.filePath).pipe(response);
}

function resolveStaticPath(urlPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (pathname === "/") {
    return { filePath: path.join(PUBLIC_DIR, "index.html") };
  }

  if (pathname.startsWith("/shared/")) {
    return confineTo(SHARED_DIR, pathname.slice("/shared/".length));
  }
  return confineTo(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
}

// A bare startsWith(dir) would also admit sibling folders that merely share
// the prefix (public → public-backup), so require the separator.
function confineTo(directory, relativePath) {
  const filePath = path.resolve(directory, relativePath);
  if (filePath !== directory && !filePath.startsWith(directory + path.sep)) {
    return null;
  }
  return { filePath };
}

const SERVICE_WORKER_PATH = path.join(PUBLIC_DIR, "sw.js");

async function computeBuildId() {
  const hash = createHash("sha1");
  for (const directory of [PUBLIC_DIR, SHARED_DIR]) {
    const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
      .sort();
    for (const file of files) {
      const stat = await fs.stat(file);
      hash.update(`${path.relative(ROOT_DIR, file)}:${stat.size}:${stat.mtimeMs}\n`);
    }
  }
  return hash.digest("hex").slice(0, 12);
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function worldInfo(world) {
  return {
    endless: world.endless,
    radius: world.endless ? null : world.radius
  };
}
