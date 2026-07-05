import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEPTH_ZONES,
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
    for (const [x, y] of [[0, 0], [1234, -5678], [-90000, 42000], [500000, 500000]]) {
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

  test("all regions and all depth zones are reachable across the plane", () => {
    const regions = new Set();
    const zones = new Set();
    for (let index = 0; index < 90_000; index += 1) {
      const x = ((index * 733) % 260_000) - 130_000;
      const y = ((index * 941) % 260_000) - 130_000;
      const location = locationAt(x, y);
      regions.add(location.region.id);
      zones.add(location.zone.id);
    }
    assert.equal(regions.size, REGIONS.length, "all named seas should be reachable");
    assert.equal(zones.size, DEPTH_ZONES.length, "all depth zones, including Hadal, should be reachable");
  });

  test("shallow zones are common and the hadal zone stays rare", () => {
    const counts = {};
    let total = 0;
    for (let i = 0; i < 260; i += 1) {
      for (let j = 0; j < 260; j += 1) {
        const id = zoneAt((i - 130) * 340, (j - 130) * 340).id;
        counts[id] = (counts[id] ?? 0) + 1;
        total += 1;
      }
    }
    const share = (id) => (counts[id] ?? 0) / total;
    assert.ok(share("epipelagic") > 0.15, "the sunlight zone where players start should be common");
    assert.ok(share("hadal") < 0.1, "the hadal zone should be a rare deep");
  });

  test("reported depth stays inside the chosen zone's real range", () => {
    for (let index = 0; index < 5000; index += 1) {
      const x = ((index * 617) % 200_000) - 100_000;
      const y = ((index * 883) % 200_000) - 100_000;
      const zone = zoneAt(x, y);
      const depth = depthMetersAt(x, y);
      assert.ok(depth >= zone.min && depth <= zone.max, `${depth} outside ${zone.id}`);
      assert.equal(isZoneId(zone.id), true);
    }
  });
});
