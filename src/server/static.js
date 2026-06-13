import { createGameServer } from "./createServer.js";

// Hosts the client as a plain static site with no WebSocket world. The browser
// fails to open a socket and auto-falls back to the local offline solo game.
const port = Number(process.env.PORT ?? 3000);
const gameServer = createGameServer({ port, enableWebSocket: false });

await gameServer.start();

const address = gameServer.address();
const host = address.address === "::" || address.address === "0.0.0.0" ? "localhost" : address.address;
console.log(`Monsters of the Deep (offline host) listening on http://${host}:${address.port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await gameServer.stop();
    process.exit(0);
  });
}
