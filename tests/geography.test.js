import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEPTH_ZONES,
  OCEAN_FLOOR_Y,
  OCEAN_SURFACE_Y,
  REGIONS,
  REGION_CELL_SIZE,
  WORLD_LAP,
  depthMetersAt,
  geoPositionAt,
  isRegionId,
  isZoneId,
  locationAt,
  regionAt,
  regionIndexAt,
  zoneAt
} from "../src/shared/geography.js";

describe("geography", () => {
  test("region and zone lookups are deterministic", () => {
    for (const [x, y] of [[0, 0], [1234, -5678], [-90000, 4200], [500000, 25000]]) {
      const a = locationAt(x, y);
      const b = locationAt(x, y);
      assert.equal(a.region.id, b.region.id);
      assert.equal(a.zone.id, b.zone.id);
      assert.equal(a.depth, b.depth);
    }
  });

  test("every region has a real whirlpool name and valid ids", () => {
    for (const region of REGIONS) {
      assert.ok(region.name.length > 0);
      assert.ok(region.whirlpool.length > 0);
      assert.equal(isRegionId(region.id), true);
    }
  });

  test("seas are longitude bands: depth never changes which sea you are in", () => {
    for (const x of [0, 4500, 12000, -3000, 250_000]) {
      const surface = regionAt(x, OCEAN_SURFACE_Y).id;
      const floor = regionAt(x, OCEAN_FLOOR_Y).id;
      assert.equal(surface, floor, `region should be depth-independent at x=${x}`);
    }
  });

  test("swimming east one full lap returns to the same sea", () => {
    assert.equal(WORLD_LAP, REGION_CELL_SIZE * REGIONS.length);
    for (const x of [0, 3210, -9999, 123_456]) {
      assert.equal(regionAt(x, 0).id, regionAt(x + WORLD_LAP, 0).id);
      assert.equal(regionAt(x, 0).id, regionAt(x - WORLD_LAP, 0).id);
    }
  });

  test("adjacent bands are adjacent seas, and new players start in a calm nursery", () => {
    // The very first band (around the origin where players surface) is calm.
    assert.equal(regionIndexAt(0), 0);
    assert.equal(REGIONS[0].danger, 1);
    // Each band steps to the next region in order.
    for (let index = 0; index < REGIONS.length; index += 1) {
      const x = index * REGION_CELL_SIZE + REGION_CELL_SIZE / 2;
      assert.equal(regionAt(x, 0).id, REGIONS[index].id);
    }
  });

  test("globe position drifts continuously toward the next sea's real coordinates", () => {
    // At a band's start you sit on that sea's anchor; near its end you approach
    // the next sea's anchor — a smooth voyage, no teleports.
    const start = geoPositionAt(0);
    assert.ok(Math.abs(start.lat - REGIONS[0].lat) < 0.001);
    assert.ok(Math.abs(start.lon - REGIONS[0].lon) < 0.001);

    const nearEnd = geoPositionAt(REGION_CELL_SIZE * 0.98);
    assert.ok(Math.abs(nearEnd.lat - REGIONS[1].lat) < 3, "latitude approaches the next sea");

    // Longitude stays within valid bounds even across the antimeridian.
    for (let x = -WORLD_LAP; x <= WORLD_LAP; x += 777) {
      const geo = geoPositionAt(x);
      assert.ok(geo.lon >= -180 && geo.lon <= 180, `lon in range at x=${x}`);
      assert.ok(geo.lat >= -90 && geo.lat <= 90, `lat in range at x=${x}`);
    }
  });

  test("every region has an ocean and real coordinates for the globe map", () => {
    const oceans = new Set();
    for (const region of REGIONS) {
      assert.ok(region.ocean && region.ocean.length > 0, `${region.id} needs an ocean`);
      assert.ok(Number.isFinite(region.lat) && region.lat >= -90 && region.lat <= 90);
      assert.ok(Number.isFinite(region.lon) && region.lon >= -180 && region.lon <= 180);
      oceans.add(region.ocean);
    }
    assert.ok(oceans.size >= 3, "the world should span several oceans");
  });

  test("every region carries a danger level for stage progression", () => {
    const dangers = new Set();
    for (const region of REGIONS) {
      assert.ok(region.danger >= 1 && region.danger <= 3, `${region.id} danger out of range`);
      dangers.add(region.danger);
    }
    assert.ok(dangers.has(1), "there must be calm starter seas");
    assert.ok(dangers.has(3), "there must be dangerous late-game seas");
  });

  test("all named seas are reachable by swimming horizontally", () => {
    const regions = new Set();
    for (let index = 0; index < 40_000; index += 1) {
      const x = ((index * 733) % 400_000) - 200_000;
      regions.add(regionAt(x, 0).id);
    }
    assert.equal(regions.size, REGIONS.length);
  });

  test("depth follows the vertical axis: down is deeper, up is shallower", () => {
    let previousDepth = -1;
    let previousZoneIndex = -1;
    const zonesSeen = new Set();
    // Sweep from the surface down to the floor.
    for (let y = OCEAN_SURFACE_Y; y <= OCEAN_FLOOR_Y; y += 500) {
      const depth = depthMetersAt(0, y);
      const zone = zoneAt(0, y);
      const zoneIndex = DEPTH_ZONES.indexOf(zone);
      assert.ok(depth >= previousDepth, `depth should not decrease going down (y=${y})`);
      assert.ok(zoneIndex >= previousZoneIndex, `zone should not get shallower going down (y=${y})`);
      assert.ok(depth >= zone.min && depth <= zone.max, `${depth} outside ${zone.id}`);
      assert.equal(isZoneId(zone.id), true);
      previousDepth = depth;
      previousZoneIndex = zoneIndex;
      zonesSeen.add(zone.id);
    }
    assert.equal(zonesSeen.size, DEPTH_ZONES.length, "all five zones are reachable top to bottom");
  });

  test("the surface and floor are hard depth limits", () => {
    // At/above the surface: the sunlit shallows.
    assert.equal(zoneAt(0, OCEAN_SURFACE_Y).id, "epipelagic");
    assert.equal(depthMetersAt(0, OCEAN_SURFACE_Y), 0);
    assert.equal(zoneAt(0, OCEAN_SURFACE_Y - 999_999).id, "epipelagic");

    // At/below the floor: the hadal trench, clamped.
    assert.equal(zoneAt(0, OCEAN_FLOOR_Y).id, "hadal");
    assert.equal(zoneAt(0, OCEAN_FLOOR_Y + 999_999).id, "hadal");
    assert.ok(depthMetersAt(0, OCEAN_FLOOR_Y) >= 10_000);
  });
});
