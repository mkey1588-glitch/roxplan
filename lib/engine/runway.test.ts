import { describe, expect, it } from 'vitest';

import { addDays, toDateOnly } from '@/lib/date/dateOnly';
import enMessages from '@/messages/en.json';

import { deriveRaceCalendar, deriveRollingCalendar, totalDays } from './calendar';
import { generateReadinessPlan, MAX_READINESS_WEEKS } from './runway';
import { ATHLETIC_BACKGROUNDS } from './types';

const TODAY = toDateOnly('2026-08-05');

/** Calendars for every runway length the path must handle. */
const runwayCalendars = [1, 2, 3, 4].map((weeks) =>
  deriveRaceCalendar(TODAY, addDays(TODAY, weeks * 7 - 1)),
);

const lookupMessage = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      enMessages,
    );

describe('routing (guardrail 7)', () => {
  it('refuses runways long enough for a real plan', () => {
    const fiveWeeks = deriveRaceCalendar(TODAY, addDays(TODAY, 5 * 7 - 1));
    expect(() => generateReadinessPlan(fiveWeeks, 'HYBRID')).toThrow(RangeError);
  });

  it('accepts every runway at or below the threshold', () => {
    for (const calendar of runwayCalendars) {
      expect(calendar.weeks).toBeLessThanOrEqual(MAX_READINESS_WEEKS);
      expect(() => generateReadinessPlan(calendar, 'HYBRID')).not.toThrow();
    }
  });

  it('refuses a rolling plan — there is no race to prepare for', () => {
    expect(() => generateReadinessPlan(deriveRollingCalendar(TODAY, 4), 'HYBRID')).toThrow();
  });
});

describe('what the readiness plan prescribes (PRD §7.6)', () => {
  it('is a readiness plan, not a training plan', () => {
    for (const calendar of runwayCalendars) {
      expect(generateReadinessPlan(calendar, 'HYBRID').kind).toBe('READINESS');
    }
  });

  it('prescribes station technique work', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'HYBRID');
      expect(plan.sessions.some((session) => session.type === 'STATION_SKILL')).toBe(true);
    }
  });

  it('prescribes exactly one compromised run when there is room for it', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'HYBRID');
      const compromised = plan.sessions.filter((s) => s.type === 'COMPROMISED_RUN');
      expect(compromised.length).toBeLessThanOrEqual(1);
      if (calendar.weeks >= 2) expect(compromised).toHaveLength(1);
    }
  });

  it('never prescribes a race simulation (§7.6 point 3)', () => {
    for (const calendar of runwayCalendars) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const plan = generateReadinessPlan(calendar, background);
        expect(plan.sessions.some((s) => s.type === 'RACE_SIMULATION')).toBe(false);
      }
    }
  });

  it('never prescribes interval running or heavy lifting', () => {
    // "No new maximal loading, no volume increases over their current habit."
    for (const calendar of runwayCalendars) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const types = generateReadinessPlan(calendar, background).sessions.map((s) => s.type);
        expect(types).not.toContain('INTERVAL_RUN');
        expect(types).not.toContain('STRENGTH_LOWER');
        expect(types).not.toContain('STRENGTH_UPPER');
      }
    }
  });

  it('leaves the last two days as full rest', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'HYBRID');
      const lastDayOffset = totalDays(calendar) - 1;

      for (const back of [1, 2]) {
        const session = plan.sessions.find((s) => s.dayOffset === lastDayOffset - back);
        expect(session?.type).toBe('REST');
      }
    }
  });

  it('keeps the compromised run clear of race day', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'HYBRID');
      const compromised = plan.sessions.find((s) => s.type === 'COMPROMISED_RUN');
      if (compromised === undefined) continue;
      const daysBeforeRace = totalDays(calendar) - 1 - compromised.dayOffset;
      expect(daysBeforeRace).toBeGreaterThanOrEqual(7);
    }
  });

  it('schedules nothing after race day, or before the plan starts', () => {
    for (const calendar of runwayCalendars) {
      for (const session of generateReadinessPlan(calendar, 'HYBRID').sessions) {
        expect(session.dayOffset).toBeGreaterThanOrEqual(0);
        expect(session.dayOffset).toBeLessThan(totalDays(calendar));
      }
    }
  });

  it('never double-books a day', () => {
    for (const calendar of runwayCalendars) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const offsets = generateReadinessPlan(calendar, background).sessions.map(
          (s) => s.dayOffset,
        );
        expect(new Set(offsets).size).toBe(offsets.length);
      }
    }
  });

  it('orders sessions by day', () => {
    for (const calendar of runwayCalendars) {
      const offsets = generateReadinessPlan(calendar, 'HYBRID').sessions.map((s) => s.dayOffset);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
  });
});

describe('honesty (PRD §7.6 points 1 and 4)', () => {
  it('says plainly that there is not enough time', () => {
    for (const calendar of runwayCalendars) {
      expect(generateReadinessPlan(calendar, 'HYBRID').noteKeys).toContain(
        'plan.readiness.notEnoughTime',
      );
    }
  });

  it('states its prohibitions rather than silently omitting the work', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'HYBRID');
      expect(plan.prohibitionKeys).toEqual([
        'plan.readiness.noSimulations',
        'plan.readiness.noNewMaximalLoading',
        'plan.readiness.noVolumeIncrease',
      ]);
    }
  });

  it('offers a BEGINNER a later date and the lower-load divisions', () => {
    for (const calendar of runwayCalendars) {
      const plan = generateReadinessPlan(calendar, 'BEGINNER');
      expect(plan.noteKeys).toContain('plan.readiness.considerLaterRace');
      expect(plan.noteKeys).toContain('plan.readiness.considerRelayOrDoubles');
    }
  });

  it('does not offer those to a non-beginner', () => {
    for (const background of ['RUNNER', 'STRENGTH', 'HYBRID'] as const) {
      const plan = generateReadinessPlan(runwayCalendars[3]!, background);
      expect(plan.noteKeys).not.toContain('plan.readiness.considerLaterRace');
    }
  });

  it('has a real message behind every key it emits (D5)', () => {
    for (const calendar of runwayCalendars) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const plan = generateReadinessPlan(calendar, background);
        const keys = [
          ...plan.noteKeys,
          ...plan.prohibitionKeys,
          ...plan.sessions.map((s) => s.titleKey),
        ];
        for (const key of keys) {
          const message = lookupMessage(key);
          expect(typeof message, `missing message for ${key}`).toBe('string');
          expect(message).not.toBe('');
        }
      }
    }
  });

  it('emits no prose, only keys', () => {
    const plan = generateReadinessPlan(runwayCalendars[3]!, 'BEGINNER');
    for (const key of [...plan.noteKeys, ...plan.prohibitionKeys]) {
      expect(key).toMatch(/^plan\.readiness\./);
      expect(key).not.toContain(' ');
    }
  });
});

describe('determinism', () => {
  it('produces an identical plan for identical inputs', () => {
    for (const calendar of runwayCalendars) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        expect(generateReadinessPlan(calendar, background)).toEqual(
          generateReadinessPlan(calendar, background),
        );
      }
    }
  });
});
