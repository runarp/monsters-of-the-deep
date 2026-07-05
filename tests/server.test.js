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

    const atlas = await fetch(`http://127.0.0.1:${port}/assets/creatures/scary-creature-atlas.png`);
    assert.equal(atlas.status, 200);
    assert.equal(atlas.headers.get("content-type"), "image/png");
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
