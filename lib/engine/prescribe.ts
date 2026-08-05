import type { StationId } from '@/lib/seeds/types';

import { dayOffsetsForWeek } from './calendar';
import type { Gate } from './gates';
import { BEGINNER_INTERVAL_UNLOCK_MINUTES } from './gates';
import { compromisedRunFor } from './progression/compromised';
import type { IntensityZone } from './progression/running';
import { BASE_ZONE, zoneSpec } from './progression/running';
import type { WeeklyVolume } from './progression/volume';
import type { SessionType, SlotKind } from './templates';
import { templateFor } from './templates';
import type { AthleticBackground, PhaseAllocation, PhaseSpan, PhaseType } from './types';
import { phaseSpans } from './phases';

/**
 * Session assembly (PRD §F3).
 *
 * Turns a week's slot kinds into concrete sessions with SI prescriptions,
 * consuming the running budget decided by `progression/volume.ts` rather than
 * generating work and totalling it afterwards (ERRATA R2).
 *
 * Every user-facing string is an i18n key plus parameters (D5). No prose
 * leaves this module.
 */

/** Total running metres in a full race simulation: 8 x 1km. */
export const SIMULATION_RUNNING_M = 8000;

/** Shortest run worth prescribing; below this a slot becomes recovery instead. */
export const MIN_RUN_DISTANCE_M = 1000;

/** Guardrail 5: no race simulation within this many days of race day. */
export const SIMULATION_EXCLUSION_DAYS = 10;

export type Prescription =
  | { readonly kind: 'RUN'; readonly distanceM: number; readonly zone: IntensityZone }
  | {
      readonly kind: 'INTERVALS';
      readonly reps: number;
      readonly repDistanceM: number;
      readonly recoverySecs: number;
      readonly zone: IntensityZone;
    }
  | {
      readonly kind: 'COMPROMISED_ROUNDS';
      readonly rounds: number;
      readonly stationsPerRound: number;
      readonly runDistanceM: number;
      readonly zone: IntensityZone;
      readonly raceOrderSequence: boolean;
    }
  | { readonly kind: 'SIMULATION'; readonly runDistanceM: number; readonly stations: number }
  | {
      readonly kind: 'STRENGTH';
      readonly movementPatternKeys: readonly string[];
      readonly sets: number;
      readonly reps: number;
    }
  | { readonly kind: 'STATION_SKILL'; readonly stations: readonly StationId[]; readonly rounds: number }
  | { readonly kind: 'MOBILITY'; readonly durationSecs: number }
  | { readonly kind: 'REST' };

export interface SessionBlock {
  readonly order: number;
  readonly titleKey: string;
  readonly prescription: Prescription;
  readonly targetRpeMin?: number;
  readonly targetRpeMax?: number;
}

export interface PlannedSession {
  readonly dayOffset: number;
  readonly weekIndex: number;
  readonly phase: PhaseType;
  readonly type: SessionType;
  readonly titleKey: string;
  readonly rationaleKey: string;
  readonly params: Readonly<Record<string, number | string>>;
  readonly blocks: readonly SessionBlock[];
  /** Null when the session is served unconditionally (§7.5). */
  readonly gate: Gate | null;
}

export interface WeekPrescriptionInput {
  readonly weekIndex: number;
  readonly volume: WeeklyVolume;
  readonly allocation: PhaseAllocation;
  readonly sessionsPerWeek: number;
  readonly background: AthleticBackground;
  /** Total plan length, for guardrail 5's race-day exclusion. */
  readonly totalWeeks: number;
  /** Ranked weakest stations, used to bias station selection (§7.7). */
  readonly weakestStations: readonly StationId[];
  /** Threshold for the simulation gate, from `compromisedRunThreshold` (F15). */
  readonly simulationGateThreshold: number;
}

function spanFor(spans: readonly PhaseSpan[], phase: PhaseType): PhaseSpan {
  const span = spans.find((candidate) => candidate.type === phase);
  if (span === undefined) throw new Error(`No span for phase ${phase}`);
  return span;
}

/**
 * Whether a Race-Specific hybrid should be a full simulation.
 *
 * Two constraints, both enforced here rather than left to the validator:
 * §7.2's "every 10-14 days" cadence (odd weeks of the phase, so roughly
 * fortnightly), and guardrail 5's exclusion window. Generating a compliant
 * plan beats generating one and rejecting it.
 */
