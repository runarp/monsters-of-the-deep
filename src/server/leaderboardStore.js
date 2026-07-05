import { promises as fs } from "node:fs";
import path from "node:path";

// Node-only persistence for the server-wide high-score table. Kept out of the
// shared game code so GameWorld stays browser-safe. Reads/writes a small JSON
// file so scores survive server restarts and deploys.

export async function loadLeaderboard(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    // Missing or unreadable file on first boot — start with an empty board.
    return [];
  }
}

export async function saveLeaderboard(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Write to a temp file then rename so a crash mid-write can't corrupt the
  // existing board.
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ version: 1, savedAt: Date.now(), entries }));
  await fs.rename(tempPath, filePath);
}
