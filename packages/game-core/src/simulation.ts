import type { SampleMethod, Season, SiteId } from '@shanhai/contracts';
import { CORRIDORS, SPECIES_BY_ID, SITES_BY_ID } from './catalog.ts';
import { createRng } from './rng.ts';
import type {
  CorridorDefinition,
  DispersalResult,
  ExtremeClimateType,
  OverwinterOptions,
  OverwinterResult,
  PlantPresentation,
  SampleDecision,
  SeasonEvolutionResult,
  SiteState,
  SpeciesDefinition,
  SpeciesState,
  WinterClimate
} from './types.ts';

const SEASON_INDEX: Record<Season, number> = {
  spring: 0,
  summer: 1,
  autumn: 2,
  winter: 3
};

const BASE_TEMPERATURE: Record<Season, number> = {
  spring: 16,
  summer: 26,
  autumn: 17,
  winter: 5
};

const BASE_HUMIDITY: Record<Season, number> = {
  spring: 62,
  summer: 78,
  autumn: 66,
  winter: 55
};

const BASE_SOIL: Record<Season, number> = {
  spring: 58,
  summer: 65,
  autumn: 57,
  winter: 52
};

const WEATHER_TEMPERATURE_OFFSET: Record<string, number> = {
  sunny: 1.8,
  cloudy: 0.4,
  overcast: -0.4,
  light_rain: -1.3,
  heavy_rain: -2.4,
  fog: -0.8,
  snow: -3.1
};

const WEATHER_LIGHT_OFFSET: Record<string, number> = {
  sunny: 1.2,
  cloudy: 0.8,
  overcast: 0.55,
  light_rain: 0.42,
  heavy_rain: 0.28,
  fog: 0.35,
  snow: 0.45
};

const SAMPLE_LABELS: Record<SampleMethod, string> = {
  photo: '拍照',
  rubbing: '拓印',
  litter: '落叶采集',
  cutting: '标准剪取'
};

const STAGE_LABELS = {
  leafing: '展叶',
  budding: '现蕾',
  early_bloom: '初花',
  full_bloom: '盛花',
  late_bloom: '末花',
  fruiting: '结果',
  leaf_color: '叶变色',
  leaf_fall: '落叶',
  dormant: '休眠'
} as const;

