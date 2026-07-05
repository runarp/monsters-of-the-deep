import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGameServer } from "./createServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
// High scores persist to this file across restarts/deploys. Override the path
// with LEADERBOARD_FILE to point at a durable/mounted volume in production.
const leaderboardFile =
  process.env.LEADERBOARD_FILE ?? path.resolve(__dirname, "../../data/leaderboard.json");
const gameServer = createGameServer({ port, leaderboardFile });

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
