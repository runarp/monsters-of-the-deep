import assert from "node:assert/strict";
import { once } from "node:events";
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
    assert.equal(welcome.catalog.playable.length, 3);

    socket.send(JSON.stringify({ type: "input", x: 1, y: 0, boost: false }));
    const snapshot = await waitForMessage(socket, (message) => message.type === "snapshot");

    assert.equal(snapshot.playerId, welcome.playerId);
    assert.equal(snapshot.self.name, "Socket Diver");
    assert.equal(snapshot.players.some((player) => player.id === welcome.playerId), true);

    socket.close();
    await once(socket, "close");
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

async function startTestServer() {
  const gameServer = createGameServer({
    port: 0,
    host: "127.0.0.1",
    tickRate: 20,
    broadcastRate: 20,
    worldOptions: {
      seed: "server-test",
      populate: false,
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