const FLOWER_COLORS: Record<string, string> = {
  'prunus-davidiana': '#e8b4b6',
  'orychophragmus-violaceus': '#8d79b8',
  'rhododendron-simsii': '#c95f70',
  'camellia-japonica': '#c74f5d',
  'acorus-calamus': '#c8b77a',
  'carex-community': '#c3b685',
  'metasequoia-glyptostroboides': '#8a9b70',
  'quercus-acutissima': '#b7a77a',
  'liquidambar-formosana': '#b36c57',
  'ginkgo-biloba': '#b6b777'
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function nextSeason(season: Season): Season {
  const nextIndex = (SEASON_INDEX[season] + 1) % 4;
  return (['spring', 'summer', 'autumn', 'winter'] as const)[nextIndex]!;
}

export function generateSiteState(
  saveId: string,
  seed: string,
  year: number,
  season: Season,
  day: number,
  siteId: SiteId,
  disturbance = 0.08
): SiteState {
  const site = SITES_BY_ID.get(siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const rng = createRng(`${seed}:site:${year}:${season}:${day}:${siteId}`);
  const weather = pickWeather(rng.pickWeighted.bind(rng), season, siteId);

  const yearWarming = (year - 1) * 0.22;
  const dailyNoise = rng.between(-1.8, 1.8);
  let temperatureC = BASE_TEMPERATURE[season] + site.temperatureOffset + yearWarming + dailyNoise;
  temperatureC += WEATHER_TEMPERATURE_OFFSET[weather] ?? 0;

  if (weather === 'snow' && temperatureC > 2) {
    temperatureC = 1.8;
  }

  const humidity = clamp(
    BASE_HUMIDITY[season] +
      site.humidityOffset +
      rng.between(-7, 7) +
      (weather.includes('rain') ? 12 : weather === 'fog' ? 9 : 0),
    24,
    98
  );

  const soilMoisture = clamp(
    BASE_SOIL[season] +
      site.soilMoistureOffset +
      rng.between(-5, 5) +
      (weather === 'heavy_rain' ? 14 : weather === 'light_rain' ? 7 : 0),
    18,
    96
  );

  const lightLux = clamp(
    (season === 'summer' ? 46000 : season === 'spring' ? 39000 : season === 'autumn' ? 33000 : 22000) *
      site.lightMultiplier *
      (WEATHER_LIGHT_OFFSET[weather] ?? 0.8) *
      rng.between(0.86, 1.14),
    1200,
    90000
  );

  const windSpeed = clamp(
    rng.between(0.6, 4.8) + (siteId === 'ridge' ? 2.2 : 0) + (season === 'winter' ? 0.8 : 0),
    0.2,
    12
  );

  return {
    saveId,
    year,
    siteId,
    weather,
    temperatureC: round(temperatureC, 1),
    humidity: round(humidity, 1),
    soilMoisture: round(soilMoisture, 1),
    lightLux: Math.round(lightLux),
    windSpeed: round(windSpeed, 1),
    disturbance: clamp(disturbance, 0, 0.42)
  };
}

function pickWeather(
  pickWeighted: <T>(items: Array<{ value: T; weight: number }>) => T,
  season: Season,
  siteId: SiteId
): string {
  const wetter = siteId === 'stream_valley' ? 1.6 : siteId === 'ridge' ? 0.72 : 1;
  const weights: Record<Season, Array<{ value: string; weight: number }>> = {
    spring: [
      { value: 'sunny', weight: 3.5 },
      { value: 'cloudy', weight: 3.2 },
      { value: 'overcast', weight: 1.7 },
      { value: 'light_rain', weight: 2.1 * wetter },
      { value: 'heavy_rain', weight: 0.45 * wetter },
      { value: 'fog', weight: 0.8 * wetter }
    ],
    summer: [
      { value: 'sunny', weight: 3.4 },
      { value: 'cloudy', weight: 2.7 },
      { value: 'overcast', weight: 1.4 },
      { value: 'light_rain', weight: 2.3 * wetter },
      { value: 'heavy_rain', weight: 1.05 * wetter },
      { value: 'fog', weight: 0.25 * wetter }
    ],
    autumn: [
      { value: 'sunny', weight: 4.1 },
      { value: 'cloudy', weight: 2.5 },
      { value: 'overcast', weight: 1.2 },
      { value: 'light_rain', weight: 1.2 * wetter },
      { value: 'heavy_rain', weight: 0.25 * wetter },
      { value: 'fog', weight: 1.1 * wetter }
    ],
    winter: [
      { value: 'sunny', weight: 3.2 },
      { value: 'cloudy', weight: 2.6 },
      { value: 'overcast', weight: 1.8 },
      { value: 'light_rain', weight: 0.8 * wetter },
      { value: 'heavy_rain', weight: 0.18 * wetter },
      { value: 'fog', weight: 0.9 * wetter },
      { value: 'snow', weight: siteId === 'ridge' ? 1.5 : 0.6 }
    ]
  };
  return pickWeighted(weights[season]);
}

const EXTREME_CLIMATE_LABELS: Record<ExtremeClimateType, string> = {
  none: '无极端天气',
  cold_wave: '强寒潮',
  snowstorm: '持续暴雪',
  warm_spell: '异常暖冬',
  winter_drought: '冬季干旱'
};

/**
 * 冬季极端气候完全由存档种子和年份决定，同种子重算任意年份结果一致。
 */
export function generateWinterClimate(
  seed: string,
  year: number,
  winterSites: SiteState[]
): WinterClimate {
  const rng = createRng(`${seed}:winter-climate:${year}`);
  const warming = (year - 1) * 0.018;
  const weights: Array<{ value: ExtremeClimateType; weight: number }> = [
    { value: 'none', weight: 6.4 - warming },
    { value: 'cold_wave', weight: 1.25 - warming * 0.5 },
    { value: 'snowstorm', weight: 0.9 },
    { value: 'warm_spell', weight: 0.6 + warming },
    { value: 'winter_drought', weight: 0.55 + warming * 0.5 }
  ];
  const extreme = rng.pickWeighted(weights);
  const severity =
    extreme === 'none'
      ? 0
      : round(0.45 + rng.between(0, 0.55), 3);

  const corridorAccess: WinterClimate['corridorAccess'] = {};
  const bySite = new Map(winterSites.map((site) => [site.siteId, site]));
  for (const corridor of CORRIDORS) {
    corridorAccess[corridor.id] = corridorAccessFactor(corridor, extreme, severity, bySite);
  }
  return { year, extreme, severity, corridorAccess };
}

function corridorAccessFactor(
  corridor: CorridorDefinition,
  extreme: ExtremeClimateType,
  severity: number,
  winterSites: Map<SiteId, SiteState>
): number {
  let factor = corridor.basePermeability;
  for (const endpoint of [corridor.from, corridor.to]) {
    const site = winterSites.get(endpoint);
    if (site) {
      factor *= 1 - clamp(site.disturbance, 0, 0.42) * 0.55;
    }
  }
  if (extreme === 'snowstorm') {
    factor *= 1 - 0.55 * severity;
  } else if (extreme === 'cold_wave') {
    factor *= 1 - 0.25 * severity;
  } else if (extreme === 'warm_spell') {
    factor *= 1 + 0.12 * severity;
  } else if (extreme === 'winter_drought') {
    factor *= 1 - 0.18 * severity;
  }
  return round(clamp(factor, 0.02, 1), 3);
}

export function getExtremeClimateLabel(extreme: ExtremeClimateType): string {
  return EXTREME_CLIMATE_LABELS[extreme];
}

export function createSpeciesState(
  saveId: string,
  seed: string,
  year: number,
  season: Season,
  siteId: SiteId,
  speciesId: string
): SpeciesState {
  const definition = SPECIES_BY_ID.get(speciesId);
  const profile = definition?.zones[siteId];
  if (!definition || !profile) {
    throw new Error(`Species ${speciesId} is not configured for site ${siteId}`);
  }

  const rng = createRng(`${seed}:species:${year}:${siteId}:${speciesId}`);
  const population = Math.max(1, Math.round(profile.initialPopulation * rng.between(0.94, 1.06)));
  const health = round(rng.between(80, 94), 1);
  const seedBank = round(profile.carryingCapacity * rng.between(0.18, 0.3), 1);
  const phenology = getConfiguredPhenology(definition, season);

  return {
    saveId,
    year,
    siteId,
    speciesId,
    population,
    health,
    seedBank,
    suitability: 0.75,
    status: getStatus(population, profile.carryingCapacity, health),
    phenology
  };
}

function getConfiguredPhenology(definition: SpeciesDefinition, season: Season) {
  const bloom =
    definition.phenology[season] ??
    Object.values(definition.phenology).find((window) => window && window.start > 0) ??
    { start: 5, peak: 7, end: 9 };
  return {
    bloomStartDay: bloom.start,
    bloomPeakDay: bloom.peak,
    bloomEndDay: bloom.end,
    shift: 0
  };
}

export function getPhenologyWindow(
  definition: SpeciesDefinition,
  state: SpeciesState,
  season: Season
): { start: number; peak: number; end: number } | null {
  const base = definition.phenology[season];
  if (!base || base.start <= 0) {
    return null;
  }
  const shift = clamp(state.phenology.shift ?? 0, -2, 2);
  return {
    start: clamp(base.start + shift, 1, 10),
    peak: clamp(base.peak + shift, 1, 10),
    end: clamp(base.end + shift, 1, 10)
  };
}

export function getSuitability(definition: SpeciesDefinition, site: SiteState): number {
  const factors = [
    {
      value: factor(site.temperatureC, definition.preferred.temperatureC, definition.tolerance.temperatureC),
      weight: 0.35
    },
    {
      value: factor(site.humidity, definition.preferred.humidity, definition.tolerance.humidity),
      weight: 0.25
    },
    {
      value: factor(site.soilMoisture, definition.preferred.soilMoisture, definition.tolerance.soilMoisture),
      weight: 0.25
    },
    {
      value: factor(site.lightLux, definition.preferred.lightLux, definition.tolerance.lightLux),
      weight: 0.15
    }
  ];
  const weightedLog = factors.reduce((sum, item) => sum + Math.log(Math.max(0.01, item.value)) * item.weight, 0);
  return clamp(Math.exp(weightedLog), 0, 1);
}

function factor(actual: number, ideal: number, tolerance: number): number {
  return clamp(1 - Math.abs(actual - ideal) / Math.max(1, tolerance), 0, 1);
}

export function getPlantPresentation(
  definition: SpeciesDefinition,
  state: SpeciesState,
  season: Season,
  day: number
): PlantPresentation {
  const bloom = getPhenologyWindow(definition, state, season);
  let stage: keyof typeof STAGE_LABELS = 'leafing';

  if (bloom) {
    if (day < Math.max(1, bloom.start - 1)) {
      stage = 'budding';
    } else if (day < bloom.peak) {
      stage = 'early_bloom';
    } else if (day <= bloom.peak + 1) {
      stage = 'full_bloom';
    } else if (day <= bloom.end) {
      stage = 'late_bloom';
    } else {
      stage = 'fruiting';
    }
  } else if (season === 'autumn' && definition.lifeForm.includes('乔木')) {
    stage = day < 5 ? 'leaf_color' : 'leaf_fall';
  } else if (season === 'winter') {
    stage = 'dormant';
  } else if (season === 'spring') {
    stage = day < state.phenology.bloomStartDay ? 'budding' : 'leafing';
  }

  const blooming = stage === 'early_bloom' || stage === 'full_bloom' || stage === 'late_bloom';
  const autumn = stage === 'leaf_color' || stage === 'leaf_fall';
  const winter = stage === 'dormant';

  return {
    stage,
    label: STAGE_LABELS[stage],
    dominantColor: blooming
      ? (FLOWER_COLORS[definition.id] ?? definition.colors.green)
      : autumn
        ? definition.colors.autumn
        : winter
          ? definition.colors.winter
          : definition.colors.green,
    leafTexture: definition.leafTexture
  };
}

export function getStatus(population: number, carryingCapacity: number, health: number): SpeciesState['status'] {
  if (population <= 1) {
    return 'absent';
  }
  const ratio = population / Math.max(1, carryingCapacity);
  if (ratio < 0.05 || health < 20) {
    return 'endangered';
  }
  if (ratio < 0.25 || health < 45) {
    return 'vulnerable';
  }
  if (ratio > 0.72 && health > 72) {
    return 'growing';
  }
  return 'stable';
}

export function evaluateSample(
  definition: SpeciesDefinition,
  state: SpeciesState,
  site: SiteState,
  season: Season,
  day: number,
  method: SampleMethod,
  used: number
): SampleDecision {
  const limits: Record<SampleMethod, number> = {
    photo: 99,
    rubbing: 3,
    litter: 3,
    cutting: 1
  };
  const emptyEffects = { health: 0, populationDelta: 0, seedBankDelta: 0 };

  if (used >= limits[method]) {
    return {
      allowed: false,
      reason: `${SAMPLE_LABELS[method]} 已达到本季安全上限`,
      protocolMatch: false,
      effects: emptyEffects,
      messages: []
    };
  }

  const profile = definition.zones[site.siteId];
  if (!profile) {
    return {
      allowed: false,
      reason: '目标不在当前区域',
      protocolMatch: false,
      effects: emptyEffects,
      messages: []
    };
  }

  if (method === 'cutting' && (state.health < 65 || state.population < profile.carryingCapacity * 0.6)) {
    return {
      allowed: false,
      reason: '目标健康度或种群数量低于安全采集阈值',
      protocolMatch: false,
      effects: emptyEffects,
      messages: []
    };
  }

  const presentation = getPlantPresentation(definition, state, season, day);
  const methodConfigured = definition.sampleProtocol.includes(method);
  let protocolMatch = methodConfigured;

  if (method === 'photo') {
    protocolMatch = true;
  }

  if (method === 'rubbing') {
    protocolMatch = methodConfigured && presentation.stage !== 'budding' && presentation.stage !== 'leafing';
  }

  if (method === 'litter') {
    protocolMatch =
      methodConfigured && (presentation.stage === 'leaf_fall' || presentation.stage === 'dormant');
  }

  if (method === 'cutting') {
    protocolMatch = methodConfigured && state.health >= 75;
  }

  if (method === 'cutting' && definition.protected) {
    return {
      allowed: false,
      reason: '保护物种禁止剪取',
      protocolMatch: false,
      effects: emptyEffects,
      messages: []
    };
  }

  if (definition.protected && method !== 'photo' && !protocolMatch) {
    return {
      allowed: false,
      reason: '保护物种只允许符合当前物候的非破坏性记录',
      protocolMatch: false,
      effects: emptyEffects,
      messages: []
    };
  }

  const effects = { ...emptyEffects };
  const messages: string[] = [];

  if (method === 'photo') {
    messages.push('影像记录不会干扰植物。');
  } else if (protocolMatch) {
    if (method === 'cutting') {
      effects.health = -1.5;
      effects.populationDelta = -Math.max(1, state.population * 0.004);
      effects.seedBankDelta = -profile.carryingCapacity * 0.005;
      messages.push('标准剪取已执行，影响受到安全阈值限制。');
    } else {
      messages.push('采集方式符合当前物种和物候条件。');
    }
  } else {
    messages.push('采集方式与物种或当前物候不匹配，生态状态已受到影响。');
    if (method === 'rubbing') {
      effects.health = -3;
      effects.populationDelta = -Math.max(1, state.population * 0.005);
      effects.seedBankDelta = -profile.carryingCapacity * 0.01;
    } else if (method === 'litter') {
      effects.health = -4;
      effects.populationDelta = -Math.max(1, state.population * 0.01);
      effects.seedBankDelta = -profile.carryingCapacity * 0.08;
    } else if (method === 'cutting') {
      effects.health = -10;
      effects.populationDelta = -Math.max(1, state.population * 0.025);
      effects.seedBankDelta = -profile.carryingCapacity * 0.03;
    }
  }

  const destructive = method !== 'photo' && (effects.health < 0 || effects.populationDelta < 0 || effects.seedBankDelta < 0);
  if (destructive && (state.health < 40 || state.population < profile.carryingCapacity * 0.35)) {
    return {
      allowed: false,
      reason: '目标健康度或种群数量已低于破坏性采集安全线',
      protocolMatch,
      effects: emptyEffects,
      messages: []
    };
  }

  return {
    allowed: true,
    protocolMatch,
    effects,
    messages
  };
}

export function applySampleEffects(state: SpeciesState, decision: SampleDecision, siteId: SiteId): SpeciesState {
  const definition = SPECIES_BY_ID.get(state.speciesId);
  const profile = definition?.zones[siteId];
  if (!definition || !profile) {
    return state;
  }
  const population = Math.max(0, state.population + decision.effects.populationDelta);
  const health = clamp(state.health + decision.effects.health, 0, 100);
  return {
    ...state,
    population: round(population, 2),
    health: round(health, 1),
    seedBank: round(Math.max(0, state.seedBank + decision.effects.seedBankDelta), 2),
    status: getStatus(population, profile.carryingCapacity, health)
  };
}

export function evolveSeason(
  state: SpeciesState,
  site: SiteState,
  weatherHistory: SiteState[] = []
): SeasonEvolutionResult {
  const definition = SPECIES_BY_ID.get(state.speciesId);
  const profile = definition?.zones[state.siteId];
  if (!definition || !profile) {
    throw new Error(`Missing evolution configuration for ${state.speciesId} at ${state.siteId}`);
  }

  const suitability = getSuitability(definition, site);
  const effectiveCapacity = Math.max(
    2,
    profile.carryingCapacity * suitability * (1 - site.disturbance * 0.7) * (0.88 + suitability * 0.18)
  );
  const effectiveGrowth =
    definition.ecology.growthRate * clamp(state.health / 100, 0, 1.2) * clamp(suitability * 1.25, 0.1, 1.2);
  const growth = effectiveGrowth * state.population * (1 - state.population / effectiveCapacity);

  const stressEvents = weatherHistory.filter((entry) => {
    const temperatureExcess = Math.max(
      0,
      Math.abs(entry.temperatureC - definition.preferred.temperatureC) - definition.tolerance.temperatureC
    );
    const moistureExcess = Math.max(
      0,
      Math.abs(entry.soilMoisture - definition.preferred.soilMoisture) -
        definition.tolerance.soilMoisture
    );
    return temperatureExcess + moistureExcess > 3 || entry.weather === 'heavy_rain' || entry.weather === 'snow';
  }).length;
  const stressLoss = state.population * Math.min(0.09, definition.ecology.stressRate * stressEvents);
  const nextPopulation = clamp(state.population + growth - stressLoss, 0, profile.carryingCapacity * 1.2);

  const environmentalBalance = suitability - 0.52;
  const nextHealth = clamp(
    state.health + environmentalBalance * 8 - stressEvents * 0.35,
    0,
    100
  );
  const nextSeedBank = clamp(
    state.seedBank * 0.68 + nextPopulation * definition.ecology.seedRate * (nextHealth / 100),
    0,
    profile.carryingCapacity * 1.8
  );

  const nextState: SpeciesState = {
    ...state,
    suitability: round(suitability, 3),
    population: round(nextPopulation, 2),
    health: round(nextHealth, 1),
    seedBank: round(nextSeedBank, 2),
    status: getStatus(nextPopulation, profile.carryingCapacity, nextHealth)
  };

  return {
    state: nextState,
    populationChange: nextState.population - state.population,
    healthChange: nextState.health - state.health
  };
}

const NEUTRAL_WINTER: WinterClimate = { year: 0, extreme: 'none', severity: 0, corridorAccess: {} };

/**
 * 越冬结算把种群、种子库和承载力联动：
 * - 极端气候按物种耐寒/耐旱特性造成死亡率，健康与区域干扰会调节死亡幅度
 * - 种子库经历自然损耗，存活部分按健康度与剩余承载力补充新生种群
 * - 目标区域承载力越空缺、健康越好，种子补充越充分（密度依赖）
 */
export function applyOverwinter(
  state: SpeciesState,
  site: SiteState,
  options?: OverwinterOptions
): SpeciesState {
  return applyOverwinterDetailed(state, site, options).state;
}

export function applyOverwinterDetailed(
  state: SpeciesState,
  site: SiteState,
  options?: OverwinterOptions
): OverwinterResult {
  const definition = SPECIES_BY_ID.get(state.speciesId);
  const profile = definition?.zones[state.siteId];
  if (!definition || !profile) {
    return { state, mortality: 0, recruitment: 0 };
  }

  const winter = options?.winter ?? NEUTRAL_WINTER;
  const healthFactor = clamp(state.health / 100, 0.25, 1);
  const disturbanceFactor = 1 - clamp(site.disturbance, 0, 0.42) * 0.3;

  let survivalRate =
    1 -
    (coldStressRate(site, definition) +
      (winter.severity * extremeMortalityRate(winter.extreme, definition, site)) / 2);
  survivalRate *= 0.92 + 0.08 * healthFactor;
  survivalRate *= disturbanceFactor;
  survivalRate = clamp(survivalRate, 0.55, 0.995);

  const survivors = state.population * survivalRate;
  const mortality = state.population - survivors;

  const seedRetention = seedRetentionRate(winter.extreme, winter.severity, definition, site);
  const retainedSeeds = state.seedBank * seedRetention;

  const vacancy = clamp(
    (profile.carryingCapacity - survivors) / Math.max(1, profile.carryingCapacity),
    0,
    1
  );
  const recruitmentPotential = retainedSeeds * 0.2 * healthFactor * (0.45 + 0.55 * vacancy);
  const recruitment = clamp(
    recruitmentPotential,
    0,
    Math.max(0, profile.carryingCapacity * 1.05 - survivors)
  );

  const population = clamp(survivors + recruitment, 0, profile.carryingCapacity * 1.2);
  const seedBank = Math.max(0, retainedSeeds - recruitment);

  const healthRecovery = 3.5 + vacancy * 1.2;
  const healthDamage = winter.severity * extremeHealthDamage(winter.extreme, definition);
  const health = clamp(state.health + healthRecovery - healthDamage - mortality / Math.max(1, state.population) * 3, 0, 100);

  const seasonalShift =
    winter.extreme === 'warm_spell' ? -Math.round(winter.severity) : site.temperatureC < 2 ? 1 : site.temperatureC > 5 ? -1 : 0;
  const nextShift = clamp((state.phenology.shift ?? 0) + seasonalShift, -2, 2);

  const nextState: SpeciesState = {
    ...state,
    population: round(population, 2),
    health: round(health, 1),
    seedBank: round(seedBank, 2),
    status: getStatus(population, profile.carryingCapacity, health),
    phenology: {
      bloomStartDay: state.phenology.bloomStartDay,
      bloomPeakDay: state.phenology.bloomPeakDay,
      bloomEndDay: state.phenology.bloomEndDay,
      shift: nextShift
    }
  };

  return {
    state: nextState,
    mortality: round(mortality, 2),
    recruitment: round(recruitment, 2)
  };
}

function coldStressRate(site: SiteState, definition: SpeciesDefinition): number {
  const threshold = definition.preferred.temperatureC - definition.tolerance.temperatureC;
  if (site.temperatureC >= threshold) {
    return 0;
  }
  return clamp((threshold - site.temperatureC) / 60, 0, 0.05);
}

function extremeMortalityRate(
  extreme: ExtremeClimateType,
  definition: SpeciesDefinition,
  site: SiteState
): number {
  const coldSensitive = clamp((definition.preferred.temperatureC - 10) / 14, 0, 1);
  switch (extreme) {
    case 'cold_wave':
      return 0.08 + 0.1 * coldSensitive;
    case 'snowstorm':
      return 0.05 + 0.07 * coldSensitive + (site.windSpeed > 8 ? 0.03 : 0);
    case 'winter_drought': {
      const moistureNeed = clamp((definition.preferred.soilMoisture - 55) / 35, 0, 1);
      return 0.05 + 0.09 * moistureNeed;
    }
    case 'warm_spell':
      // 暖冬直接死亡率低，但会扰乱休眠并消耗种子库
      return 0.01 + 0.015 * coldSensitive;
    default:
      return 0;
  }
}

function extremeHealthDamage(extreme: ExtremeClimateType, definition: SpeciesDefinition): number {
  const coldSensitive = clamp((definition.preferred.temperatureC - 10) / 14, 0, 1);
  switch (extreme) {
    case 'cold_wave':
      return 7 + 6 * coldSensitive;
    case 'snowstorm':
      return 5 + 4 * coldSensitive;
    case 'winter_drought':
      return 6 + 4 * clamp((definition.preferred.soilMoisture - 55) / 35, 0, 1);
    case 'warm_spell':
      return 2.5;
    default:
      return 0;
  }
}

function seedRetentionRate(
  extreme: ExtremeClimateType,
  severity: number,
  definition: SpeciesDefinition,
  site: SiteState
): number {
  let rate = 0.7;
  if (extreme === 'cold_wave') {
    rate -= 0.16 * severity;
  } else if (extreme === 'snowstorm') {
    // 积雪反而为地表种子提供隔温层
    rate += 0.05 * severity;
  } else if (extreme === 'warm_spell') {
    rate -= 0.22 * severity;
  } else if (extreme === 'winter_drought') {
    rate -= 0.14 * severity;
  }
  if (site.soilMoisture < 28) {
    rate -= 0.06;
  }
  if (definition.lifeForm.includes('乔木')) {
    rate += 0.03;
  }
  return clamp(rate, 0.3, 0.92);
}

export function round(value: number, digits = 0): number {
  const factorValue = 10 ** digits;
  return Math.round(value * factorValue) / factorValue;
}

export interface DispersalOptions {
  corridorAccess?: Partial<Record<string, number>>;
}

/**
 * 越冬扩散沿迁移走廊发生：
 * - 走廊基础通行能力受两端区域干扰和当年冬季极端气候调节
 * - 只有高于拥挤阈值的源种群输出个体，迁入受目标承载力空缺约束
 * - 同步发生种子流：源种群越繁盛、种子库越充实，越能在适宜但空缺的
 *   目标生境定植，实现种群、种子库与承载力的联动
 */
export function disperseSpecies(
  states: SpeciesState[],
  sites: SiteState[],
  options: DispersalOptions = {}
): SpeciesState[] {
  return disperseSpeciesDetailed(states, sites, options).states;
}

export function disperseSpeciesDetailed(
  states: SpeciesState[],
  sites: SiteState[],
  options: DispersalOptions = {}
): DispersalResult {
  const siteMap = new Map(sites.map((site) => [site.siteId, site]));
  const bySpecies = new Map<string, Map<SiteId, SpeciesState>>();

  for (const state of states) {
    const group = bySpecies.get(state.speciesId) ?? new Map<SiteId, SpeciesState>();
    group.set(state.siteId, state);
    bySpecies.set(state.speciesId, group);
  }

  const dispersed = new Map<string, SpeciesState>();
  for (const group of bySpecies.values()) {
    for (const state of group.values()) {
      dispersed.set(`${state.siteId}:${state.speciesId}`, { ...state });
    }
  }

  let totalMigrants = 0;
  let totalSeedRain = 0;

  for (const [speciesId, group] of bySpecies) {
    const definition = SPECIES_BY_ID.get(speciesId);
    if (!definition) continue;

    for (const [sourceSiteId, sourceState] of group) {
      const sourceProfile = definition.zones[sourceSiteId];
      const sourceSite = siteMap.get(sourceSiteId);
      if (!sourceProfile || !sourceSite || sourceState.health < 65) continue;
      if (sourceState.population < sourceProfile.carryingCapacity * 0.82) continue;
      const source = dispersed.get(`${sourceSiteId}:${speciesId}`)!;

      for (const corridor of corridorsFrom(sourceSiteId)) {
        const neighborId = corridor.from === sourceSiteId ? corridor.to : corridor.from;
        const neighborProfile = definition.zones[neighborId];
        const neighborSite = siteMap.get(neighborId);
        const targetState = dispersed.get(`${neighborId}:${speciesId}`);
        if (!neighborProfile || !neighborSite || !targetState) continue;
        const suitability = getSuitability(definition, neighborSite);
        if (suitability < 0.55 || targetState.population >= neighborProfile.carryingCapacity * 0.95) continue;

        const access = options.corridorAccess?.[corridor.id] ?? corridor.basePermeability;
        const vacancy = clamp(
          (neighborProfile.carryingCapacity * 0.95 - targetState.population) /
            Math.max(1, neighborProfile.carryingCapacity),
          0,
          1
        );

        const surplus = Math.max(0, source.population - sourceProfile.carryingCapacity * 0.8);
        const corridorCapacity = sourceProfile.carryingCapacity * 0.12 * access;
        const migrants = Math.min(
          surplus,
          source.population * 0.05 * definition.ecology.dispersalRate * access,
          corridorCapacity,
          Math.max(0, neighborProfile.carryingCapacity * 0.95 - targetState.population)
        );
        if (migrants >= 0.1) {
          source.population = round(Math.max(0, source.population - migrants), 2);
          source.status = getStatus(source.population, sourceProfile.carryingCapacity, source.health);
          targetState.population = round(targetState.population + migrants, 2);
          targetState.status = getStatus(
            targetState.population,
            neighborProfile.carryingCapacity,
            targetState.health
          );
          targetState.suitability = round(suitability, 3);
          totalMigrants += migrants;
        }

        // 种子流：只有目标生境足够适宜且仍有空缺时才会定植
        if (vacancy > 0.05 && suitability >= 0.6) {
          const seedExport =
            source.seedBank *
            0.04 *
            definition.ecology.dispersalRate *
            access *
            clamp(source.health / 100, 0.2, 1);
          const germinated = seedExport * suitability * vacancy * 0.5;
          const room = Math.max(0, neighborProfile.carryingCapacity - targetState.population);
          const settled = Math.min(germinated, room);
          if (settled >= 0.05) {
            source.seedBank = round(Math.max(0, source.seedBank - seedExport), 2);
            targetState.population = round(targetState.population + settled, 2);
            targetState.seedBank = round(targetState.seedBank + (seedExport - settled), 2);
            targetState.status = getStatus(
              targetState.population,
              neighborProfile.carryingCapacity,
              targetState.health
            );
            targetState.suitability = round(suitability, 3);
            totalSeedRain += settled;
          }
        }
      }
    }
  }

  const grouped: Record<string, SpeciesState[]> = {};
  for (const state of dispersed.values()) {
    (grouped[state.siteId] ??= []).push(state);
  }
  const resultStates = states.map(
    (original) =>
      grouped[original.siteId]?.find((state) => state.speciesId === original.speciesId) ?? original
  );
  return { states: resultStates, totalMigrants: round(totalMigrants, 2), totalSeedRain: round(totalSeedRain, 2) };
}

function corridorsFrom(siteId: SiteId): CorridorDefinition[] {
  return CORRIDORS.filter((corridor) => corridor.from === siteId || corridor.to === siteId);
}
