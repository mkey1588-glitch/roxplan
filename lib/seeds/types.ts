/**
 * Domain vocabulary for HYROX seed data.
 *
 * These types describe the race itself, which is fixed and identical
 * worldwide — they are not user configuration. Race loads and rules change
 * between seasons, so the values live in versioned files under `seeds/` and
 * never in engine logic (CLAUDE.md).
 *
 * All quantities are SI, with unit-carrying names (DECISIONS.md D3).
 */

/** The eight stations, in fixed race order. */
export const STATION_IDS = [
  'SKI_ERG',
  'SLED_PUSH',
  'SLED_PULL',
  'BURPEE_BROAD_JUMP',
  'ROWING',
  'FARMERS_CARRY',
  'SANDBAG_LUNGES',
  'WALL_BALLS',
] as const;

export type StationId = (typeof STATION_IDS)[number];

/**
 * Every division HYROX runs.
 *
 * All five values exist because seed data and the PFT's division guidance
 * need them, but v1 supports only the two Singles divisions — the engine
 * throws `UnsupportedDivisionError` for the rest rather than silently
 * generating a Singles plan (DECISIONS.md D1).
 */
export const DIVISIONS = [
  'OPEN_SINGLES',
  'PRO_SINGLES',
  'DOUBLES',
  'MIXED_DOUBLES',
  'RELAY',
] as const;

export type Division = (typeof DIVISIONS)[number];

/**
 * Which set of race loads applies.
 *
 * This selects a row in the division load table — HYROX runs men's and
 * women's divisions with different weights. It is a race-category input,
 * not a general profile attribute.
 */
export const SEXES = ['FEMALE', 'MALE'] as const;

export type Sex = (typeof SEXES)[number];

/** Equipment colour coding, as printed in the rulebook. */
export type LoadColour = 'WHITE' | 'GREY' | 'BLACK';

/** Work prescribed at a station: either a distance or a rep count. */
export type StationWork =
  | { readonly kind: 'DISTANCE'; readonly distanceM: number; readonly lengths?: number; readonly lengthM?: number }
  | { readonly kind: 'REPS'; readonly reps: number };

export interface Station {
  readonly id: StationId;
  /** 1-8, the fixed race order. */
  readonly order: number;
  readonly work: StationWork;
  readonly primaryDemand: string;
}

export interface StationsSeed {
  readonly stations: readonly Station[];
  readonly run: {
    readonly segments: number;
    readonly segmentDistanceM: number;
  };
}

/**
 * The load at a single station, for one division and sex.
 *
 * Discriminated because the stations are not commensurable: a sled is a
 * single total mass that includes the sled itself, a farmers carry is a mass
 * per hand, and a wall ball has a target height as well as a mass.
 */
export type StationLoad =
  | { readonly kind: 'SLED'; readonly totalKg: number; readonly includesSled: true }
  | { readonly kind: 'PER_HAND'; readonly perHandKg: number; readonly hands: 2; readonly colour?: LoadColour }
  | { readonly kind: 'IMPLEMENT'; readonly loadKg: number; readonly colour?: LoadColour }
  | { readonly kind: 'WALL_BALL'; readonly loadKg: number; readonly targetHeightM: number; readonly colour?: LoadColour };

/** The five stations that carry a load. The other three are bodyweight or erg. */
export const LOADED_STATION_IDS = [
  'SLED_PUSH',
  'SLED_PULL',
  'FARMERS_CARRY',
  'SANDBAG_LUNGES',
  'WALL_BALLS',
] as const;

export type LoadedStationId = (typeof LOADED_STATION_IDS)[number];

export type StationLoads = Readonly<Record<LoadedStationId, StationLoad>>;

export interface DivisionsSeed {
  readonly season: string;
  readonly source: {
    readonly document: string;
    readonly url?: string;
    readonly sections?: string;
    readonly retrieved?: string;
  };
  /**
   * Partial by design: a season's rulebook covers only some divisions, and an
   * absent division is a legitimate state that callers must handle rather
   * than a data error.
   */
  readonly divisions: Readonly<Partial<Record<Division, Readonly<Record<Sex, StationLoads>>>>>;
}

/** A segment of the PFT benchmark test. */
export interface PftSegment {
  readonly order: number;
  readonly id: string;
  readonly work: StationWork;
  readonly treadmillInclinePercent?: number;
  readonly jumpDistanceM?: number;
  readonly loadKgBySex?: Readonly<Record<Sex, number>>;
}

export interface PftSeed {
  readonly season: string;
  readonly source: { readonly document: string };
  readonly segments: readonly PftSegment[];
  /** Advisory only. May suggest a division the engine does not support. */
  readonly divisionGuidance: readonly {
    readonly division: Division;
    readonly minTotalSecs: number;
    readonly maxTotalSecs: number;
  }[];
}