export function shouldSimulate(
  phase: PhaseType,
  weekInPhase: number,
  dayOffset: number,
  totalWeeks: number,
): boolean {
  if (phase !== 'RACE_SPECIFIC') return false;
  if (weekInPhase % 2 === 0) return false;

  const raceDayOffset = totalWeeks * 7 - 1;
  return raceDayOffset - dayOffset >= SIMULATION_EXCLUSION_DAYS;
}

/** Fixed warm-up plus cool-down running either side of an interval set. */
export const INTERVAL_FIXED_M = 2000;

/** Fewer repeats than this is not an interval session worth the name. */
export const MIN_INTERVAL_REPS = 3;
export const MAX_INTERVAL_REPS = 6;

/** Share of the run budget the quality session takes in a multi-run week. */
const INTERVAL_BUDGET_SHARE = 0.45;

/**
 * Resolves a RUN slot to a concrete run type for the phase.
 *
 * `intervalsAffordable` is not a stylistic input: an interval session costs a
 * fixed 2km of warm-up and cool-down on top of its repeats, so a week whose
 * budget cannot cover that gets a steady run instead. Prescribing intervals
 * regardless is how the session would silently overshoot the volume ceiling.
 */
export function runTypeFor(
  phase: PhaseType,
  runIndex: number,
  runsThisWeek: number,
  intervalsAffordable = true,
): SessionType {
  if (phase === 'TAPER') return 'EASY_RUN';

  // The first run of the week carries the quality work from Build onwards;
  // Foundation stays aerobic throughout (no intervals until a base exists).
  if (runIndex === 0 && (phase === 'BUILD' || phase === 'RACE_SPECIFIC') && intervalsAffordable) {
    return 'INTERVAL_RUN';
  }

  // The last run of a multi-run week is the long one.
  if (runsThisWeek > 1 && runIndex === runsThisWeek - 1) return 'LONG_RUN';

  return 'EASY_RUN';
}

/**
 * How many 1km repeats the run budget can afford, or 0 for none.
 *
 * Reserving the interval session's metres *before* the steady runs are sized
 * is what keeps the week's total inside its budget (ERRATA R2).
 */
export function affordableIntervalReps(runBudgetM: number, runSlots: number): number {
  if (runSlots <= 0) return 0;
  const share = runSlots === 1 ? runBudgetM : Math.round(runBudgetM * INTERVAL_BUDGET_SHARE);
  const reps = Math.floor((share - INTERVAL_FIXED_M) / 1000);
  return reps >= MIN_INTERVAL_REPS ? Math.min(reps, MAX_INTERVAL_REPS) : 0;
}

/** Picks stations for compromised work: weakest first, then leg-dominant (§7.7). */
export function selectStations(
  weakestStations: readonly StationId[],
  count: number,
  rotation: number,
): readonly StationId[] {
  const legDominant: StationId[] = [
    'SLED_PUSH',
    'SLED_PULL',
    'BURPEE_BROAD_JUMP',
    'SANDBAG_LUNGES',
  ];

  const pool: StationId[] = [];
  for (const station of [...weakestStations, ...legDominant]) {
    if (!pool.includes(station)) pool.push(station);
  }
  if (pool.length === 0) return [];

  const chosen: StationId[] = [];
  for (let i = 0; i < count; i += 1) {
    const station = pool[(rotation + i) % pool.length];
    if (station !== undefined) chosen.push(station);
  }
  return chosen;
}

function strengthBlocks(type: SessionType, phase: PhaseType): readonly SessionBlock[] {
  // Race-Specific cuts general strength volume while retaining short heavy
  // work (§7.2), so sets drop rather than the session disappearing.
  const sets = phase === 'RACE_SPECIFIC' ? 3 : 4;
  const patterns =
    type === 'STRENGTH_LOWER'
      ? ['plan.movement.squat', 'plan.movement.hinge', 'plan.movement.lunge']
      : ['plan.movement.push', 'plan.movement.pull', 'plan.movement.carry'];

  return [
    { order: 1, titleKey: 'plan.block.warmup', prescription: { kind: 'MOBILITY', durationSecs: 600 } },
    {
      order: 2,
      titleKey: 'plan.block.strengthMain',
      prescription: { kind: 'STRENGTH', movementPatternKeys: patterns, sets, reps: 8 },
      targetRpeMin: 6,
      targetRpeMax: 8,
    },
    { order: 3, titleKey: 'plan.block.cooldown', prescription: { kind: 'MOBILITY', durationSecs: 300 } },
  ];
}

