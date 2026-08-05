import { z } from 'zod';

import { DIVISIONS, LOADED_STATION_IDS, SEXES, STATION_IDS } from './types';

/**
 * Runtime validation for the seed files.
 *
 * Seed data is a boundary, so it is parsed rather than trusted: a typo in a
 * load table is a wrong training prescription, and a silently-missing field
 * would surface as `undefined` somewhere deep in the engine. Every object is
 * strict, so an unrecognised key fails loudly instead of being ignored —
 * which is what catches a renamed field after a season update.
 */

const positive = z.number().positive();
const positiveInt = z.number().int().positive();

const colour = z.enum(['WHITE', 'GREY', 'BLACK']);

const stationWork = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('DISTANCE'),
    distanceM: positive,
    lengths: positiveInt.optional(),
    lengthM: positive.optional(),
  }),
  z.strictObject({
    kind: z.literal('REPS'),
    reps: positiveInt,
  }),
]);

export const stationsSeedSchema = z.strictObject({
  $comment: z.string().optional(),
  stations: z
    .array(
      z.strictObject({
        id: z.enum(STATION_IDS),
        order: positiveInt.max(8),
        work: stationWork,
        primaryDemand: z.string().min(1),
      }),
    )
    .length(STATION_IDS.length)
    // The race order is the domain's single most stable fact. If a seed file
    // ever lists the stations out of order, every session that references
    // "the next station" would be quietly wrong.
    .refine(
      (stations) => stations.every((station, index) => station.order === index + 1),
      { message: 'stations must be listed in race order with order 1..8' },
    )
    .refine(
      (stations) => stations.every((station, index) => station.id === STATION_IDS[index]),
      { message: 'station ids must match the fixed race sequence in STATION_IDS' },
    ),
  run: z.strictObject({
    $comment: z.string().optional(),
    segments: positiveInt,
    segmentDistanceM: positive,
  }),
});

const stationLoad = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('SLED'),
    totalKg: positive,
    includesSled: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal('PER_HAND'),
    perHandKg: positive,
    hands: z.literal(2),
    colour: colour.optional(),
  }),
  z.strictObject({
    kind: z.literal('IMPLEMENT'),
    loadKg: positive,
    colour: colour.optional(),
  }),
  z.strictObject({
    kind: z.literal('WALL_BALL'),
    loadKg: positive,
    targetHeightM: positive,
    colour: colour.optional(),
  }),
]);

const stationLoads = z.strictObject(
  Object.fromEntries(LOADED_STATION_IDS.map((id) => [id, stationLoad])) as Record<
    (typeof LOADED_STATION_IDS)[number],
    typeof stationLoad
  >,
);

const loadsBySex = z.strictObject(
  Object.fromEntries(SEXES.map((sex) => [sex, stationLoads])) as Record<
    (typeof SEXES)[number],
    typeof stationLoads
  >,
);

export const divisionsSeedSchema = z.strictObject({
  season: z.string().min(1),
  source: z.strictObject({
    document: z.string().min(1),
    url: z.url().optional(),
    sections: z.string().optional(),
    retrieved: z.string().optional(),
    $comment: z.string().optional(),
  }),
  $comment: z.array(z.string()).optional(),
  divisions: z.partialRecord(z.enum(DIVISIONS), loadsBySex),
});

export const pftSeedSchema = z.strictObject({
  season: z.string().min(1),
  source: z.strictObject({
    document: z.string().min(1),
    $comment: z.string().optional(),
  }),
  $comment: z.array(z.string()).optional(),
  segments: z
    .array(
      z.strictObject({
        order: positiveInt,
        id: z.string().min(1),
        work: stationWork,
        treadmillInclinePercent: z.number().nonnegative().optional(),
        jumpDistanceM: positive.optional(),
        loadKgBySex: z.strictObject({ FEMALE: positive, MALE: positive }).optional(),
      }),
    )
    .min(1)
    .refine(
      (segments) => segments.every((segment, index) => segment.order === index + 1),
      { message: 'PFT segments must be listed in performance order with order 1..n' },
    ),
  divisionGuidance: z
    .array(
      z
        .strictObject({
          division: z.enum(DIVISIONS),
          minTotalSecs: positiveInt,
          maxTotalSecs: positiveInt,
        })
        .refine((band) => band.minTotalSecs < band.maxTotalSecs, {
          message: 'minTotalSecs must be below maxTotalSecs',
        }),
    )
    .min(1),
});
