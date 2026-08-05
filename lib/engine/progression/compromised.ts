import type { AthleticBackground, PhaseType } from '../types';
import type { IntensityZone } from './running';

/**
 * Compromised-running progression (PRD §7.7).
 *
 * The single most HYROX-specific concept in the domain: running immediately
 * after a fatiguing station, where accumulated lactate and biomechanical
 * breakdown make the run feel nothing like running on fresh legs. Seven of
 * the eight race runs happen in this state, and the lab study found stations
 * produce *higher* peak lactate and RPE than the runs themselves — so
 * training the transition is what separates a finish from a time.
 */

export interface CompromisedRunPrescription {
  /** Stations completed before each run segment. */
  readonly stationsPerRound: number;
  readonly runDistanceM: number;
  readonly rounds: number;
  readonly zone: IntensityZone;
  /**
   * True once rounds follow the actual race order rather than a selection of
   * stations — the final progression before a full simulation.
   */
  readonly raceOrderSequence: boolean;
}

export interface CompromisedRunContext {
  readonly phase: PhaseType;
  /** 1-based week within the phase. */
  readonly weekInPhase: number;
  /** Total weeks in this phase, needed to find its final week. */
  readonly weeksInPhase: number;
  readonly background: AthleticBackground;
}

/**
 * The Build week 1-2 prescription, also used when a `STRENGTH` athlete gets
 * compromised running a week early.
 */
const BUILD_INTRODUCTORY: CompromisedRunPrescription = Object.freeze({
  stationsPerRound: 1,
  runDistanceM: 400,
  rounds: 3,
  zone: 'THRESHOLD',
  raceOrderSequence: false,
});

/**
 * Total running metres in a compromised session, which feeds the weekly
 * running budget (ERRATA R2 — every planned metre counts).
 */
export function compromisedRunningMetres(prescription: CompromisedRunPrescription): number {
  return prescription.runDistanceM * prescription.rounds;
}

/**
 * The prescription for a given phase and week, or null where compromised
 * running is not yet prescribed.
 *
 * Two determinism decisions the PRD leaves open (ERRATA F33):
 *
 *  - §7.7's "Build wk 3+: ×3-4 rounds" is a range. Week 3 gets 3 rounds and
 *    week 4 onwards gets 4, so volume still progresses rather than sitting
 *    at an arbitrary point in the range.
 *  - §7.7 gives Taper only "1 short session, reduced volume, race pace only".
 *    Read as 2 rounds at race distance: enough to rehearse the transition,
 *    little enough to leave the athlete fresh.
 */
export function compromisedRunFor(
  context: CompromisedRunContext,
): CompromisedRunPrescription | null {
  const { phase, weekInPhase, weeksInPhase, background } = context;

  if (!Number.isInteger(weekInPhase) || weekInPhase < 1) {
    throw new RangeError(`weekInPhase must be a positive integer, received ${weekInPhase}.`);
  }
  if (!Number.isInteger(weeksInPhase) || weeksInPhase < 1) {
    throw new RangeError(`weeksInPhase must be a positive integer, received ${weeksInPhase}.`);
  }

  switch (phase) {
    case 'FOUNDATION': {
      // §7.7: not prescribed in Foundation — station circuits only, no run
      // coupling. The one exception is ERRATA F10: §7.3 gives a STRENGTH
      // background compromised running "one week earlier", which can only
      // mean the final Foundation week. Their gap is precisely the ability to
      // hold form and pace while fatigued.
      const isFinalFoundationWeek = weekInPhase === weeksInPhase;
      if (background === 'STRENGTH' && isFinalFoundationWeek) return BUILD_INTRODUCTORY;
      return null;
    }

    case 'BUILD': {
      if (weekInPhase <= 2) return BUILD_INTRODUCTORY;
      return Object.freeze({
        stationsPerRound: 1,
        runDistanceM: 800,
        rounds: weekInPhase === 3 ? 3 : 4,
        zone: 'THRESHOLD',
        raceOrderSequence: false,
      });
    }

    case 'RACE_SPECIFIC':
      return Object.freeze({
        stationsPerRound: 2,
        runDistanceM: 1000,
        rounds: 4,
        zone: 'THRESHOLD',
        // Race-order sequences follow once the athlete has a week of
        // two-station rounds behind them.
        raceOrderSequence: weekInPhase >= 2,
      });

    case 'TAPER':
      return Object.freeze({
        stationsPerRound: 1,
        runDistanceM: 1000,
        rounds: 2,
        zone: 'THRESHOLD',
        raceOrderSequence: true,
      });
  }
}

/**
 * Stations that most impair the run that follows, in priority order.
 *
 * §7.7: selection favours the athlete's weakest stations and the leg-dominant
 * ones. These four are leg-dominant; the research names sled push, sled pull
 * and lunges as the heaviest contributors to running impairment, with burpee
 * broad jumps close behind.
 */
export const LEG_DOMINANT_STATION_IDS = [
  'SLED_PUSH',
  'SLED_PULL',
  'BURPEE_BROAD_JUMP',
  'SANDBAG_LUNGES',
] as const;
