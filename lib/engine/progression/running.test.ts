import { describe, expect, it } from 'vitest';

import {
  BASE_ZONE,
  estimateRacePaceSecsPerKm,
  INTENSITY_ZONES,
  paceForZoneSecsPerKm,
  zoneSpec,
} from './running';

describe('intensity zones (PRD §7.8)', () => {
  it.each([
    ['EASY', 0, 70, 3, 4],
    ['ZONE_2', 70, 80, 5, 6],
    ['THRESHOLD', 80, 90, 7, 8],
    ['HARD', 90, 101, 9, 10],
  ] as const)('%s maps to the PRD bands', (zone, hrMin, hrMax, rpeMin, rpeMax) => {
    expect(zoneSpec(zone)).toMatchObject({
      hrMaxPercentMin: hrMin,
      hrMaxPercentMax: hrMax,
      rpeMin,
      rpeMax,
    });
  });

  it('covers the heart-rate range with no gap or overlap', () => {
    const ordered = INTENSITY_ZONES.map(zoneSpec);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous === undefined || current === undefined) throw new Error('missing zone');
      expect(current.hrMaxPercentMin).toBe(previous.hrMaxPercentMax);
    }
  });

  it('increases RPE monotonically with intensity', () => {
    const ordered = INTENSITY_ZONES.map(zoneSpec);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous === undefined || current === undefined) throw new Error('missing zone');
      expect(current.rpeMin).toBeGreaterThan(previous.rpeMin);
    }
  });

  it('gives every zone an i18n key rather than prose (D5)', () => {
    for (const zone of INTENSITY_ZONES) {
      expect(zoneSpec(zone).labelKey).toMatch(/^plan\.zone\./);
    }
  });

  it('uses Zone 2 as the base zone — the majority of weekly volume', () => {
    expect(BASE_ZONE).toBe('ZONE_2');
  });
});

describe('race pace estimation (PRD §7.8)', () => {
  it('returns null without a 5km time, so the plan falls back to RPE', () => {
    expect(estimateRacePaceSecsPerKm(null)).toBeNull();
    expect(paceForZoneSecsPerKm(null, 'THRESHOLD')).toBeNull();
  });

  it('estimates a slower pace than the athlete’s 5km pace', () => {
    // HYROX running happens on fatigued legs over 60-90 minutes, so nobody
    // holds 5k pace for it.
    const fiveKSecs = 25 * 60;
    const fiveKPace = fiveKSecs / 5;
    const estimate = estimateRacePaceSecsPerKm(fiveKSecs);
    if (estimate === null) throw new Error('expected an estimate');
    expect(estimate).toBeGreaterThan(fiveKPace);
  });

  it('lands a 25-minute 5k athlete near the observed mid-pack pace', () => {
    // The lab study reports ~51 minutes of running for a ~86-minute finish,
    // roughly 6:22/km. A 25-minute 5k athlete should come out somewhat
    // faster than that.
    const estimate = estimateRacePaceSecsPerKm(25 * 60);
    expect(estimate).toBe(345); // 5:45/km
  });

  it('is monotonic — a slower 5k never yields a faster race pace', () => {
    let previous = 0;
    for (let fiveKMins = 15; fiveKMins <= 40; fiveKMins += 1) {
      const estimate = estimateRacePaceSecsPerKm(fiveKMins * 60);
      if (estimate === null) throw new Error('expected an estimate');
      expect(estimate).toBeGreaterThan(previous);
      previous = estimate;
    }
  });

  it('returns whole seconds', () => {
    for (let fiveKMins = 15; fiveKMins <= 40; fiveKMins += 1) {
      expect(Number.isInteger(estimateRacePaceSecsPerKm(fiveKMins * 60))).toBe(true);
    }
  });

  it('rejects a non-positive time', () => {
    expect(() => estimateRacePaceSecsPerKm(0)).toThrow(RangeError);
    expect(() => estimateRacePaceSecsPerKm(-60)).toThrow(RangeError);
  });
});

describe('zone paces', () => {
  const racePace = estimateRacePaceSecsPerKm(25 * 60);

  it('puts threshold at race pace', () => {
    expect(paceForZoneSecsPerKm(racePace, 'THRESHOLD')).toBe(racePace);
  });

  it('gets slower as the zone gets easier', () => {
    const easy = paceForZoneSecsPerKm(racePace, 'EASY');
    const zone2 = paceForZoneSecsPerKm(racePace, 'ZONE_2');
    const threshold = paceForZoneSecsPerKm(racePace, 'THRESHOLD');
    const hard = paceForZoneSecsPerKm(racePace, 'HARD');
    if (easy === null || zone2 === null || threshold === null || hard === null) {
      throw new Error('expected paces');
    }
    expect(easy).toBeGreaterThan(zone2);
    expect(zone2).toBeGreaterThan(threshold);
    expect(threshold).toBeGreaterThan(hard);
  });

  it('is deterministic', () => {
    for (const zone of INTENSITY_ZONES) {
      expect(paceForZoneSecsPerKm(racePace, zone)).toBe(paceForZoneSecsPerKm(racePace, zone));
    }
  });
});
