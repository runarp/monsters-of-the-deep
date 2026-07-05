// Pure, deterministic biogeography for the endless plane. The same coordinate
// always resolves to the same region + depth zone on the server, the offline
// solo sim, and every client — no world RNG seed is involved, so everyone
// agrees on "where am I" without exchanging anything. Learning rides on the
// labels; nothing here is announced as a lesson.

const REGION_CELL = 9000; // a named sea spans several screens
export const REGION_CELL_SIZE = REGION_CELL;

// danger (1–3) is stage-progression metadata: dangerous seas bias spawns toward
// bigger, rarer creatures, so early-game players learn to steer around them and
// return once they've grown.
export const REGIONS = Object.freeze([
  { id: "coral_triangle", name: "Coral Triangle", whirlpool: "Naruto", danger: 1 },
  { id: "sargasso_sea", name: "Sargasso Sea", whirlpool: "Old Sow", danger: 1 },
  { id: "north_atlantic", name: "North Atlantic", whirlpool: "Corryvreckan", danger: 2 },
  { id: "norwegian_sea", name: "Norwegian Sea", whirlpool: "Saltstraumen", danger: 2 },
  { id: "lofoten_shelf", name: "Lofoten Shelf", whirlpool: "Moskstraumen", danger: 2 },
  { id: "humboldt_current", name: "Humboldt Current", whirlpool: "the Descent", danger: 2 },
  { id: "benguela", name: "Benguela Upwelling", whirlpool: "the Gyre", danger: 2 },
  { id: "kelp_forest", name: "Kelp Forest", whirlpool: "the Undertow", danger: 1 },
  { id: "mariana_approach", name: "Mariana Approach", whirlpool: "the Trench Eye", danger: 3 },
  { id: "antarctic_convergence", name: "Antarctic Convergence", whirlpool: "the Whitewater", danger: 3 }
]);

// Real ocean-science depth zones, from the sunlit surface down to the hadal
// trench floor.
export const DEPTH_ZONES = Object.freeze([
  { id: "epipelagic", name: "Sunlight Zone", min: 0, max: 200 },
  { id: "mesopelagic", name: "Twilight Zone", min: 200, max: 1000 },
  { id: "bathypelagic", name: "Midnight Zone", min: 1000, max: 4000 },
  { id: "abyssal", name: "Abyssal Zone", min: 4000, max: 6000 },
  { id: "hadal", name: "Hadal Zone", min: 6000, max: 11000 }
]);

// Depth is the vertical axis: the sunlit surface sits at OCEAN_SURFACE_Y and the
// hadal floor at OCEAN_FLOOR_Y, set far apart so each zone is a spacious band.
// Swimming up (smaller y) is always shallower; these boundaries are not
// crossable (enforced by the world sim). Horizontally the ocean stays endless.
// The surface sits a little above the origin so new players (who spawn near
// origin) start in the sunlit shallows and dive deeper as they grow; the floor
// is far below. Both are kept well clear of y=0 so origin-anchored logic is
// unaffected. Each of the five zones is a ~6400-unit band.
export const OCEAN_SURFACE_Y = -6000;
export const OCEAN_FLOOR_Y = 26000;
const OCEAN_HEIGHT = OCEAN_FLOOR_Y - OCEAN_SURFACE_Y;

const REGION_IDS = Object.freeze(REGIONS.map((region) => region.id));
const ZONE_IDS = Object.freeze(DEPTH_ZONES.map((zone) => zone.id));

function hash2(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function regionAt(x, y) {
  const cellX = Math.floor(x / REGION_CELL);
  const cellY = Math.floor(y / REGION_CELL);
  const index = Math.min(REGIONS.length - 1, Math.floor(hash2(cellX, cellY) * REGIONS.length));
  return REGIONS[index];
}

// 0 at the surface, 1 at the floor. The zones get equal vertical bands (not
// scaled by their wildly unequal metre ranges) so each is a spacious, evenly
// spaced layer.
export function depthFractionAtY(y) {
  return Math.max(0, Math.min(1, (y - OCEAN_SURFACE_Y) / OCEAN_HEIGHT));
}

export function zoneIndexAtY(y) {
  return Math.min(DEPTH_ZONES.length - 1, Math.floor(depthFractionAtY(y) * DEPTH_ZONES.length));
}

export function zoneAt(x, y) {
  return DEPTH_ZONES[zoneIndexAtY(y)];
}

export function depthMetersAt(x, y) {
  const index = zoneIndexAtY(y);
  const zone = DEPTH_ZONES[index];
  const within = Math.max(0, Math.min(1, depthFractionAtY(y) * DEPTH_ZONES.length - index));
  return Math.round(zone.min + within * (zone.max - zone.min));
}

export function locationAt(x, y) {
  return { region: regionAt(x, y), zone: zoneAt(x, y), depth: depthMetersAt(x, y) };
}

export function isRegionId(id) {
  return REGION_IDS.includes(id);
}

export function isZoneId(id) {
  return ZONE_IDS.includes(id);
}