function runBlocks(
  type: SessionType,
  distanceM: number,
  zone: IntensityZone,
  reps = 0,
): readonly SessionBlock[] {
  const spec = zoneSpec(zone);

  if (type === 'INTERVAL_RUN') {
    // 1km repeats at threshold: the §7.8 pattern, and the closest thing in
    // training to a race run segment. `distanceM` is the session total, so
    // whatever is not repeats becomes warm-up and cool-down.
    const easyM = Math.max(0, distanceM - reps * 1000);
    const warmupM = Math.floor(easyM / 2);
    const cooldownM = easyM - warmupM;

    return [
      { order: 1, titleKey: 'plan.block.warmup', prescription: { kind: 'RUN', distanceM: warmupM, zone: 'EASY' } },
      {
        order: 2,
        titleKey: 'plan.block.intervals',
        prescription: { kind: 'INTERVALS', reps, repDistanceM: 1000, recoverySecs: 90, zone },
        targetRpeMin: spec.rpeMin,
        targetRpeMax: spec.rpeMax,
      },
      { order: 3, titleKey: 'plan.block.cooldown', prescription: { kind: 'RUN', distanceM: cooldownM, zone: 'EASY' } },
    ];
  }

  return [
    {
      order: 1,
      titleKey: type === 'LONG_RUN' ? 'plan.block.longRun' : 'plan.block.steadyRun',
      prescription: { kind: 'RUN', distanceM, zone },
      targetRpeMin: spec.rpeMin,
      targetRpeMax: spec.rpeMax,
    },
  ];
}

/**
 * Builds every session for one week.
 *
 * Running metres are allocated from the week's budget in a fixed order:
 * hybrid work first (it is the least negotiable and the most race-specific),
 * then the remainder spread across the run slots. When a simulation consumes
 * most of the budget, run slots shrink and — below {@link MIN_RUN_DISTANCE_M}
 * — become recovery sessions rather than token runs. That is R2's "simulation
 * weeks displace other running" made concrete.
 */
