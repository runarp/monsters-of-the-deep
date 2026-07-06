// Pure, deterministic biogeography for the endless plane. The same coordinate
// always resolves to the same region + depth zone on the server, the offline
// solo sim, and every client — no world RNG seed is involved, so everyone
// agrees on "where am I" without exchanging anything. Learning rides on the
// labels; nothing here is announced as a lesson.

const REGION_CELL = 9000; // a named sea spans several screens
export const REGION_CELL_SIZE = REGION_CELL;

// The seas are contiguous LONGITUDE BANDS along the endless x-axis, arranged
// as an eastward circumnavigation of the real globe: swim east long enough and
// you pass the Sargasso, cross the Atlantic, round the Cape, skirt Antarctica,
// come up through the Pacific, and arrive back in the Sargasso. One full lap
// is REGIONS.length × REGION_CELL_SIZE units. Depth (y) never changes the sea.
//
// Each region carries its real-world anchor (lat/lon, for the globe map) and
// its ocean, plus danger (1–3): dangerous seas bias spawns toward bigger,
// rarer creatures — steer around them early, hunt them late. New players
// surface near x=0, so the first band is a calm nursery sea.
export const REGIONS = Object.freeze([
  { id: "sargasso_sea", name: "Sargasso Sea", ocean: "Atlantic Ocean", lat: 28, lon: -60, whirlpool: "Old Sow", danger: 1 },
  { id: "north_atlantic", name: "North Atlantic", ocean: "Atlantic Ocean", lat: 46, lon: -30, whirlpool: "Corryvreckan", danger: 2 },
  { id: "norwegian_sea", name: "Norwegian Sea", ocean: "Arctic Ocean", lat: 66, lon: -2, whirlpool: "Saltstraumen", danger: 2 },
  { id: "lofoten_shelf", name: "Lofoten Shelf", ocean: "Arctic Ocean", lat: 68, lon: 14, whirlpool: "Moskstraumen", danger: 2 },
  { id: "benguela", name: "Benguela Upwelling", ocean: "Atlantic Ocean", lat: -28, lon: 12, whirlpool: "the Gyre", danger: 2 },
  { id: "antarctic_convergence", name: "Antarctic Convergence", ocean: "Southern Ocean", lat: -55, lon: 60, whirlpool: "the Whitewater", danger: 3 },
  { id: "kelp_forest", name: "Kelp Forest", ocean: "Pacific Ocean", lat: -42, lon: 147, whirlpool: "the Undertow", danger: 1 },
  { id: "coral_triangle", name: "Coral Triangle", ocean: "Pacific Ocean", lat: 0, lon: 125, whirlpool: "Naruto", danger: 1 },
  { id: "mariana_approach", name: "Mariana Approach", ocean: "Pacific Ocean", lat: 15, lon: 147, whirlpool: "the Trench Eye", danger: 3 },
  { id: "humboldt_current", name: "Humboldt Current", ocean: "Pacific Ocean", lat: -20, lon: -75, whirlpool: "the Descent", danger: 2 }
]);

export const WORLD_LAP = REGION_CELL * REGIONS.length;

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

export function regionIndexAt(x) {
  const band = Math.floor(x / REGION_CELL);
  return ((band % REGIONS.length) + REGIONS.length) % REGIONS.length;
}

// Depth (y) is accepted for call-site compatibility but a sea spans all
// depths — the vertical axis belongs to the depth zones.
export function regionAt(x, _y = 0) {
  return REGIONS[regionIndexAt(x)];
}

// Continuous position on the real globe: within a band, drift from this sea's
// anchor toward the next one along the voyage, so the map's "you" dot sails
// smoothly around the world as you swim east or west.
export function geoPositionAt(x) {
  const index = regionIndexAt(x);
  const current = REGIONS[index];
  const next = REGIONS[(index + 1) % REGIONS.length];
  const within = ((x % REGION_CELL) + REGION_CELL) % REGION_CELL;
  const t = within / REGION_CELL;
  let lonDelta = next.lon - current.lon;
  if (lonDelta > 180) lonDelta -= 360;
  if (lonDelta < -180) lonDelta += 360;
  let lon = current.lon + lonDelta * t;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: current.lat + (next.lat - current.lat) * t, lon };
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
