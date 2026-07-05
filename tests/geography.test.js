import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEPTH_ZONES,
  OCEAN_FLOOR_Y,
  OCEAN_SURFACE_Y,
  REGIONS,
  depthMetersAt,
  isRegionId,
  isZoneId,
  locationAt,
  regionAt,
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
