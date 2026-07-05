// Pure, deterministic biogeography for the endless plane. The same coordinate
// always resolves to the same region + depth zone on the server, the offline
// solo sim, and every client — no world RNG seed is involved, so everyone
// agrees on "where am I" without exchanging anything. Learning rides on the
// labels; nothing here is announced as a lesson.

const REGION_CELL = 9000; // a named sea spans several screens
export const REGION_CELL_SIZE = REGION_CELL;

export const REGIONS = Object.freeze([
  { id: "coral_triangle", name: "Coral Triangle", whirlpool: "Naruto" },
  { id: "sargasso_sea", name: "Sargasso Sea", whirlpool: "Old Sow" },
  { id: "north_atlantic", name: "North Atlantic", whirlpool: "Corryvreckan" },
  { id: "norwegian_sea", name: "Norwegian Sea", whirlpool: "Saltstraumen" },
  { id: "lofoten_shelf", name: "Lofoten Shelf", whirlpool: "Moskstraumen" },
  { id: "humboldt_current", name: "Humboldt Current", whirlpool: "the Descent" },
  { id: "benguela", name: "Benguela Upwelling", whirlpool: "the Gyre" },
  { id: "kelp_forest", name: "Kelp Forest", whirlpool: "the Undertow" },
  { id: "mariana_approach", name: "Mariana Approach", whirlpool: "the Trench Eye" },
  { id: "antarctic_convergence", name: "Antarctic Convergence", whirlpool: "the Whitewater" }
]);

// Real ocean-science depth zones, deepest reachable by swimming outward through
// the pseudo-depth field below.
export const DEPTH_ZONES = Object.freeze([
  { id: "epipelagic", name: "Sunlight Zone", min: 0, max: 200 },
  { id: "mesopelagic", name: "Twilight Zone", min: 200, max: 1000 },
  { id: "bathypelagic", name: "Midnight Zone", min: 1000, max: 4000 },
  { id: "abyssal", name: "Abyssal Zone", min: 4000, max: 6000 },
  { id: "hadal", name: "Hadal Zone", min: 6000, max: 11000 }
]);

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

// Smooth pseudo-noise depth field so zones form basins and bands that tile
// forever — a player crosses named boundaries by swimming in any direction.
function depthField(x, y) {
  const s = 0.00035;
  const value =
    Math.sin(x * s) * Math.cos(y * s * 1.3) +
    Math.sin((x + y) * s * 0.55 + 1.7) * 0.7 +
    Math.cos((x * 0.6 - y) * s * 1.9 + 3.1) * 0.5;
  return (value / 2.2 + 1) / 2; // ~0..1
}

// The real depth zones span wildly unequal meter ranges (Sunlight is 200 m of an
// 11 km scale), so we band the noise FIELD by tuned thresholds instead — shallow
// water is common where players start, the Hadal zone stays rare and deep — then
// interpolate a true-to-life depth within the chosen zone's real range.
const ZONE_FIELD_MAX = Object.freeze([0.42, 0.58, 0.72, 0.85, 1.01]);

function zoneIndexAt(x, y) {
  const field = depthField(x, y);
  for (let index = 0; index < ZONE_FIELD_MAX.length; index += 1) {
    if (field < ZONE_FIELD_MAX[index]) {
      return { index, field };
    }
  }
  return { index: DEPTH_ZONES.length - 1, field };
}

export function zoneAt(x, y) {
  return DEPTH_ZONES[zoneIndexAt(x, y).index];
}

export function depthMetersAt(x, y) {
  const { index, field } = zoneIndexAt(x, y);
  const zone = DEPTH_ZONES[index];
  const bandMin = index === 0 ? 0 : ZONE_FIELD_MAX[index - 1];
  const bandMax = ZONE_FIELD_MAX[index];
  const t = Math.max(0, Math.min(1, (field - bandMin) / (bandMax - bandMin)));
  return Math.round(zone.min + t * (zone.max - zone.min));
}

export function locationAt(x, y) {
  const { index } = zoneIndexAt(x, y);
  return { region: regionAt(x, y), zone: DEPTH_ZONES[index], depth: depthMetersAt(x, y) };
}

export function isRegionId(id) {
  return REGION_IDS.includes(id);
}

export function isZoneId(id) {
  return ZONE_IDS.includes(id);
}
