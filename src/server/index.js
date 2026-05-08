import { createGameServer } from "./createServer.js";

const port = Number(process.env.PORT ?? 3000);
const gameServer = createGameServer({ port });

await gameServer.start();

const address = gameServer.address();
const host = address.address === "::" || address.address === "0.0.0.0" ? "localhost" : address.address;
console.log(`Monsters of the Deep listening on http://${host}:${address.port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await gameServer.stop();
    process.exit(0);
  });
}
