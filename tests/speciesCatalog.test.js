import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REGIONS, isRegionId, isZoneId } from "../src/shared/geography.js";
import { SPECIES, buildSpeciesCreatures, signatureSpeciesForRegion } from "../src/shared/speciesCatalog.js";
import { CREATURE_CATALOG, creatureLabel, getGrowthStage, scientificNameFor } from "../src/shared/creatureCatalog.js";

const VALID_SHAPES = new Set(["fish", "serpent", "kraken", "ray", "shark", "whale", "maw", "angler"]);

describe("species catalog", () => {
  test("every species row is well-formed and biome-tagged", () => {
    assert.ok(SPECIES.length >= 30, "should ship a substantial seed set");
    for (const species of SPECIES) {
      assert.ok(species.common.length > 0, `${species.id} needs a common name`);
      assert.ok(/^[A-Z][a-z]+ [a-z-]+$/.test(species.binomial), `${species.id} binomial: ${species.binomial}`);
      assert.ok(VALID_SHAPES.has(species.shape), `${species.id} shape: ${species.shape}`);
      assert.ok(species.stages.length >= 1);
      for (const region of species.regions) {
        assert.equal(isRegionId(region), true, `${species.id} region: ${region}`);
      }
      for (const zone of species.zones) {
        assert.equal(isZoneId(zone), true, `${species.id} zone: ${zone}`);
      }
      // Stages ascend in real length and game mass.
      for (let i = 1; i < species.stages.length; i += 1) {
        assert.ok(species.stages[i][1] > species.stages[i - 1][1], `${species.id} lengths ascend`);
        assert.ok(species.stages[i][2] > species.stages[i - 1][2], `${species.id} masses ascend`);
      }
    }
  });

  test("builder expands rows into valid catalog entries", () => {
    const built = buildSpeciesCreatures();
    assert.equal(Object.keys(built).length, SPECIES.length);
    for (const creature of Object.values(built)) {
      assert.equal(creature.playable, false);
      assert.equal(creature.speciesBuilt, true);
      assert.ok(creature.baseMass > 0);
      assert.ok(creature.baseRadius > 0);
      assert.ok(creature.tags.length >= 1);
      assert.ok(creature.diet.length >= 1);
      assert.ok(creature.movement.maxSpeed > 0);
      assert.ok(VALID_SHAPES.has(creature.visual.shape));
      assert.ok(creature.visual.body && creature.visual.eye, "palette resolved");
      // Ascending stage minMass so getGrowthStage works.
      for (let i = 1; i < creature.stages.length; i += 1) {
        assert.ok(creature.stages[i].minMass > creature.stages[i - 1].minMass);
        assert.ok(Number.isFinite(creature.stages[i].cm));
      }
    }
  });

  test("species are folded into the shared CREATURE_CATALOG without touching legacy ids", () => {
    for (const id of ["silver_sardine", "mako_shark", "blue_whale", "abyssal_serpent", "craken"]) {
      assert.ok(CREATURE_CATALOG[id], `legacy id ${id} preserved`);
    }
    for (const species of SPECIES) {
      assert.ok(CREATURE_CATALOG[species.id], `species ${species.id} present in catalog`);
    }
  });

  test("every region has signature species so no named sea is a dead zone", () => {
    for (const region of REGIONS) {
      const signatures = signatureSpeciesForRegion(region.id);
      assert.ok(signatures.length >= 1, `${region.id} should have at least one signature species`);
      for (const entry of signatures) {
        assert.ok(entry.name.length > 0);
        assert.ok(entry.binomial.length > 0);
      }
    }
  });

  test("signature species actually live in the region they are listed for", () => {
    for (const region of REGIONS) {
      for (const entry of signatureSpeciesForRegion(region.id)) {
        const species = SPECIES.find((candidate) => candidate.common === entry.name);
        assert.ok(species.regions.includes(region.id), `${entry.name} listed under wrong sea`);
      }
    }
  });

  test("creatureLabel reads as name · phase · real size for built species", () => {
    const herring = "atlantic_herring";
    const fryStage = getGrowthStage(herring, CREATURE_CATALOG[herring].stages[0].minMass);
    assert.equal(creatureLabel(herring, fryStage.minMass), "Atlantic Herring · fry · 4 cm");
    assert.equal(creatureLabel(herring, CREATURE_CATALOG[herring].baseMass), "Atlantic Herring · adult · 30 cm");
    assert.equal(scientificNameFor(herring), "Clupea harengus");

    // Metres roll over past 100 cm.
    const orca = creatureLabel("orca", CREATURE_CATALOG.orca.baseMass);
    assert.match(orca, / m$/);

    // Legacy single-stage / hand-authored creatures show just their name.
    assert.equal(creatureLabel("silver_sardine", 24), "Silver Sardine");
    assert.equal(scientificNameFor("silver_sardine"), null);
  });
});
