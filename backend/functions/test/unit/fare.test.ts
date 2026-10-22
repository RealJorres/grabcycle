import { describe, expect, it } from 'vitest';
import type { FareConfig } from '../../src/domain/config';
import { fareConfigSchema } from '../../src/domain/config';
import { SAMPLE_FARE_CONFIG } from '../../src/domain/defaults';
import {
  billableDistance,
  computeFare,
  computeWaitingFee,
  distanceCharge,
  validateAdjustments,
} from '../../src/domain/fare';
import { AppError } from '../../src/domain/errors';

const P = { lat: 13.4467, lng: 121.8406 };
const D = { lat: 13.475, lng: 121.8617 };
// 2026-10-22 10:00 Asia/Manila == 02:00 UTC
const MORNING = Date.UTC(2026, 9, 22, 2, 0, 0);
// 2026-10-22 23:30 Asia/Manila == 15:30 UTC
const NIGHT = Date.UTC(2026, 9, 22, 15, 30, 0);

function cfg(overrides: Partial<FareConfig> = {}): FareConfig {
  return fareConfigSchema.parse({ ...SAMPLE_FARE_CONFIG, ...overrides });
}

describe('fare engine — distance mode', () => {
  it('charges only the base fare within the included distance', () => {
    const r = computeFare(cfg(), { distanceMeters: 800, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    expect(r.total).toBe(2000);
    expect(r.lines.map((l) => l.code)).toEqual(['BASE_FARE']);
  });

  it('charges per STARTED unit beyond the included distance', () => {
    expect(distanceCharge(cfg(), 1000).units).toBe(0);
    expect(distanceCharge(cfg(), 1001).units).toBe(1);
    expect(distanceCharge(cfg(), 2000).units).toBe(1);
    expect(distanceCharge(cfg(), 2001).units).toBe(2);
    const r = computeFare(cfg(), { distanceMeters: 3400, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    // 20.00 base + 3 units * 5.00
    expect(r.total).toBe(3500);
  });

  it('adds additional-passenger fees and respects maxPassengers', () => {
    const r = computeFare(cfg(), { distanceMeters: 500, pickup: P, destination: D, passengers: 3, atMillis: MORNING });
    expect(r.total).toBe(2000 + 2 * 1000);
    expect(() =>
      computeFare(cfg(), { distanceMeters: 500, pickup: P, destination: D, passengers: 5, atMillis: MORNING }),
    ).toThrow(AppError);
    expect(() =>
      computeFare(cfg(), { distanceMeters: 500, pickup: P, destination: D, passengers: 0, atMillis: MORNING }),
    ).toThrow(AppError);
  });

  it('applies the minimum fare', () => {
    const c = cfg({ baseFare: 1000, minimumFare: 2500 });
    const r = computeFare(c, { distanceMeters: 100, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    expect(r.total).toBe(2500);
    expect(r.lines.at(-1)?.code).toBe('MINIMUM_FARE');
  });

  it('applies the night surcharge only inside the overnight window (Asia/Manila)', () => {
    const c = cfg({ nightSurcharge: { enabled: true, startHour: 22, endHour: 5, percent: 20 } });
    const day = computeFare(c, { distanceMeters: 800, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    const night = computeFare(c, { distanceMeters: 800, pickup: P, destination: D, passengers: 1, atMillis: NIGHT });
    expect(day.total).toBe(2000);
    expect(night.total).toBe(2400);
  });

  it('applies only enabled discounts that the server verified', () => {
    const c = cfg({
      discounts: [{ code: 'SENIOR', label: 'Senior', percent: 20, enabled: true }],
      minimumFare: 0,
      rounding: { increment: 1, mode: 'NEAREST' },
    });
    const r = computeFare(c, {
      distanceMeters: 800,
      pickup: P,
      destination: D,
      passengers: 1,
      atMillis: MORNING,
      discountCode: 'SENIOR',
    });
    expect(r.total).toBe(1600);
    const ignored = computeFare(c, {
      distanceMeters: 800,
      pickup: P,
      destination: D,
      passengers: 1,
      atMillis: MORNING,
      discountCode: 'PWD',
    });
    expect(ignored.total).toBe(2000);
  });

  it('rounds up to the configured increment and records a rounding line', () => {
    const c = cfg({ perUnitFare: 450, rounding: { increment: 100, mode: 'UP' } });
    const r = computeFare(c, { distanceMeters: 1500, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    expect(r.total).toBe(2500);
    expect(r.lines.find((l) => l.code === 'ROUNDING')?.amount).toBe(50);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
  });

  it('line items always sum to the total', () => {
    const c = cfg({
      bookingFee: 500,
      nightSurcharge: { enabled: true, startHour: 22, endHour: 5, percent: 15 },
      perUnitFare: 333,
    });
    for (const meters of [0, 999, 1001, 4321, 12_345]) {
      const r = computeFare(c, { distanceMeters: meters, pickup: P, destination: D, passengers: 2, atMillis: NIGHT });
      expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(r.total);
      expect(Number.isInteger(r.total)).toBe(true);
    }
  });

  it('rejects invalid distances', () => {
    expect(() => computeFare(cfg(), { distanceMeters: -1, pickup: P, destination: D, passengers: 1, atMillis: MORNING })).toThrow();
    expect(() =>
      computeFare(cfg(), { distanceMeters: Number.NaN, pickup: P, destination: D, passengers: 1, atMillis: MORNING }),
    ).toThrow();
  });
});

describe('fare engine — zone mode', () => {
  const zoneCfg = cfg({
    mode: 'ZONE',
    zones: {
      definitions: [
        { id: 'A', name: 'Poblacion', polygon: [[13.44, 121.83], [13.45, 121.83], [13.45, 121.85], [13.44, 121.85]] },
        { id: 'B', name: 'North', polygon: [[13.47, 121.85], [13.48, 121.85], [13.48, 121.87], [13.47, 121.87]] },
      ],
      fares: [{ from: 'A', to: 'B', fare: 4000 }],
      symmetric: true,
      fallbackToDistance: false,
    },
  });

  it('uses the zone matrix (symmetric)', () => {
    const ab = computeFare(zoneCfg, { distanceMeters: 99_999, pickup: P, destination: D, passengers: 1, atMillis: MORNING });
    expect(ab.total).toBe(4000);
    expect(ab.zoneFrom).toBe('A');
    expect(ab.zoneTo).toBe('B');
    const ba = computeFare(zoneCfg, { distanceMeters: 1, pickup: D, destination: P, passengers: 1, atMillis: MORNING });
    expect(ba.total).toBe(4000);
  });

  it('rejects routes outside zones unless distance fallback is enabled', () => {
    const outside = { lat: 13.3, lng: 122.0 };
    expect(() =>
      computeFare(zoneCfg, { distanceMeters: 1000, pickup: P, destination: outside, passengers: 1, atMillis: MORNING }),
    ).toThrow(/No fare is defined/);
    const withFallback = cfg({ ...zoneCfg, zones: { ...zoneCfg.zones, fallbackToDistance: true } });
    const r = computeFare(withFallback, { distanceMeters: 800, pickup: P, destination: outside, passengers: 1, atMillis: MORNING });
    expect(r.mode).toBe('DISTANCE');
    expect(r.total).toBe(2000);
  });
});

describe('billable distance provenance', () => {
  it('prefers road distance and labels straight-line estimates', () => {
    expect(billableDistance(cfg(), 2500, 2000)).toEqual({ distanceMeters: 2500, source: 'ROUTE' });
    expect(billableDistance(cfg(), null, 2000)).toEqual({ distanceMeters: 2600, source: 'STRAIGHT_LINE_ESTIMATE' });
  });
});

describe('waiting fee and adjustments', () => {
  const c = cfg({
    waitingFee: { enabled: true, graceMinutes: 5, perMinute: 100, maxFee: 1000 },
    adjustments: {
      enabled: true,
      maxTotal: 3000,
      reasons: [
        { code: 'EXTRA_LUGGAGE', label: 'Extra luggage', maxAmount: 2000 },
        { code: 'TOLL', label: 'Toll', maxAmount: 2000 },
      ],
    },
  });

  it('charges waiting time after the grace period, capped', () => {
    const t0 = MORNING;
    expect(computeWaitingFee(c, t0, t0 + 4 * 60_000).amount).toBe(0);
    expect(computeWaitingFee(c, t0, t0 + 8 * 60_000)).toEqual({ minutes: 3, amount: 300 });
    expect(computeWaitingFee(c, t0, t0 + 60 * 60_000).amount).toBe(1000);
    expect(computeWaitingFee(cfg(), t0, t0 + 60 * 60_000).amount).toBe(0);
  });

  it('validates adjustments against configured reasons and caps', () => {
    expect(validateAdjustments(c, [{ code: 'EXTRA_LUGGAGE', amount: 1500 }])).toHaveLength(1);
    expect(() => validateAdjustments(c, [{ code: 'TIP', amount: 100 }])).toThrow(AppError);
    expect(() => validateAdjustments(c, [{ code: 'EXTRA_LUGGAGE', amount: 2500 }])).toThrow(AppError);
    expect(() =>
      validateAdjustments(c, [
        { code: 'EXTRA_LUGGAGE', amount: 2000 },
        { code: 'TOLL', amount: 2000 },
      ]),
    ).toThrow(/maximum/);
    expect(() => validateAdjustments(cfg(), [{ code: 'EXTRA_LUGGAGE', amount: 100 }])).toThrow(/not enabled/);
  });
});
