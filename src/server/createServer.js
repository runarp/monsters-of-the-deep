import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { PLAYABLE_CREATURE_IDS, publicCreatureCatalog } from "../shared/creatureCatalog.js";
import { GameWorld, isValidPlayerName, sanitizeName } from "../shared/gameWorld.js";
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

  const server = createHttpServer((request, response) => {
    serveHttp(request, response, world).catch((error) => {
      console.error(error);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal server error");
    });
  });
  const wss = enableWebSocket ? new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES }) : null;

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
    const client = { playerId: null, sessionId: null, windowStart: 0, windowCount: 0 };
    socket.isAlive = true;
    clients.set(socket, client);
    send(socket, {
      type: "hello",
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
      handleSocketMessage({ socket, raw, client, world, clients });
    });

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      if (client.playerId) {
        world.removePlayer(client.playerId);
      }
      clients.delete(socket);
    });

    socket.on("error", () => {
      if (client.playerId) {
        world.removePlayer(client.playerId);
      }
      clients.delete(socket);
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
      const snapshot = world.getSnapshot(client.playerId);
      if (events.length > 0) {
        snapshot.events = events;
      }
      send(socket, snapshot);
    }
  }

  function heartbeat() {
    for (const [socket, client] of clients.entries()) {
      if (socket.isAlive === false) {
        if (client.playerId) {
          world.removePlayer(client.playerId);
        }
        clients.delete(socket);
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

function handleSocketMessage({ socket, raw, client, world, clients }) {
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

    replaceExistingSession({ socket, sessionId, clients, world });

    if (client.playerId) {
      world.removePlayer(client.playerId);
    }

    client.sessionId = sessionId;
    const player = world.addPlayer({
      name,
      creatureId,
      leaderboardId: sessionId
    });
    client.playerId = player.id;
    send(socket, {
      type: "welcome",
      playerId: player.id,
      world: worldInfo(world),
      catalog: publicCreatureCatalog(),
      leaderboard: world.getLeaderboard()
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

function replaceExistingSession({ socket, sessionId, clients, world }) {
  for (const [otherSocket, otherClient] of clients.entries()) {
    if (otherSocket === socket || otherClient.sessionId !== sessionId) {
      continue;
    }
    if (otherClient.playerId) {
      world.removePlayer(otherClient.playerId);
      otherClient.playerId = null;
    }
    clients.delete(otherSocket);
    otherSocket.close(4001, "session replaced");
  }
}

function sanitizeSessionId(value) {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return cleaned || randomUUID();
}

async function serveHttp(request, response, world) {
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

  response.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(target.filePath)] ?? "application/octet-stream",
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
