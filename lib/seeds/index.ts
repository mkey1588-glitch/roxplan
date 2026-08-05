import divisions202627 from '@/seeds/divisions.2026-27.json';
import pft202627 from '@/seeds/pft.2026-27.json';
import stationsJson from '@/seeds/stations.json';

import { divisionsSeedSchema, pftSeedSchema, stationsSeedSchema } from './schema';
import type {
  Division,
  DivisionsSeed,
  PftSeed,
  Sex,
  Station,
  StationId,
  StationLoads,
  StationsSeed,
} from './types';

/**
 * Seed data loading.
 *
 * Files are imported statically rather than read from disk so the same code
 * works in the Next bundle and under Vitest, and so a missing file is a build
 * error rather than a runtime one. Each is parsed on first import: seed data
 * is a trust boundary, and failing at startup beats failing halfway through
 * generating someone's training plan.
 *
 * Adding a season is a new file plus one line in SEASONS below.
 */

/** The season whose rules are current. */
export const CURRENT_SEASON = '2026-27';

const SEASONS = {
  '2026-27': {
    divisions: divisionsSeedSchema.parse(divisions202627) as DivisionsSeed,
    pft: pftSeedSchema.parse(pft202627) as PftSeed,
  },
} as const satisfies Record<string, { divisions: DivisionsSeed; pft: PftSeed }>;

export type Season = keyof typeof SEASONS;

export const SEASON_IDS = Object.keys(SEASONS) as Season[];

/** Thrown when seed data is requested for a season that has no file. */
export class UnknownSeasonError extends Error {
  constructor(readonly season: string) {
    super(
      `No seed data for season ${JSON.stringify(season)}. Known seasons: ${SEASON_IDS.join(', ')}.`,
    );
    this.name = 'UnknownSeasonError';
  }
}

/**
 * Thrown when a division has no loads in a season's seed file.
 *
 * Distinct from `UnsupportedDivisionError`: this means "we have no data",
 * not "the engine refuses to plan for this". A division can be missing here
 * simply because the season's rulebook covers Singles only.
 */
export class MissingDivisionDataError extends Error {
  constructor(
    readonly division: Division,
    readonly season: string,
  ) {
    super(`Season ${season} has no load data for division ${division}.`);
    this.name = 'MissingDivisionDataError';
  }
}

const stations = stationsSeedSchema.parse(stationsJson) as StationsSeed;

/** The 8 stations in fixed race order, plus the run structure. */
export function getStations(): StationsSeed {
  return stations;
}

/** A single station by id. */
export function getStation(id: StationId): Station {
  const station = stations.stations.find((candidate) => candidate.id === id);
  if (station === undefined) {
    // Unreachable while the schema enforces all 8 ids, but the engine must
    // never receive `undefined` where a station is expected.
    throw new Error(`No station with id ${id}`);
  }
  return station;
}

function seasonData(season: string): (typeof SEASONS)[Season] {
  const data = (SEASONS as Record<string, (typeof SEASONS)[Season] | undefined>)[season];
  if (data === undefined) throw new UnknownSeasonError(season);
  return data;
}

/** The full division load table for a season. */
export function getDivisionsSeed(season: string = CURRENT_SEASON): DivisionsSeed {
  return seasonData(season).divisions;
}

/** The PFT definition for a season. */
export function getPftSeed(season: string = CURRENT_SEASON): PftSeed {
  return seasonData(season).pft;
}

/**
 * Race loads for one division and sex.
 *
 * @throws UnknownSeasonError if the season has no seed file
 * @throws MissingDivisionDataError if the season's rulebook does not cover
 *   that division — Doubles and Relay, for instance
 */
export function getStationLoads(
  division: Division,
  sex: Sex,
  season: string = CURRENT_SEASON,
): StationLoads {
  const bySex = seasonData(season).divisions.divisions[division];
  if (bySex === undefined) throw new MissingDivisionDataError(division, season);
  return bySex[sex];
}

/** True if a season's seed data covers a division. */
export function hasDivisionData(division: Division, season: string = CURRENT_SEASON): boolean {
  return seasonData(season).divisions.divisions[division] !== undefined;
}

export * from './types';
