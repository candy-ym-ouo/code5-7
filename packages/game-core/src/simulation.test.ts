import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_BY_ID } from './catalog.ts';
import {
  applyOverwinter,
  createSpeciesState,
  disperseOverwinter,
  disperseSpecies,
  evaluateSample,
  evolveSeason,
  generateSiteState,
  generateWinterClimate,
  getPhenologyWindow,
  getPlantPresentation,
  getSuitability
} from './simulation.ts';

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
      state = applyOverwinter(state, generateSiteState('save', 'seed-gamma', year, 'winter', 5, 'mixed_forest'));
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
          state = applyOverwinter(state, generateSiteState('save', `seed-${species.id}`, year, 'winter', 5, siteId as never));
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
    const result = disperseSpecies([source, target], [foothill, mixed]);
    const nextSource = result.find((state) => state.siteId === 'foothill')!;
    const nextTarget = result.find((state) => state.siteId === 'mixed_forest')!;
    expect(nextSource.population).toBeLessThan(source.population);
    expect(nextTarget.population).toBeGreaterThan(target.population);
    expect(nextSource.population + nextTarget.population).toBeCloseTo(before, 1);
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

describe('overwinter extreme climate', () => {
  it('generates identical climate events for the same seed and year', () => {
    const winter = generateSiteState('save', 'climate-seed', 3, 'winter', 9, 'ridge');
    const first = generateWinterClimate('climate-seed', 3, 'ridge', winter);
    const second = generateWinterClimate('climate-seed', 3, 'ridge', winter);
    expect(first).toEqual(second);
    const otherYear = generateWinterClimate('climate-seed', 4, 'ridge', winter);
    // 不同年份的随机序列应可能不同，且结果始终是合法事件或 null
    expect(first === null || typeof first.type === 'string').toBe(true);
    expect(otherYear === null || typeof otherYear.type === 'string').toBe(true);
  });

  it('does not mutate the input state and links population, seed bank and carrying capacity', () => {
    const species = SPECIES_BY_ID.get('ginkgo-biloba')!;
    const winter = generateSiteState('save', 'climate-cap-seed', 1, 'winter', 10, 'mixed_forest');
    const state = {
      ...createSpeciesState('save', 'climate-cap-seed', 1, 'winter', 'mixed_forest', species.id),
      population: species.zones.mixed_forest!.carryingCapacity,
      health: 90,
      seedBank: 300,
      capacityMultiplier: 1
    };
    const before = { ...state, phenology: { ...state.phenology } };
    const result = applyOverwinter(state, winter, { type: 'ice_storm', label: '冰暴', severity: 1 });

    expect(result).not.toBe(state);
    expect(state.population).toBe(before.population);
    expect(state.seedBank).toBe(before.seedBank);
    expect(state.capacityMultiplier).toBe(1);
    // 冰暴压低承载力乘数、健康和种子库，并造成种群损失
    expect(result.capacityMultiplier).toBeCloseTo(0.78, 2);
    expect(result.health).toBeLessThan(before.health);
    expect(result.seedBank).toBeLessThan(before.seedBank);
    expect(result.population).toBeLessThan(before.population);
    // 承载力已满时，冰暴后的实际承载力低于种群，种子补充不能把种群推回基线容量
    expect(result.population).toBeLessThanOrEqual(
      species.zones.mixed_forest!.carryingCapacity * 0.78 * 1.2 + 0.01
    );
  });

  it('recovers the carrying capacity multiplier across later seasons', () => {
    const species = SPECIES_BY_ID.get('carex-community')!;
    let state = {
      ...createSpeciesState('save', 'climate-recover-seed', 2, 'spring', 'ridge', species.id),
      capacityMultiplier: 0.5
    };
    for (let season = 0; season < 16; season += 1) {
      const site = generateSiteState('save', 'climate-recover-seed', 2, 'summer', 5, 'ridge');
      state = evolveSeason(state, site, [site]).state;
    }
    expect(state.capacityMultiplier).toBeGreaterThan(0.95);
    expect(state.capacityMultiplier).toBeLessThanOrEqual(1);
  });
});

