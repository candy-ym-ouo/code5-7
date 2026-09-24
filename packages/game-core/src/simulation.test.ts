import { describe, expect, it } from 'vitest';
import { CORRIDORS, SPECIES, SPECIES_BY_ID } from './catalog.ts';
import {
  applyOverwinter,
  applyOverwinterDetailed,
  createSpeciesState,
  disperseSpecies,
  disperseSpeciesDetailed,
  evaluateSample,
  evolveSeason,
  generateSiteState,
  generateWinterClimate,
  getPhenologyWindow,
  getPlantPresentation,
  getSuitability
} from './simulation.ts';
import type { WinterClimate } from './types.ts';

describe('deterministic world simulation', () => {
  it('generates identical environments for the same seed', () => {
    const first = generateSiteState('save', 'seed-alpha', 1, 'spring', 3, 'foothill');
    const second = generateSiteState('save', 'seed-alpha', 1, 'spring', 3, 'foothill');
    expect(first).toEqual(second);
  });

  it('penalizes a wrong litter sample', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const site = generateSiteState('save', 'seed-beta', 1, 'spring', 3, 'foothill');
    const state = createSpeciesState('save', 'seed-beta', 1, 'spring', 'foothill', species.id);
    const decision = evaluateSample(species, state, site, 'spring', 3, 'litter', 0);
    expect(decision.allowed).toBe(true);
    expect(decision.protocolMatch).toBe(false);
    expect(decision.effects.health).toBeLessThan(0);
    expect(decision.effects.populationDelta).toBeLessThan(0);
  });

  it('keeps multi-year simulations finite and bounded', () => {
    const species = SPECIES_BY_ID.get('ginkgo-biloba')!;
    let state = createSpeciesState('save', 'seed-gamma', 1, 'spring', 'mixed_forest', species.id);

    for (let year = 1; year <= 250; year += 1) {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
        const site = generateSiteState('save', 'seed-gamma', year, season, 5, 'mixed_forest');
        expect(getSuitability(species, site)).toBeGreaterThanOrEqual(0);
        expect(getSuitability(species, site)).toBeLessThanOrEqual(1);
        state = evolveSeason(state, site, [site]).state;
      }
      state = applyOverwinter(
        state,
        generateSiteState('save', 'seed-gamma', year, 'winter', 5, 'mixed_forest'),
        { winter: generateWinterClimate('seed-gamma', year, [generateSiteState('save', 'seed-gamma', year, 'winter', 5, 'mixed_forest')]) }
      );
      expect(Number.isFinite(state.population)).toBe(true);
      expect(Number.isFinite(state.health)).toBe(true);
      expect(state.population).toBeGreaterThanOrEqual(0);
      expect(state.health).toBeGreaterThanOrEqual(0);
      expect(state.health).toBeLessThanOrEqual(100);
    }
  });
});

