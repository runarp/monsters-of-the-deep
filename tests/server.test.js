import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { WebSocket } from "ws";
import { createGameServer } from "../src/server/createServer.js";

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.stop();
  }
});

describe("game server", () => {
  test("serves the browser client and health endpoint", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Monsters of the Deep/);

    const atlas = await fetch(`http://127.0.0.1:${port}/assets/creatures/scary-creature-atlas.webp`);
    assert.equal(atlas.status, 200);
    assert.equal(atlas.headers.get("content-type"), "image/webp");
  });

  test("accepts WebSocket joins and emits snapshots", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const helloPromise = waitForMessage(socket, (message) => message.type === "hello");

    await once(socket, "open");
    const hello = await helloPromise;
    assert.equal(hello.world.radius, 1200);

    socket.send(
      JSON.stringify({
        type: "join",
        name: "Socket Diver",
        creatureId: "glass_kraken"
      })
    );

    const welcome = await waitForMessage(socket, (message) => message.type === "welcome");
    assert.equal(typeof welcome.playerId, "string");
    assert.ok(welcome.catalog.playable.length >= 10);
    assert.ok(welcome.catalog.playable.some((creature) => creature.id === "katulu"));

    socket.send(JSON.stringify({ type: "input", x: 1, y: 0, boost: false }));
    const snapshot = await waitForMessage(socket, (message) => message.type === "snapshot");

    assert.equal(snapshot.playerId, welcome.playerId);
    assert.equal(snapshot.self.name, "Socket Diver");
    assert.equal(snapshot.players.some((player) => player.id === welcome.playerId), true);

    socket.close();
    await once(socket, "close");
  });

  test("rejects blank player names", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const helloPromise = waitForMessage(socket, (message) => message.type === "hello");

    await once(socket, "open");
    await helloPromise;
    socket.send(JSON.stringify({ type: "join", name: "   !!!   ", creatureId: "katulu" }));

    const error = await waitForMessage(socket, (message) => message.type === "error");
    assert.equal(error.code, "invalid_name");
    assert.equal(gameServer.world.players.size, 0);

    socket.close();
    await once(socket, "close");
  });

  test("shares leaderboard scores with future connections after disconnect", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    const firstHello = waitForMessage(firstSocket, (message) => message.type === "hello");

    await once(firstSocket, "open");
    await firstHello;
    firstSocket.send(
      JSON.stringify({
        type: "join",
        sessionId: "leaderboard-session",
        name: "Shared Score",
        creatureId: "katulu"
      })
    );
    const welcome = await waitForMessage(firstSocket, (message) => message.type === "welcome");
    const player = gameServer.world.players.get(welcome.playerId);
    player.score = 1800;
    player.mass = 180;

    firstSocket.close();
    await once(firstSocket, "close");

    const secondSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    const secondHello = waitForMessage(secondSocket, (message) => message.type === "hello");
    await once(secondSocket, "open");
    const hello = await secondHello;

    assert.equal(
      hello.leaderboard.some((entry) => entry.name === "Shared Score" && entry.score === 1800),
      true
    );

    secondSocket.close();
    await once(secondSocket, "close");
  });

  test("persists the leaderboard to disk across a restart", async () => {
    const file = path.join(os.tmpdir(), `motd-leaderboard-${process.pid}-${servers.length}-test.json`);
    await fs.rm(file, { force: true });

    try {
      const first = await startTestServer({ leaderboardFile: file });
      const player = first.world.addPlayer({
        name: "Trench Champ",
        creatureId: "katulu",
        leaderboardId: "champ-session"
      });
      player.score = 7200;
      player.mass = 480;
      first.world.updateScores();
      await first.stop();
      servers.pop(); // already stopped

      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      assert.ok(saved.entries.some((entry) => entry.id === "champ-session" && entry.score === 7200));

      // A fresh server (simulating a redeploy) loads the saved scores.
      const restarted = await startTestServer({ leaderboardFile: file });
      const board = restarted.world.getLeaderboard(10);
      assert.equal(
        board.some((entry) => entry.name === "Trench Champ" && entry.score === 7200),
        true
      );
    } finally {
      await fs.rm(file, { force: true });
    }
  });

  test("stamps the service worker with a build id", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const response = await fetch(`http://127.0.0.1:${port}/sw.js`);
    assert.equal(response.status, 200);
    const source = await response.text();
    assert.equal(source.includes("__BUILD_ID__"), false);
    assert.match(source, /CACHE_VERSION = "motd-v\d+-[0-9a-f]{12}"/);
  });

  test("only clients that declare protocol 2 get delta snapshots", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();

    const modern = new WebSocket(`ws://127.0.0.1:${port}`);
    const hello = await waitForMessage(modern, (message) => message.type === "hello");
    assert.equal(hello.protocol, 2);
    modern.send(JSON.stringify({ type: "join", protocol: 2, sessionId: "modern", name: "Modern", creatureId: "katulu" }));
    const modernSnapshot = await waitForMessage(modern, (message) => message.type === "snapshot");
    assert.equal(modernSnapshot.foodKeyframe, true);

    // A stale cached client from before deltas: no protocol in its join.
    const legacy = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(legacy, "open");
    legacy.send(JSON.stringify({ type: "join", sessionId: "legacy", name: "Legacy", creatureId: "katulu" }));
    await waitForMessage(legacy, (message) => message.type === "welcome");
    const first = await waitForMessage(legacy, (message) => message.type === "snapshot");
    const second = await waitForMessage(legacy, (message) => message.type === "snapshot");
    for (const snapshot of [first, second]) {
      assert.ok(Array.isArray(snapshot.food));
      assert.equal(snapshot.foodKeyframe, undefined);
      assert.ok(Array.isArray(snapshot.leaderboard));
    }

    modern.close();
    legacy.close();
    await Promise.all([once(modern, "close"), once(legacy, "close")]);
  });

  test("refuses paths outside the served folders and malformed URLs", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    for (const target of ["/..%2fpackage.json", "/shared/..%2f..%2fpackage.json", "/%E0%A4%A"]) {
      const response = await fetch(`http://127.0.0.1:${port}${target}`);
      assert.equal(response.status, 403, target);
    }
  });

  test("never sends raw session ids in the leaderboard", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    gameServer.world.addPlayer({ name: "Victim", creatureId: "katulu", leaderboardId: "victim-session-id" });

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const hello = await waitForMessage(socket, (message) => message.type === "hello");
    assert.equal(hello.leaderboard.length, 1);
    assert.equal(JSON.stringify(hello).includes("victim-session-id"), false);

    socket.close();
    await once(socket, "close");
  });

  test("closes sockets that send oversized messages", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, "open");
    const closed = once(socket, "close");
    socket.send("x".repeat(64 * 1024));
    const [code] = await closed;
    assert.equal(code, 1009);
  });

  test("closes sockets that flood messages", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, "open");
    const closed = once(socket, "close");
    for (let index = 0; index < 1000; index += 1) {
      socket.send(JSON.stringify({ type: "input", x: 1, y: 0, boost: false }));
    }
    const [code] = await closed;
    assert.equal(code, 1008);
  });

  test("a dropped session reclaims its creature within the grace period", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const sessionId = "blip-session";

    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(firstSocket, "open");
    firstSocket.send(JSON.stringify({ type: "join", sessionId, name: "Blip", creatureId: "katulu" }));
    const firstWelcome = await waitForMessage(firstSocket, (message) => message.type === "welcome");
    gameServer.world.players.get(firstWelcome.playerId).mass = 900;
    firstSocket.close();
    await once(firstSocket, "close");

    // Still in the world, stopped, while the grace period runs.
    const waiting = gameServer.world.players.get(firstWelcome.playerId);
    assert.ok(waiting);
    assert.deepEqual(waiting.input, { x: 0, y: 0, boost: false });

    const secondSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(secondSocket, "open");
    secondSocket.send(JSON.stringify({ type: "join", sessionId, name: "Blip", creatureId: "katulu" }));
    const secondWelcome = await waitForMessage(secondSocket, (message) => message.type === "welcome");
    assert.equal(secondWelcome.playerId, firstWelcome.playerId);
    assert.equal(secondWelcome.reconnected, true);
    assert.equal(secondWelcome.reconnectedMass, 900);
    assert.equal(gameServer.world.players.size, 1);

    secondSocket.close();
    await once(secondSocket, "close");
  });

  test("a dropped session is removed once the grace period ends", async () => {
    const gameServer = await startTestServer({ disconnectGraceMs: 30 });
    const { port } = gameServer.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "join", sessionId: "gone-session", name: "Gone", creatureId: "katulu" }));
    await waitForMessage(socket, (message) => message.type === "welcome");
    socket.close();
    await once(socket, "close");
    assert.equal(gameServer.world.players.size, 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(gameServer.world.players.size, 0);
  });

  test("replaces an older socket with the same browser session", async () => {
    const gameServer = await startTestServer();
    const { port } = gameServer.address();
    const sessionId = "same-tab-session";

    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    const firstHello = waitForMessage(firstSocket, (message) => message.type === "hello");
    await once(firstSocket, "open");
    await firstHello;
    firstSocket.send(JSON.stringify({ type: "join", sessionId, name: "First", creatureId: "abyssal_serpent" }));
    await waitForMessage(firstSocket, (message) => message.type === "welcome");

    const secondSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    const secondHello = waitForMessage(secondSocket, (message) => message.type === "hello");
    await once(secondSocket, "open");
    await secondHello;

    const firstClosed = once(firstSocket, "close");
    secondSocket.send(JSON.stringify({ type: "join", sessionId, name: "Second", creatureId: "glass_kraken" }));
    await waitForMessage(secondSocket, (message) => message.type === "welcome");
    const [closeCode] = await firstClosed;

    assert.equal(closeCode, 4001);
    assert.equal(gameServer.world.players.size, 1);
    assert.equal([...gameServer.world.players.values()][0].name, "Second");

    secondSocket.close();
    await once(secondSocket, "close");
  });
});

async function startTestServer(options = {}) {
  const gameServer = createGameServer({
    port: 0,
    host: "127.0.0.1",
    tickRate: 20,
    broadcastRate: 20,
    ...options,
    worldOptions: {
      seed: "server-test",
      populate: false,
      endless: false,
      radius: 1200,
      maxFood: 0,
      maxNpcs: 0,
      maxAddons: 0
    }
  });
  await gameServer.start();
  servers.push(gameServer);
  return gameServer;
}

function waitForMessage(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message."));
    }, timeoutMs);

    function onMessage(raw) {
      const message = JSON.parse(raw);
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }

    socket.on("message", onMessage);
  });
}