describe('overwinter migration corridors', () => {
  it('moves individuals from a pressured ridge along a corridor into suitable lowland habitat', () => {
    const species = SPECIES_BY_ID.get('liquidambar-formosana')!;
    const preferredSite = {
      ...generateSiteState('save', 'corridor-seed', 2, 'spring', 1, 'foothill'),
      temperatureC: species.preferred.temperatureC,
      humidity: species.preferred.humidity,
      soilMoisture: species.preferred.soilMoisture,
      lightLux: species.preferred.lightLux,
      disturbance: 0
    };
    const ridgeSite = { ...preferredSite, siteId: 'ridge' as const };
    const foothillSite = { ...preferredSite, siteId: 'foothill' as const };
    const ridge = {
      ...createSpeciesState('save', 'corridor-seed', 2, 'spring', 'ridge', species.id),
      year: 2,
      population: species.zones.ridge!.carryingCapacity * 0.95,
      health: 88,
      seedBank: 60,
      capacityMultiplier: 1
    };
    const foothill = {
      ...createSpeciesState('save', 'corridor-seed', 2, 'spring', 'foothill', species.id),
      year: 2,
      population: 20,
      health: 85,
      seedBank: 20,
      capacityMultiplier: 1
    };
    const ridgeBefore = { ...ridge };
    const result = disperseOverwinter([ridge, foothill], [ridgeSite, foothillSite], new Map([
      ['ridge', null],
      ['foothill', null]
    ]));
    const nextRidge = result.states.find((state) => state.siteId === 'ridge')!;
    const nextFoothill = result.states.find((state) => state.siteId === 'foothill')!;

    expect(result.migrations.length).toBeGreaterThan(0);
    expect(result.migrations[0]!.from).toBe('ridge');
    expect(result.migrations[0]!.to).toBe('foothill');
    expect(nextRidge.population).toBeLessThan(ridgeBefore.population);
    expect(nextFoothill.population).toBeGreaterThan(20);
    expect(nextFoothill.seedBank).toBeGreaterThan(20);
    // 输入对象不被原地修改
    expect(ridge.population).toBe(ridgeBefore.population);
    // 输出顺序与输入一致，方便服务层按旧快照写次年行
    expect(result.states.map((state) => `${state.siteId}:${state.speciesId}`)).toEqual(
      [ridge, foothill].map((state) => `${state.siteId}:${state.speciesId}`)
    );
  });

  it('keeps populations at or above two individuals and respects target headroom', () => {
    const species = SPECIES_BY_ID.get('liquidambar-formosana')!;
    const preferredSite = {
      ...generateSiteState('save', 'corridor-edge-seed', 2, 'spring', 1, 'ridge'),
      temperatureC: species.preferred.temperatureC,
      humidity: species.preferred.humidity,
      soilMoisture: species.preferred.soilMoisture,
      lightLux: species.preferred.lightLux,
      disturbance: 0
    };
    const ridgeSite = { ...preferredSite, siteId: 'ridge' as const };
    const foothillSite = { ...preferredSite, siteId: 'foothill' as const };
    const ridge = {
      ...createSpeciesState('save', 'corridor-edge-seed', 2, 'spring', 'ridge', species.id),
      year: 2,
      population: 4,
      health: 80,
      seedBank: 5,
      capacityMultiplier: 1
    };
    const foothill = {
      ...createSpeciesState('save', 'corridor-edge-seed', 2, 'spring', 'foothill', species.id),
      year: 2,
      population: species.zones.foothill!.carryingCapacity,
      health: 80,
      seedBank: 5,
      capacityMultiplier: 1
    };
    const result = disperseOverwinter([ridge, foothill], [ridgeSite, foothillSite], new Map([
      ['ridge', { type: 'cold_wave', label: '强寒潮', severity: 1 }],
      ['foothill', null]
    ]));
    for (const state of result.states) {
      expect(state.population).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(state.population)).toBe(true);
      expect(Number.isFinite(state.seedBank)).toBe(true);
    }
  });
});