describe('catalog-wide stability', () => {
  it('keeps every configured species and site finite for 120 years', () => {
    for (const species of SPECIES) {
      for (const [siteId, profile] of Object.entries(species.zones)) {
        if (!siteId || !profile) continue;
        let state = createSpeciesState('save', `seed-${species.id}`, 1, 'spring', siteId as never, species.id);
        for (let year = 1; year <= 120; year += 1) {
          for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
            const site = generateSiteState('save', `seed-${species.id}`, year, season, 5, siteId as never);
            state = evolveSeason(state, site, [site]).state;
          }
          const winterSite = generateSiteState('save', `seed-${species.id}`, year, 'winter', 5, siteId as never);
          const winter = generateWinterClimate(`seed-${species.id}`, year, [winterSite]);
          state = applyOverwinter(state, winterSite, { winter });
          expect(Number.isFinite(state.population)).toBe(true);
          expect(Number.isFinite(state.health)).toBe(true);
          expect(Number.isFinite(state.seedBank)).toBe(true);
          expect(state.population).toBeGreaterThanOrEqual(0);
          expect(state.population).toBeLessThanOrEqual(profile.carryingCapacity * 1.2 + 0.01);
          expect(state.health).toBeGreaterThanOrEqual(0);
          expect(state.health).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('sampling safety', () => {
  it('does not allow destructive sampling on protected species', () => {
    const species = SPECIES_BY_ID.get('metasequoia-glyptostroboides')!;
    const site = generateSiteState('save', 'protected-seed', 1, 'spring', 5, 'stream_valley');
    const state = createSpeciesState('save', 'protected-seed', 1, 'spring', 'stream_valley', species.id);
    expect(evaluateSample(species, state, site, 'spring', 5, 'litter', 0).allowed).toBe(false);
    expect(evaluateSample(species, state, site, 'spring', 5, 'cutting', 0).allowed).toBe(false);
    expect(evaluateSample(species, state, site, 'spring', 5, 'photo', 0).allowed).toBe(true);
  });
});

describe('annual dispersal', () => {
  it('moves surplus individuals into a suitable neighboring habitat without creating mass', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const base = generateSiteState('save', 'dispersal-seed', 1, 'spring', 5, 'foothill');
    const preferred = {
      temperatureC: species.preferred.temperatureC,
      humidity: species.preferred.humidity,
      soilMoisture: species.preferred.soilMoisture,
      lightLux: species.preferred.lightLux,
      windSpeed: 1,
      disturbance: 0
    };
    const foothill = { ...base, ...preferred };
    const mixed = { ...base, ...preferred, siteId: 'mixed_forest' as const };
    const source = {
      ...createSpeciesState('save', 'dispersal-seed', 1, 'spring', 'foothill', species.id),
      population: species.zones.foothill!.carryingCapacity * 0.95,
      health: 90
    };
    const target = {
      ...createSpeciesState('save', 'dispersal-seed', 1, 'spring', 'mixed_forest', species.id),
      population: 10,
      health: 85
    };
    const before = source.population + target.population;
    const seedBefore = source.seedBank + target.seedBank;
    const result = disperseSpecies([source, target], [foothill, mixed]);
    const nextSource = result.find((state) => state.siteId === 'foothill')!;
    const nextTarget = result.find((state) => state.siteId === 'mixed_forest')!;
    expect(nextSource.population).toBeLessThan(source.population);
    expect(nextTarget.population).toBeGreaterThan(target.population);
    expect(nextSource.population + nextTarget.population).toBeGreaterThanOrEqual(before - 0.5);
    expect(nextSource.population + nextTarget.population).toBeLessThanOrEqual(before + source.seedBank + 0.5);
    // 种群增加量不超过迁出个体数与种子库可供定植量之和
    const gained = nextTarget.population - target.population;
    const movedOut = source.population - nextSource.population;
    expect(gained).toBeLessThanOrEqual(movedOut + seedBefore + 0.5);
  });

  it('blocks movement along corridors closed by a snowstorm', () => {
    const species = SPECIES_BY_ID.get('liquidambar-formosana')!;
    const preferred = {
      temperatureC: species.preferred.temperatureC,
      humidity: species.preferred.humidity,
      soilMoisture: species.preferred.soilMoisture,
      lightLux: species.preferred.lightLux,
      weather: 'snow' as const,
      windSpeed: 9,
      disturbance: 0.3
    };
    const ridge = { ...generateSiteState('save', 'corridor-seed', 3, 'winter', 9, 'ridge'), ...preferred };
    const mixed = {
      ...generateSiteState('save', 'corridor-seed', 3, 'winter', 9, 'mixed_forest'),
      ...preferred,
      siteId: 'mixed_forest' as const
    };
    const openWinter = generateWinterClimate('corridor-seed', 3, [ridge, mixed]);
    const blockedWinter: WinterClimate = {
      ...openWinter,
      extreme: 'snowstorm',
      severity: 1,
      corridorAccess: Object.fromEntries(CORRIDORS.map((c) => [c.id, 0.02]))
    };
    const source = {
      ...createSpeciesState('save', 'corridor-seed', 3, 'winter', 'ridge', species.id),
      population: species.zones.ridge!.carryingCapacity,
      health: 92,
      seedBank: species.zones.ridge!.carryingCapacity
    };
    const target = {
      ...createSpeciesState('save', 'corridor-seed', 3, 'winter', 'mixed_forest', species.id),
      population: 12,
      health: 85,
      seedBank: 5
    };
    const open = disperseSpeciesDetailed([source, target], [ridge, mixed], {
      corridorAccess: openWinter.corridorAccess
    });
    const blocked = disperseSpeciesDetailed([source, target], [ridge, mixed], {
      corridorAccess: blockedWinter.corridorAccess
    });
    expect(open.totalMigrants).toBeGreaterThan(blocked.totalMigrants);
    expect(blocked.totalMigrants).toBeLessThan(0.5);
  });
});

describe('winter extreme climate', () => {
  it('is deterministic for the same seed and year', () => {
    const sites = (['foothill', 'mixed_forest', 'stream_valley', 'ridge'] as const).map((siteId, index) =>
      generateSiteState('save', 'climate-seed', 4, 'winter', 6 + index, siteId)
    );
    const first = generateWinterClimate('climate-seed', 4, sites);
    const second = generateWinterClimate('climate-seed', 4, sites);
    expect(first).toEqual(second);
    // 不同年份允许出现不同事件
    const otherYears = new Set(
      [1, 2, 3, 5, 6, 7, 8].map((year) => generateWinterClimate('climate-seed', year, sites).extreme)
    );
    expect(otherYears.size).toBeGreaterThan(1);
  });

  it('recomputing past years never depends on later-year state', () => {
    const species = SPECIES_BY_ID.get('carex-community')!;
    const site = generateSiteState('save', 'replay-seed', 2, 'winter', 7, 'ridge');
    const state = createSpeciesState('save', 'replay-seed', 2, 'winter', 'ridge', species.id);
    const winter = generateWinterClimate('replay-seed', 2, [site]);
    const first = applyOverwinterDetailed(state, site, { winter });
    for (let year = 3; year <= 12; year += 1) {
      const laterSite = generateSiteState('save', 'replay-seed', year, 'winter', 7, 'ridge');
      const laterWinter = generateWinterClimate('replay-seed', year, [laterSite]);
      applyOverwinterDetailed(first.state, laterSite, { winter: laterWinter });
    }
    // 先算完后续年份再重算第 2 年，结果必须与首次完全一致
    const replay = applyOverwinterDetailed(state, site, { winter });
    expect(replay).toEqual(first);
  });

  it('cold waves raise mortality and droughts hit moisture-loving seed banks', () => {
    const species = SPECIES_BY_ID.get('acorus-calamus')!;
    const site = generateSiteState('save', 'impact-seed', 1, 'winter', 8, 'stream_valley');
    const state = createSpeciesState('save', 'impact-seed', 1, 'winter', 'stream_valley', species.id);
    const calm = applyOverwinterDetailed(state, site, {
      winter: { year: 1, extreme: 'none', severity: 0, corridorAccess: {} }
    });
    const cold = applyOverwinterDetailed(state, { ...site, temperatureC: -4 }, {
      winter: { year: 1, extreme: 'cold_wave', severity: 1, corridorAccess: {} }
    });
    const drought = applyOverwinterDetailed(state, { ...site, soilMoisture: 24 }, {
      winter: { year: 1, extreme: 'winter_drought', severity: 1, corridorAccess: {} }
    });
    expect(cold.mortality).toBeGreaterThan(calm.mortality);
    expect(cold.state.health).toBeLessThan(calm.state.health);
    expect(drought.state.seedBank).toBeLessThanOrEqual(calm.state.seedBank);
  });

  it('links recruitment to remaining carrying capacity and keeps everything bounded', () => {
    const species = SPECIES_BY_ID.get('carex-community')!;
    const site = generateSiteState('save', 'capacity-seed', 1, 'winter', 6, 'foothill');
    const state = {
      ...createSpeciesState('save', 'capacity-seed', 1, 'winter', 'foothill', species.id),
      population: species.zones.foothill!.carryingCapacity * 0.98,
      health: 90,
      seedBank: species.zones.foothill!.carryingCapacity
    };
    const sparse: typeof state = { ...state, population: 20, seedBank: species.zones.foothill!.carryingCapacity };
    const crowdedResult = applyOverwinterDetailed(state, site, {
      winter: { year: 1, extreme: 'none', severity: 0, corridorAccess: {} }
    });
    const sparseResult = applyOverwinterDetailed(sparse, site, {
      winter: { year: 1, extreme: 'none', severity: 0, corridorAccess: {} }
    });
    expect(sparseResult.recruitment).toBeGreaterThan(crowdedResult.recruitment);
    for (const result of [crowdedResult, sparseResult]) {
      expect(result.state.population).toBeLessThanOrEqual(species.zones.foothill!.carryingCapacity * 1.2 + 0.01);
      expect(result.state.seedBank).toBeGreaterThanOrEqual(0);
      expect(result.state.health).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('phenology shift', () => {
  it('uses annual temperature shifts in the effective bloom window and presentation', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const site = generateSiteState('save', 'phenology-seed', 1, 'spring', 4, 'foothill');
    const state = createSpeciesState('save', 'phenology-seed', 1, 'spring', 'foothill', species.id);
    const shifted = { ...state, phenology: { ...state.phenology, shift: -1 } };
    expect(getPhenologyWindow(species, shifted, 'spring')).toEqual({ start: 1, peak: 4, end: 7 });
    expect(getPlantPresentation(species, shifted, 'spring', 4).stage).toBe('full_bloom');
    expect(applyOverwinter(state, { ...site, temperatureC: 12 }).phenology.shift).toBe(-1);
  });
});