export function prescribeWeek(input: WeekPrescriptionInput): readonly PlannedSession[] {
  const {
    weekIndex,
    volume,
    allocation,
    sessionsPerWeek,
    background,
    totalWeeks,
    weakestStations,
    simulationGateThreshold,
  } = input;

  const phase = volume.phase;
  const spans = phaseSpans(allocation);
  const span = spanFor(spans, phase);
  const weekInPhase = weekIndex - span.startWeek + 1;
  const weeksInPhase = span.endWeek - span.startWeek + 1;

  const template = templateFor(sessionsPerWeek, phase, background);
  const { firstDayOffset } = dayOffsetsForWeek(weekIndex);

  // --- Hybrid work first, so it gets its metres before anything else. ---
  const compromised = compromisedRunFor({ phase, weekInPhase, weeksInPhase, background });

  let hybridMetres = 0;
  const hybridPositions = template.slots
    .map((slot, position) => ({ slot, position }))
    .filter((entry) => entry.slot === 'HYBRID')
    .map((entry) => entry.position);

  // A full simulation is 8km of running on its own. An athlete whose whole
  // weekly budget is below that cannot absorb one without breaching guardrail
  // 1, so they keep compromised runs instead (ERRATA F34). Their gate and
  // fallback still give them transition practice.
  const canAffordSimulation = volume.runningBudgetM >= SIMULATION_RUNNING_M;

  const simulationPositions = new Set<number>();
  // Rounds are fitted per slot rather than taken as fixed: §7.7's
  // Race-Specific prescription is 4 x 1km, which on its own exceeds the whole
  // weekly budget of an athlete running under 4km a week. Budget-first means
  // the budget constrains the prescription, not the other way round.
  const roundsByPosition = new Map<number, number>();
  let hybridAllowanceM = volume.runningBudgetM;

  for (const position of hybridPositions) {
    if (
      canAffordSimulation &&
      shouldSimulate(phase, weekInPhase, firstDayOffset + position, totalWeeks) &&
      hybridAllowanceM >= SIMULATION_RUNNING_M
    ) {
      simulationPositions.add(position);
      hybridMetres += SIMULATION_RUNNING_M;
      hybridAllowanceM -= SIMULATION_RUNNING_M;
    } else if (compromised !== null) {
      let rounds = compromised.rounds;
      while (rounds > 1 && rounds * compromised.runDistanceM > hybridAllowanceM) rounds -= 1;
      roundsByPosition.set(position, rounds);
      const metres = rounds * compromised.runDistanceM;
      hybridMetres += metres;
      hybridAllowanceM -= metres;
    }
  }

  // --- Whatever is left goes to the runs. ---
  const runPositions = template.slots
    .map((slot, position) => ({ slot, position }))
    .filter((entry) => entry.slot === 'RUN')
    .map((entry) => entry.position);

  const runBudget = Math.max(0, volume.runningBudgetM - hybridMetres);

  // The quality session is sized first, so its fixed warm-up and cool-down
  // cannot push the week past its budget. Foundation and Taper never take a
  // share, because neither prescribes intervals.
  const wantsIntervals = phase === 'BUILD' || phase === 'RACE_SPECIFIC';
  const intervalReps = wantsIntervals
    ? affordableIntervalReps(runBudget, runPositions.length)
    : 0;
  let intervalMetres = intervalReps > 0 ? INTERVAL_FIXED_M + intervalReps * 1000 : 0;

  // Whatever remains is shared between the steady runs, dropping a slot at a
  // time until each one is worth doing.
  let steadyBudget = runBudget - intervalMetres;
  let steadyRuns = runPositions.length - (intervalReps > 0 ? 1 : 0);
  while (steadyRuns > 0 && steadyBudget / steadyRuns < MIN_RUN_DISTANCE_M) {
    steadyRuns -= 1;
  }

  // Budget no steady slot can absorb goes back into the quality session as a
  // longer warm-up and cool-down, rather than being silently dropped. Left
  // unspent it reads to the validator as an unplanned mid-phase deload — the
  // repeat cap binds hardest for athletes with only one run slot in the week.
  if (intervalReps > 0 && steadyRuns === 0 && steadyBudget > 0) {
    intervalMetres = runBudget;
    steadyBudget = 0;
  }

  const perRunM = steadyRuns > 0 ? Math.round(steadyBudget / steadyRuns) : 0;
  const runsToPrescribe = steadyRuns + (intervalReps > 0 ? 1 : 0);

  const sessions: PlannedSession[] = [];
  let runIndex = 0;
  let strengthIndex = 0;

  template.slots.forEach((slot: SlotKind, position: number) => {
    const dayOffset = firstDayOffset + position;
    const base = { dayOffset, weekIndex, phase } as const;

    if (slot === 'REST') {
      sessions.push({
        ...base,
        type: 'REST',
        titleKey: 'plan.session.rest',
        rationaleKey: 'plan.rationale.rest',
        params: {},
        blocks: [{ order: 1, titleKey: 'plan.block.rest', prescription: { kind: 'REST' } }],
        gate: null,
      });
      return;
    }

    if (slot === 'STRENGTH') {
      const type: SessionType = strengthIndex % 2 === 0 ? 'STRENGTH_LOWER' : 'STRENGTH_UPPER';
      strengthIndex += 1;
      sessions.push({
        ...base,
        type,
        titleKey: type === 'STRENGTH_LOWER' ? 'plan.session.strengthLower' : 'plan.session.strengthUpper',
        rationaleKey: 'plan.rationale.strength',
        params: {},
        blocks: strengthBlocks(type, phase),
        gate: null,
      });
      return;
    }

    if (slot === 'RUN') {
      const currentRunIndex = runIndex;
      runIndex += 1;

      // Displaced by a simulation: recovery beats a token run.
      if (currentRunIndex >= runsToPrescribe) {
        sessions.push({
          ...base,
          type: 'RECOVERY_MOBILITY',
          titleKey: 'plan.session.recovery',
          rationaleKey: 'plan.rationale.displacedBySimulation',
          params: {},
          blocks: [
            { order: 1, titleKey: 'plan.block.mobility', prescription: { kind: 'MOBILITY', durationSecs: 1200 } },
          ],
          gate: null,
        });
        return;
      }

      const type = runTypeFor(phase, currentRunIndex, runsToPrescribe, intervalReps > 0);
      const zone: IntensityZone = type === 'INTERVAL_RUN' ? 'THRESHOLD' : BASE_ZONE;
      const distanceM = type === 'INTERVAL_RUN' ? intervalMetres : perRunM;

      // §7.5: a BEGINNER gets no intervals until they can run 30 minutes
      // unbroken. The fallback is the same duration in Zone 2.
      const gate: Gate | null =
        type === 'INTERVAL_RUN' && background === 'BEGINNER'
          ? {
              condition: {
                type: 'CONTINUOUS_RUN_MINUTES',
                value: BEGINNER_INTERVAL_UNLOCK_MINUTES,
              },
              fallbackType: 'EASY_RUN',
            }
          : null;

      sessions.push({
        ...base,
        type,
        titleKey: `plan.session.${type === 'INTERVAL_RUN' ? 'intervalRun' : type === 'LONG_RUN' ? 'longRun' : 'easyRun'}`,
        rationaleKey: `plan.rationale.${type === 'INTERVAL_RUN' ? 'intervalRun' : 'aerobicBase'}`,
        params: { distanceM },
        blocks: runBlocks(type, distanceM, zone, intervalReps),
        gate,
      });
      return;
    }

    // HYBRID
    if (simulationPositions.has(position)) {
      sessions.push({
        ...base,
        type: 'RACE_SIMULATION',
        titleKey: 'plan.session.raceSimulation',
        rationaleKey: 'plan.rationale.raceSimulation',
        params: { runDistanceM: SIMULATION_RUNNING_M },
        blocks: [
          {
            order: 1,
            titleKey: 'plan.block.simulation',
            prescription: { kind: 'SIMULATION', runDistanceM: SIMULATION_RUNNING_M, stations: 8 },
            targetRpeMin: 7,
            targetRpeMax: 9,
          },
        ],
        // F15: gated on rehearsal, with a compromised run served meanwhile.
        gate: {
          condition: { type: 'COMPROMISED_RUNS_COMPLETED', value: simulationGateThreshold },
          fallbackType: 'COMPROMISED_RUN',
        },
      });
      return;
    }

    if (compromised === null) {
      // Foundation: station skill work, no run coupling (§7.7).
      sessions.push({
        ...base,
        type: 'STATION_SKILL',
        titleKey: 'plan.session.stationSkill',
        rationaleKey: 'plan.rationale.stationSkill',
        params: {},
        blocks: [
          {
            order: 1,
            titleKey: 'plan.block.stationSkill',
            prescription: {
              kind: 'STATION_SKILL',
              stations: selectStations(weakestStations, 4, weekIndex),
              rounds: 3,
            },
            targetRpeMin: 5,
            targetRpeMax: 6,
          },
        ],
        gate: null,
      });
      return;
    }

    const rounds = roundsByPosition.get(position) ?? compromised.rounds;

    sessions.push({
      ...base,
      type: 'COMPROMISED_RUN',
      titleKey: 'plan.session.compromisedRun',
      rationaleKey: 'plan.rationale.compromisedRun',
      params: {
        rounds,
        runDistanceM: compromised.runDistanceM,
      },
      blocks: [
        {
          order: 1,
          titleKey: 'plan.block.compromisedRounds',
          prescription: {
            kind: 'COMPROMISED_ROUNDS',
            rounds,
            stationsPerRound: compromised.stationsPerRound,
            runDistanceM: compromised.runDistanceM,
            zone: compromised.zone,
            raceOrderSequence: compromised.raceOrderSequence,
          },
          targetRpeMin: zoneSpec(compromised.zone).rpeMin,
          targetRpeMax: zoneSpec(compromised.zone).rpeMax,
        },
      ],
      gate: null,
    });
  });

  return Object.freeze(sessions);
}

/** Total planned running metres in a week's sessions (for guardrail 1). */
export function weeklyRunningMetres(sessions: readonly PlannedSession[]): number {
  let total = 0;
  for (const session of sessions) {
    for (const block of session.blocks) {
      const p = block.prescription;
      switch (p.kind) {
        case 'RUN':
          total += p.distanceM;
          break;
        case 'INTERVALS':
          total += p.reps * p.repDistanceM;
          break;
        case 'COMPROMISED_ROUNDS':
          total += p.rounds * p.runDistanceM;
          break;
        case 'SIMULATION':
          total += p.runDistanceM;
          break;
        default:
          break;
      }
    }
  }
  return total;
}
