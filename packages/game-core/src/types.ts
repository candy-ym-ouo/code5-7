import type { LeafTexture, PhenologyStage, SampleMethod, Season, SiteId } from '@shanhai/contracts';

export interface SiteDefinition {
  id: SiteId;
  name: string;
  habitat: string;
  description: string;
  mapX: number;
  mapY: number;
  temperatureOffset: number;
  humidityOffset: number;
  soilMoistureOffset: number;
  lightMultiplier: number;
}

export interface ZoneProfile {
  initialPopulation: number;
  carryingCapacity: number;
}

export interface SpeciesDefinition {
  id: string;
  name: string;
  latinName: string;
  lifeForm: string;
  description: string;
  protected: boolean;
  zones: Partial<Record<SiteId, ZoneProfile>>;
  preferred: {
    temperatureC: number;
    humidity: number;
    soilMoisture: number;
    lightLux: number;
  };
  tolerance: {
    temperatureC: number;
    humidity: number;
    soilMoisture: number;
    lightLux: number;
  };
  ecology: {
    growthRate: number;
    stressRate: number;
    seedRate: number;
    dispersalRate: number;
  };
  phenology: Partial<Record<Season, { start: number; peak: number; end: number }>>;
  leafTexture: LeafTexture;
  colors: Record<'green' | 'autumn' | 'winter', string>;
  sampleProtocol: SampleMethod[];
}

export type ExtremeClimateType = 'cold_wave' | 'ice_storm' | 'winter_flood' | 'warm_drought';

export interface ExtremeClimateEvent {
  type: ExtremeClimateType;
  label: string;
  severity: number;
}

export interface SiteState {
  saveId: string;
  year: number;
  siteId: SiteId;
  weather: string;
  temperatureC: number;
  humidity: number;
  soilMoisture: number;
  lightLux: number;
  windSpeed: number;
  disturbance: number;
  /** 上一冬的极端气候事件；仅记录在次年春季的位点状态上，旧年份状态保持不变 */
  winterClimate?: ExtremeClimateEvent | null;
}

export interface PhenologyState {
  bloomStartDay: number;
  bloomPeakDay: number;
  bloomEndDay: number;
  shift: number;
}

export interface SpeciesState {
  saveId: string;
  year: number;
  siteId: SiteId;
  speciesId: string;
  population: number;
  health: number;
  seedBank: number;
  suitability: number;
  status: string;
  phenology: PhenologyState;
  /** 当前实际承载力相对名义承载力的乘数；极端气候会压低它，随后逐季恢复 */
  capacityMultiplier: number;
}

export interface PlantPresentation {
  stage: PhenologyStage;
  label: string;
  dominantColor: string;
  leafTexture: LeafTexture;
}

export interface SampleDecision {
  allowed: boolean;
  reason?: string;
  protocolMatch: boolean;
  effects: {
    health: number;
    populationDelta: number;
    seedBankDelta: number;
  };
  messages: string[];
}

export interface SeasonEvolutionResult {
  state: SpeciesState;
  populationChange: number;
  healthChange: number;
}

export interface OverwinterResult {
  state: SpeciesState;
  climate: ExtremeClimateEvent | null;
  recruitment: number;
}

export interface CorridorMigration {
  speciesId: string;
  from: SiteId;
  to: SiteId;
  population: number;
  seedBank: number;
}

export interface OverwinterDispersalResult {
  states: SpeciesState[];
  migrations: CorridorMigration[];
}
