import { describe, expect, it } from 'vitest';

import {
  CURRENT_SEASON,
  DIVISIONS,
  getDivisionsSeed,
  getPftSeed,
  getStation,
  getStationLoads,
  getStations,
  hasDivisionData,
  LOADED_STATION_IDS,
  MissingDivisionDataError,
  SEXES,
  STATION_IDS,
  UnknownSeasonError,
} from './index';

describe('stations seed', () => {
  it('lists all 8 stations in fixed race order', () => {
    const { stations } = getStations();
    expect(stations).toHaveLength(8);
    expect(stations.map((s) => s.id)).toEqual([...STATION_IDS]);
    expect(stations.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('describes 8km of running as 8 x 1km', () => {
    const { run } = getStations();
    expect(run.segments).toBe(8);
    expect(run.segmentDistanceM).toBe(1000);
    expect(run.segments * run.segmentDistanceM).toBe(8000);
  });

  it('prescribes the rulebook distances and reps', () => {
    expect(getStation('SKI_ERG').work).toEqual({ kind: 'DISTANCE', distanceM: 1000 });
    expect(getStation('ROWING').work).toEqual({ kind: 'DISTANCE', distanceM: 1000 });
    expect(getStation('BURPEE_BROAD_JUMP').work).toEqual({ kind: 'DISTANCE', distanceM: 80 });
    expect(getStation('FARMERS_CARRY').work).toEqual({ kind: 'DISTANCE', distanceM: 200 });
    expect(getStation('SANDBAG_LUNGES').work).toEqual({ kind: 'DISTANCE', distanceM: 100 });
    expect(getStation('WALL_BALLS').work).toEqual({ kind: 'REPS', reps: 100 });
  });

  it('splits both sleds into 4 x 12.5m lengths', () => {
    for (const id of ['SLED_PUSH', 'SLED_PULL'] as const) {
      const work = getStation(id).work;
      expect(work).toEqual({ kind: 'DISTANCE', distanceM: 50, lengths: 4, lengthM: 12.5 });
      if (work.kind !== 'DISTANCE' || work.lengths === undefined || work.lengthM === undefined) {
        throw new Error('expected a lane-split distance');
      }
      expect(work.lengths * work.lengthM).toBe(work.distanceM);
    }
  });
});

describe('division loads', () => {
  it('matches the 26/27 Singles rulebook for Open', () => {
    expect(getStationLoads('OPEN_SINGLES', 'FEMALE')).toEqual({
      SLED_PUSH: { kind: 'SLED', totalKg: 102, includesSled: true },
      SLED_PULL: { kind: 'SLED', totalKg: 78, includesSled: true },
      FARMERS_CARRY: { kind: 'PER_HAND', perHandKg: 16, hands: 2, colour: 'WHITE' },
      SANDBAG_LUNGES: { kind: 'IMPLEMENT', loadKg: 10, colour: 'WHITE' },
      WALL_BALLS: { kind: 'WALL_BALL', loadKg: 4, targetHeightM: 2.7, colour: 'WHITE' },
    });

    expect(getStationLoads('OPEN_SINGLES', 'MALE')).toEqual({
      SLED_PUSH: { kind: 'SLED', totalKg: 152, includesSled: true },
      SLED_PULL: { kind: 'SLED', totalKg: 103, includesSled: true },
      FARMERS_CARRY: { kind: 'PER_HAND', perHandKg: 24, hands: 2, colour: 'GREY' },
      SANDBAG_LUNGES: { kind: 'IMPLEMENT', loadKg: 20, colour: 'GREY' },
      WALL_BALLS: { kind: 'WALL_BALL', loadKg: 6, targetHeightM: 3.0, colour: 'GREY' },
    });
  });

  it('matches the 26/27 Singles rulebook for Pro', () => {
    expect(getStationLoads('PRO_SINGLES', 'MALE')).toEqual({
      SLED_PUSH: { kind: 'SLED', totalKg: 202, includesSled: true },
      SLED_PULL: { kind: 'SLED', totalKg: 153, includesSled: true },
      FARMERS_CARRY: { kind: 'PER_HAND', perHandKg: 32, hands: 2, colour: 'BLACK' },
      SANDBAG_LUNGES: { kind: 'IMPLEMENT', loadKg: 30, colour: 'BLACK' },
      WALL_BALLS: { kind: 'WALL_BALL', loadKg: 9, targetHeightM: 3.0, colour: 'BLACK' },
    });
  });

  it('puts a Pro woman on exactly an Open man’s loads, except target height', () => {
    // The rulebook prints "WOMEN PRO / MEN" as a single row, so this is a
    // domain invariant rather than a coincidence of the data. Wall ball
    // target height is the one exception: it tracks sex, not the ladder.
    const proWomen = getStationLoads('PRO_SINGLES', 'FEMALE');
    const openMen = getStationLoads('OPEN_SINGLES', 'MALE');

    expect(proWomen.SLED_PUSH).toEqual(openMen.SLED_PUSH);
    expect(proWomen.SLED_PULL).toEqual(openMen.SLED_PULL);
    expect(proWomen.FARMERS_CARRY).toEqual(openMen.FARMERS_CARRY);
    expect(proWomen.SANDBAG_LUNGES).toEqual(openMen.SANDBAG_LUNGES);

    expect(proWomen.WALL_BALLS.kind).toBe('WALL_BALL');
    if (proWomen.WALL_BALLS.kind !== 'WALL_BALL' || openMen.WALL_BALLS.kind !== 'WALL_BALL') {
      throw new Error('expected wall ball loads');
    }
    expect(proWomen.WALL_BALLS.loadKg).toBe(openMen.WALL_BALLS.loadKg);
    expect(proWomen.WALL_BALLS.targetHeightM).toBe(2.7);
    expect(openMen.WALL_BALLS.targetHeightM).toBe(3.0);
  });

  it('sets wall ball target height by sex alone, not by division', () => {
    for (const division of ['OPEN_SINGLES', 'PRO_SINGLES'] as const) {
      const women = getStationLoads(division, 'FEMALE').WALL_BALLS;
      const men = getStationLoads(division, 'MALE').WALL_BALLS;
      if (women.kind !== 'WALL_BALL' || men.kind !== 'WALL_BALL') {
        throw new Error('expected wall ball loads');
      }
      expect(women.targetHeightM).toBe(2.7);
      expect(men.targetHeightM).toBe(3.0);
    }
  });

  it('is heavier at every loaded station going Open -> Pro, for both sexes', () => {
    const weightOf = (load: { kind: string } & Record<string, unknown>): number => {
      switch (load.kind) {
        case 'SLED':
          return load.totalKg as number;
        case 'PER_HAND':
          return (load.perHandKg as number) * (load.hands as number);
        default:
          return load.loadKg as number;
      }
    };

    for (const sex of SEXES) {
      const open = getStationLoads('OPEN_SINGLES', sex);
      const pro = getStationLoads('PRO_SINGLES', sex);
      for (const station of LOADED_STATION_IDS) {
        expect(weightOf(pro[station])).toBeGreaterThan(weightOf(open[station]));
      }
    }
  });

  it('carries a provenance record, so a season update is auditable', () => {
    const seed = getDivisionsSeed();
    expect(seed.season).toBe(CURRENT_SEASON);
    expect(seed.source.document).toContain('26/27');
    expect(seed.source.url).toContain('hyrox.com');
  });
});

describe('divisions without seed data', () => {
  it.each(['DOUBLES', 'MIXED_DOUBLES', 'RELAY'] as const)(
    'reports no data for %s rather than inventing loads',
    (division) => {
      expect(hasDivisionData(division)).toBe(false);
      expect(() => getStationLoads(division, 'MALE')).toThrow(MissingDivisionDataError);
    },
  );

  it('reports data for both supported Singles divisions', () => {
    expect(hasDivisionData('OPEN_SINGLES')).toBe(true);
    expect(hasDivisionData('PRO_SINGLES')).toBe(true);
  });

  it('knows about all five divisions even though only two have loads', () => {
    expect(DIVISIONS).toHaveLength(5);
  });
});

describe('unknown seasons', () => {
  it('throws rather than falling back to the current season', () => {
    expect(() => getStationLoads('OPEN_SINGLES', 'MALE', '2019-20')).toThrow(UnknownSeasonError);
    expect(() => getDivisionsSeed('2099-00')).toThrow(UnknownSeasonError);
  });
});

describe('PFT seed', () => {
  it('lists the six segments in order', () => {
    const { segments } = getPftSeed();
    expect(segments.map((s) => s.id)).toEqual([
      'RUN',
      'BURPEE_BROAD_JUMPS',
      'STATIONARY_LUNGES',
      'ROW',
      'HAND_RELEASE_PUSH_UPS',
      'WALL_BALLS',
    ]);
    expect(segments.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('uses lighter wall balls than the race', () => {
    const wallBalls = getPftSeed().segments.find((s) => s.id === 'WALL_BALLS');
    expect(wallBalls?.loadKgBySex).toEqual({ FEMALE: 4, MALE: 6 });
  });

  it('gives division guidance as second ranges, ordered fastest first', () => {
    const guidance = getPftSeed().divisionGuidance;
    expect(guidance[0]?.division).toBe('PRO_SINGLES');
    expect(guidance[0]?.minTotalSecs).toBe(15 * 60);
    expect(guidance[0]?.maxTotalSecs).toBe(25 * 60);
    for (const band of guidance) {
      expect(band.minTotalSecs).toBeLessThan(band.maxTotalSecs);
    }
  });

  it('can recommend a division the engine will refuse (ERRATA F19)', () => {
    // Documented, not accidental: the PFT maps 30-45 min to Doubles, which
    // v1 does not support. The onboarding flow has to handle this.
    const divisions = getPftSeed().divisionGuidance.map((band) => band.division);
    expect(divisions).toContain('DOUBLES');
  });
});
