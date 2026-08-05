import { describe, expect, it } from 'vitest';

import { addDays, toDateOnly } from '@/lib/date/dateOnly';
import type { GeneratePlanInput } from '@/lib/engine';

import { formatPlan } from './print-plan';

/**
 * Human-readable plan snapshots (KICKOFF §6).
 *
 * "A plan can pass every automated test and still be one no sensible coach
 * would prescribe. This is the failure mode tests don't catch."
 *
 * These are written as *file* snapshots rather than inline ones so they show
 * up in a diff as readable training weeks. Review them by reading them, not
 * by checking they pass.
 */

const TODAY = toDateOnly('2026-08-05');

const raceIn = (weeks: number) => addDays(TODAY, weeks * 7 - 1);

const base = {
  todayLocal: TODAY,
  division: 'OPEN_SINGLES',
  baselineConfidence: 'HIGH',
  weakestStations: ['WALL_BALLS', 'SLED_PUSH'],
} as const satisfies Partial<GeneratePlanInput>;

describe('plan snapshots', () => {
  it('1. BEGINNER, 16 weeks, 3 days/week, bodyweight + dumbbells', async () => {
    await expect(
      formatPlan('PROFILE 1 — BEGINNER · 16 weeks · 3 days/week · bodyweight + dumbbells', {
        ...base,
        raceDate: raceIn(16),
        background: 'BEGINNER',
        sessionsPerWeek: 3,
        currentWeeklyRunM: 8000,
        baselineConfidence: 'LOW',
        longestRunMins: 22,
      }),
    ).toMatchFileSnapshot('./__snapshots__/01-beginner-16w-3d.txt');
  });

  it('2. RUNNER, 12 weeks, 5 days/week, full commercial gym', async () => {
    await expect(
      formatPlan('PROFILE 2 — RUNNER · 12 weeks · 5 days/week · commercial gym', {
        ...base,
        raceDate: raceIn(12),
        background: 'RUNNER',
        sessionsPerWeek: 5,
        currentWeeklyRunM: 45000,
        longestRunMins: 95,
      }),
    ).toMatchFileSnapshot('./__snapshots__/02-runner-12w-5d.txt');
  });

  it('3. STRENGTH, 8 weeks, 4 days/week, full HYROX gym', async () => {
    await expect(
      formatPlan('PROFILE 3 — STRENGTH · 8 weeks · 4 days/week · full HYROX gym', {
        ...base,
        raceDate: raceIn(8),
        background: 'STRENGTH',
        sessionsPerWeek: 4,
        currentWeeklyRunM: 12000,
        longestRunMins: 35,
      }),
    ).toMatchFileSnapshot('./__snapshots__/03-strength-8w-4d.txt');
  });

  it('4. HYBRID, no race date, 4 days/week, home gym', async () => {
    await expect(
      formatPlan('PROFILE 4 — HYBRID · no race date (rolling) · 4 days/week · home gym', {
        ...base,
        raceDate: null,
        background: 'HYBRID',
        sessionsPerWeek: 4,
        currentWeeklyRunM: 20000,
        longestRunMins: 50,
      }),
    ).toMatchFileSnapshot('./__snapshots__/04-hybrid-rolling-4d.txt');
  });

  it('5. BEGINNER, 3 weeks out — insufficient runway', async () => {
    await expect(
      formatPlan('PROFILE 5 — BEGINNER · 3 weeks · insufficient runway (§7.6)', {
        ...base,
        raceDate: raceIn(3),
        background: 'BEGINNER',
        sessionsPerWeek: 3,
        currentWeeklyRunM: 6000,
        baselineConfidence: 'LOW',
        longestRunMins: 18,
      }),
    ).toMatchFileSnapshot('./__snapshots__/05-beginner-3w-runway.txt');
  });

  it('6. HYBRID, 5 weeks, 2 days/week — minimum viable case', async () => {
    await expect(
      formatPlan('PROFILE 6 — HYBRID · 5 weeks · 2 days/week · minimum viable', {
        ...base,
        raceDate: raceIn(5),
        background: 'HYBRID',
        sessionsPerWeek: 2,
        currentWeeklyRunM: 15000,
        longestRunMins: 45,
      }),
    ).toMatchFileSnapshot('./__snapshots__/06-hybrid-5w-2d.txt');
  });

  it('7. BEGINNER, 16 weeks, 4 days/week, very low running volume', async () => {
    // Not in KICKOFF's list. Added because the guardrail work showed
    // low-volume athletes are where the engine behaves least like a coach
    // (ERRATA F34) — worth a human read.
    await expect(
      formatPlan('PROFILE 7 — BEGINNER · 16 weeks · 4 days/week · 3 km/week starting volume', {
        ...base,
        raceDate: raceIn(16),
        background: 'BEGINNER',
        sessionsPerWeek: 4,
        currentWeeklyRunM: 3000,
        baselineConfidence: 'LOW',
        longestRunMins: 12,
      }),
    ).toMatchFileSnapshot('./__snapshots__/07-beginner-16w-lowvolume.txt');
  });
});
