/**
 * Running intensity and pace (PRD §7.8).
 *
 * Prescriptions carry RPE *and* an optional heart-rate band, because most
 * general-public athletes have no monitor and an HR-only prescription would
 * be unusable for them.
 */

export const INTENSITY_ZONES = ['EASY', 'ZONE_2', 'THRESHOLD', 'HARD'] as const;

export type IntensityZone = (typeof INTENSITY_ZONES)[number];

export interface ZoneSpec {
  readonly zone: IntensityZone;
  /** Inclusive lower bound, percent of maximum heart rate. */
  readonly hrMaxPercentMin: number;
  /** Exclusive upper bound, percent of maximum heart rate. */
  readonly hrMaxPercentMax: number;
  /** Inclusive RPE band on the 1-10 scale the PRD uses. */
  readonly rpeMin: number;
  readonly rpeMax: number;
  /** i18n key describing the zone's purpose (D5). */
  readonly labelKey: string;
}

const ZONE_SPECS: Readonly<Record<IntensityZone, ZoneSpec>> = {
  EASY: {
    zone: 'EASY',
    hrMaxPercentMin: 0,
    hrMaxPercentMax: 70,
    rpeMin: 3,
    rpeMax: 4,
    labelKey: 'plan.zone.easy',
  },
  ZONE_2: {
    zone: 'ZONE_2',
    hrMaxPercentMin: 70,
    hrMaxPercentMax: 80,
    rpeMin: 5,
    rpeMax: 6,
    labelKey: 'plan.zone.zone2',
  },
  THRESHOLD: {
    zone: 'THRESHOLD',
    hrMaxPercentMin: 80,
    hrMaxPercentMax: 90,
    rpeMin: 7,
    rpeMax: 8,
    labelKey: 'plan.zone.threshold',
  },
  HARD: {
    zone: 'HARD',
    hrMaxPercentMin: 90,
    hrMaxPercentMax: 101,
    rpeMin: 9,
    rpeMax: 10,
    labelKey: 'plan.zone.hard',
  },
};

export function zoneSpec(zone: IntensityZone): ZoneSpec {
  return ZONE_SPECS[zone];
}

/**
 * Converts a 5km time into an estimated sustainable HYROX run pace.
 *
 * **This factor is a modelling assumption, not a figure from the PRD or the
 * research** (ERRATA F32). The research establishes only that coaches
 * estimate HYROX pace from a recent 5-10km time trial, and that the race
 * demands threshold-adjacent effort for 60-90+ minutes; it gives no formula.
 * 1.15 is chosen so a 25-minute 5k athlete is prescribed roughly 5:45/km,
 * which lands near the ~6:22/km average the lab study reports for a ~86-minute
 * finish. It needs a coach's eye at the step-7 snapshot review.
 *
 * The estimate is deliberately conservative-by-construction: a pace that is
 * slightly too slow costs a little time on race day, whereas one that is too
 * fast is how a first-timer blows up at the sled.
 */
export const HYROX_PACE_FACTOR_FROM_5K = 1.15;

const FIVE_K_DISTANCE_KM = 5;

/**
 * Estimated goal race pace, in seconds per kilometre.
 *
 * Returns null when no 5km time is available — §7.8 then prescribes by RPE
 * alone, refined after the first logged interval session, rather than
 * inventing a pace from nothing.
 */
export function estimateRacePaceSecsPerKm(fiveKSecs: number | null): number | null {
  if (fiveKSecs === null) return null;
  if (!Number.isFinite(fiveKSecs) || fiveKSecs <= 0) {
    throw new RangeError(`fiveKSecs must be a positive number, received ${fiveKSecs}.`);
  }
  return Math.round((fiveKSecs / FIVE_K_DISTANCE_KM) * HYROX_PACE_FACTOR_FROM_5K);
}

/**
 * Pace for a given zone, relative to estimated race pace.
 *
 * Race pace sits at threshold, so easier zones are proportionally slower.
 * Same caveat as above: these multipliers are a modelling assumption (F32).
 */
const ZONE_PACE_FACTORS: Readonly<Record<IntensityZone, number>> = {
  EASY: 1.25,
  ZONE_2: 1.15,
  THRESHOLD: 1.0,
  HARD: 0.92,
};

export function paceForZoneSecsPerKm(
  racePaceSecsPerKm: number | null,
  zone: IntensityZone,
): number | null {
  if (racePaceSecsPerKm === null) return null;
  return Math.round(racePaceSecsPerKm * ZONE_PACE_FACTORS[zone]);
}

/**
 * The dominant zone for base building.
 *
 * Zone 2 carries the majority of weekly volume in every phase — running is
 * over half the race, and aerobic base is the strongest single predictor of
 * finishing time.
 */
export const BASE_ZONE: IntensityZone = 'ZONE_2';

/**
 * Fallback easy pace when no 5km time is available, in seconds per kilometre.
 *
 * Another modelling assumption (ERRATA F32 family). 7:00/km is a conservative
 * conversational pace for a general-public athlete; erring slow means the
 * capability ceiling below comes out shorter rather than longer.
 */
export const DEFAULT_EASY_PACE_SECS_PER_KM = 420;

/**
 * How much longer than their longest run an athlete may be asked to go.
 *
 * Session length has to progress like everything else. The weekly volume
 * ceiling says nothing about how that volume is split, so without this a week
 * of 8km with one run slot becomes a single 8km run for someone whose longest
 * is 22 minutes — well over double, and precisely the "too-rapid increase"
 * the research names as the main controllable injury risk.
 */
export const SINGLE_RUN_PROGRESSION_FACTOR = 1.2;

/**
 * The longest single run this athlete may be prescribed, in metres.
 *
 * Derived from demonstrated capability in *duration*, then converted to
 * distance. Duration is the honest unit here: a beginner's 22 minutes is a
 * fact about them, whereas the equivalent distance depends on their pace.
 */
export function maxSingleRunMetres(
  longestRunMins: number,
  paceSecsPerKm: number = DEFAULT_EASY_PACE_SECS_PER_KM,
): number {
  if (!Number.isFinite(longestRunMins) || longestRunMins < 0) {
    throw new RangeError(`longestRunMins must be non-negative, received ${longestRunMins}.`);
  }
  if (!Number.isFinite(paceSecsPerKm) || paceSecsPerKm <= 0) {
    throw new RangeError(`paceSecsPerKm must be positive, received ${paceSecsPerKm}.`);
  }
  const secs = longestRunMins * 60 * SINGLE_RUN_PROGRESSION_FACTOR;
  return Math.round((secs / paceSecsPerKm) * 1000);
}
