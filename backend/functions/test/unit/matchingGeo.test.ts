import { geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMAS } from '../../src/domain/config';
import { DEFAULT_MATCHING, SAMPLE_DOCUMENT_POLICY, SAMPLE_FARE_CONFIG, SAMPLE_SERVICE_AREA } from '../../src/domain/defaults';
import { fareConfigSchema } from '../../src/domain/config';
import { localDateString, localHour, isValidDateString, daysUntilExpiry } from '../../src/domain/dates';
import { boundsOf, coarsen, distanceMeters, isInAnyPolygon, pointInPolygon, roundDistanceForDisplay } from '../../src/domain/geo';
import {
  isReservable,
  locationProblem,
  radiusSchedule,
  rankCandidates,
  type LocationRecord,
  type MatchableDriver,
} from '../../src/domain/matching';

const NOW = 1_800_000_000_000;
const PICKUP = { lat: 13.4467, lng: 121.8406 }; // Boac (approx.)

function loc(lat: number, lng: number, over: Partial<LocationRecord> = {}): LocationRecord {
  return { lat, lng, acc: 10, ts: NOW - 5_000, sid: 'sess', g: geohashForLocation([lat, lng], 9), ...over };
}

function driver(uid: string, over: Partial<MatchableDriver> = {}): MatchableDriver {
  return {
    uid,
    status: 'APPROVED',
    accountStatus: 'ACTIVE',
    availability: 'ONLINE',
    currentOfferRideId: null,
    currentRideId: null,
    presenceSessionId: 'sess',
    eligibility: { eligible: true, validUntil: NOW + 86_400_000 },
    ...over,
  };
}

describe('geo helpers', () => {
  it('computes distances in meters', () => {
    const d = distanceMeters(PICKUP, { lat: 13.4557, lng: 121.8406 });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('point-in-polygon works for the sample service area', () => {
    const area = SAMPLE_SERVICE_AREA.polygons;
    expect(isInAnyPolygon(PICKUP, area)).toBe(true);
    expect(isInAnyPolygon({ lat: 14.5995, lng: 120.9842 }, area)).toBe(false); // Manila
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });

  it('bounds include a margin', () => {
    const b = boundsOf([[[13, 121], [14, 122], [13.5, 121.5]]], 0.1);
    expect(b).toEqual({ minLat: 12.9, maxLat: 14.1, minLng: 120.9, maxLng: 122.1 });
  });

  it('coarsens coordinates and display distances', () => {
    expect(coarsen({ lat: 13.446789, lng: 121.840612 })).toEqual({ lat: 13.447, lng: 121.841 });
    expect(roundDistanceForDisplay(12)).toBe(50);
    expect(roundDistanceForDisplay(1234)).toBe(1200);
  });
});

describe('dates (Asia/Manila)', () => {
  it('derives local date and hour', () => {
    // 2026-10-22 16:30 UTC = 2026-10-23 00:30 Manila
    const t = Date.UTC(2026, 9, 22, 16, 30);
    expect(localDateString(t)).toBe('2026-10-23');
    expect(localHour(t)).toBe(0);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(daysUntilExpiry('2026-10-23', t)).toBe(0);
  });
});

describe('location freshness policy', () => {
  const cfg = DEFAULT_MATCHING;
  it('classifies missing, stale, inaccurate, mock and future locations', () => {
    expect(locationProblem(null, cfg, NOW)).toBe('MISSING');
    expect(locationProblem(loc(13, 121), cfg, NOW)).toBeNull();
    expect(locationProblem(loc(13, 121, { ts: NOW - 31_000 }), cfg, NOW)).toBe('STALE');
    expect(locationProblem(loc(13, 121, { acc: 150 }), cfg, NOW)).toBe('INACCURATE');
    expect(locationProblem(loc(13, 121, { mock: true }), cfg, NOW)).toBe('MOCK');
    expect(locationProblem(loc(13, 121, { ts: NOW + 60_000 }), cfg, NOW)).toBe('MALFORMED');
    expect(locationProblem({ lat: 99, lng: 121, acc: 1, ts: NOW, sid: 's', g: 'x' }, cfg, NOW)).toBe('MALFORMED');
  });
});

describe('candidate ranking', () => {
  const cfg = DEFAULT_MATCHING;

  it('filters ineligible, stale, out-of-radius and stale-session drivers and sorts by distance', () => {
    const locations = [
      { uid: 'far', loc: loc(13.4467, 121.8706) }, // ~3.2 km east
      { uid: 'near', loc: loc(13.4477, 121.8406) }, // ~110 m
      { uid: 'mid', loc: loc(13.4557, 121.8406) }, // ~1 km
      { uid: 'stale', loc: loc(13.4468, 121.8406, { ts: NOW - 60_000 }) },
      { uid: 'offered', loc: loc(13.4469, 121.8406) },
      { uid: 'oldSession', loc: loc(13.4466, 121.8406, { sid: 'previous' }) },
      { uid: 'expiredDocs', loc: loc(13.4465, 121.8406) },
      { uid: 'near', loc: loc(13.4477, 121.8406) }, // duplicate from overlapping geohash ranges
    ];
    const drivers = new Map<string, MatchableDriver>([
      ['far', driver('far')],
      ['near', driver('near')],
      ['mid', driver('mid')],
      ['stale', driver('stale')],
      ['offered', driver('offered', { availability: 'OFFERED', currentOfferRideId: 'r1' })],
      ['oldSession', driver('oldSession')],
      ['expiredDocs', driver('expiredDocs', { eligibility: { eligible: true, validUntil: NOW - 1 } })],
    ]);
    const ranked = rankCandidates(PICKUP, locations, drivers, cfg, 2000, NOW);
    expect(ranked.map((c) => c.uid)).toEqual(['near', 'mid']);
    const wider = rankCandidates(PICKUP, locations, drivers, cfg, 5000, NOW);
    expect(wider.map((c) => c.uid)).toEqual(['near', 'mid', 'far']);
  });

  it('excludes drivers that already declined', () => {
    const locations = [{ uid: 'a', loc: loc(13.4477, 121.8406) }];
    const drivers = new Map([['a', driver('a')]]);
    expect(rankCandidates(PICKUP, locations, drivers, cfg, 2000, NOW, new Set(['a']))).toEqual([]);
  });

  it('reservability requires active, approved, online, unencumbered drivers', () => {
    expect(isReservable(driver('x'), NOW)).toBe(true);
    expect(isReservable(driver('x', { accountStatus: 'SUSPENDED' }), NOW)).toBe(false);
    expect(isReservable(driver('x', { status: 'EXPIRED' }), NOW)).toBe(false);
    expect(isReservable(driver('x', { availability: 'OFFLINE' }), NOW)).toBe(false);
    expect(isReservable(driver('x', { currentRideId: 'r' }), NOW)).toBe(false);
    expect(isReservable(driver('x', { eligibility: { eligible: false, validUntil: null } }), NOW)).toBe(false);
    expect(isReservable(driver('x', { eligibility: null }), NOW)).toBe(false);
  });

  it('geohash query bounds cover every location within the radius', () => {
    // Sanity check of the multi-range strategy: points inside the radius must
    // fall inside at least one query range.
    const bounds = geohashQueryBounds([PICKUP.lat, PICKUP.lng], 2000);
    expect(bounds.length).toBeGreaterThan(1);
    for (let i = 0; i < 200; i++) {
      const angle = (i / 200) * 2 * Math.PI;
      const r = 1990 * ((i % 10) / 10);
      const p = {
        lat: PICKUP.lat + (r / 111_320) * Math.cos(angle),
        lng: PICKUP.lng + (r / (111_320 * Math.cos((PICKUP.lat * Math.PI) / 180))) * Math.sin(angle),
      };
      const g = geohashForLocation([p.lat, p.lng], 10);
      expect(bounds.some(([start, end]) => g >= start && g <= end)).toBe(true);
    }
  });

  it('radius schedule expands in steps up to the maximum', () => {
    expect(radiusSchedule({ initialRadiusM: 2000, radiusStepM: 1000, maxRadiusM: 5000 })).toEqual([2000, 3000, 4000, 5000]);
    expect(radiusSchedule({ initialRadiusM: 3000, radiusStepM: 5000, maxRadiusM: 3000 })).toEqual([3000]);
  });
});

describe('sample configuration', () => {
  it('validates against the runtime schemas', () => {
    expect(() => CONFIG_SCHEMAS.serviceArea.parse(SAMPLE_SERVICE_AREA)).not.toThrow();
    expect(() => CONFIG_SCHEMAS.documentPolicy.parse(SAMPLE_DOCUMENT_POLICY)).not.toThrow();
    expect(() => CONFIG_SCHEMAS.matching.parse(DEFAULT_MATCHING)).not.toThrow();
    expect(() => fareConfigSchema.parse(SAMPLE_FARE_CONFIG)).not.toThrow();
  });

  it('sample data is clearly labelled', () => {
    expect(SAMPLE_SERVICE_AREA.isSample).toBe(true);
    expect(SAMPLE_DOCUMENT_POLICY.isSample).toBe(true);
    expect(SAMPLE_FARE_CONFIG.isSample).toBe(true);
    expect(SAMPLE_FARE_CONFIG.label).toMatch(/SAMPLE/);
  });
});
