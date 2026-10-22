import type { FareConfig } from './config';
import { localHour } from './dates';
import { AppError } from './errors';
import { isInAnyPolygon } from './geo';
import type { LatLng } from './types';

/**
 * GrabCycle fare engine.
 *
 * Pure and deterministic: identical inputs and fare-config version always
 * produce the identical result, so a quote can be re-derived during audits
 * and disputes. All amounts are integer centavos (₱1.00 = 100) to avoid
 * floating-point rounding errors.
 */

export type DistanceSource = 'ROUTE' | 'STRAIGHT_LINE_ESTIMATE';

export interface FareLine {
  code: string;
  label: string;
  amount: number;
}

export interface FareInput {
  /** Billable distance in meters (road distance when available). */
  distanceMeters: number;
  pickup: LatLng;
  destination: LatLng;
  passengers: number;
  /** Instant used for time-of-day rules (night surcharge). */
  atMillis: number;
  /** Server-verified discount entitlement code, if any. */
  discountCode?: string | null;
}

export interface FareResult {
  total: number;
  currency: 'PHP';
  lines: FareLine[];
  mode: 'DISTANCE' | 'ZONE';
  zoneFrom: string | null;
  zoneTo: string | null;
}

function roundTo(amount: number, increment: number, mode: 'NEAREST' | 'UP'): number {
  if (increment <= 1) return Math.round(amount);
  const units = amount / increment;
  return (mode === 'UP' ? Math.ceil(units - 1e-9) : Math.round(units)) * increment;
}

function isNight(cfg: FareConfig, atMillis: number): boolean {
  const { enabled, startHour, endHour } = cfg.nightSurcharge;
  if (!enabled || startHour === endHour) return false;
  const h = localHour(atMillis);
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

export function zoneOf(cfg: FareConfig, point: LatLng): string | null {
  for (const zone of cfg.zones.definitions) {
    if (isInAnyPolygon(point, [zone.polygon])) return zone.id;
  }
  return null;
}

function zoneFare(cfg: FareConfig, from: string, to: string): number | null {
  const direct = cfg.zones.fares.find((f) => f.from === from && f.to === to);
  if (direct) return direct.fare;
  if (cfg.zones.symmetric) {
    const reverse = cfg.zones.fares.find((f) => f.from === to && f.to === from);
    if (reverse) return reverse.fare;
  }
  return null;
}

/** Distance charge: base fare covers `includedDistanceMeters`, then per started unit. */
export function distanceCharge(cfg: FareConfig, distanceMeters: number): { base: number; distance: number; units: number } {
  const extra = Math.max(0, distanceMeters - cfg.includedDistanceMeters);
  // Epsilon guards against floating-point noise on exact unit boundaries.
  const units = extra <= 0 ? 0 : Math.ceil(extra / cfg.unitDistanceMeters - 1e-9);
  return { base: cfg.baseFare, distance: units * cfg.perUnitFare, units };
}

function peso(centavos: number): string {
  return `₱${(centavos / 100).toFixed(2)}`;
}

export function computeFare(cfg: FareConfig, input: FareInput): FareResult {
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) {
    throw new AppError('invalid-argument', 'INVALID_ARGUMENT', 'Invalid distance.');
  }
  if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > cfg.maxPassengers) {
    throw new AppError('invalid-argument', 'INVALID_ARGUMENT', `Passengers must be between 1 and ${cfg.maxPassengers}.`);
  }

  const lines: FareLine[] = [];
  let mode: FareResult['mode'] = cfg.mode;
  let zoneFrom: string | null = null;
  let zoneTo: string | null = null;

  let usedZone = false;
  if (cfg.mode === 'ZONE') {
    zoneFrom = zoneOf(cfg, input.pickup);
    zoneTo = zoneOf(cfg, input.destination);
    const fare = zoneFrom && zoneTo ? zoneFare(cfg, zoneFrom, zoneTo) : null;
    if (fare != null) {
      const fromName = cfg.zones.definitions.find((z) => z.id === zoneFrom)?.name ?? zoneFrom;
      const toName = cfg.zones.definitions.find((z) => z.id === zoneTo)?.name ?? zoneTo;
      lines.push({ code: 'ZONE_FARE', label: `Zone fare (${fromName} → ${toName})`, amount: fare });
      usedZone = true;
    } else if (!cfg.zones.fallbackToDistance) {
      throw new AppError('failed-precondition', 'OUTSIDE_FARE_ZONES', 'No fare is defined for this route.');
    } else {
      mode = 'DISTANCE';
    }
  }

  if (!usedZone) {
    const { base, distance, units } = distanceCharge(cfg, input.distanceMeters);
    lines.push({
      code: 'BASE_FARE',
      label: `Base fare (first ${(cfg.includedDistanceMeters / 1000).toFixed(1)} km)`,
      amount: base,
    });
    if (distance > 0) {
      lines.push({
        code: 'DISTANCE',
        label: `Distance (${units} × ${(cfg.unitDistanceMeters / 1000).toFixed(1)} km @ ${peso(cfg.perUnitFare)})`,
        amount: distance,
      });
    }
  }

  if (input.passengers > 1 && cfg.additionalPassengerFare > 0) {
    lines.push({
      code: 'ADDITIONAL_PASSENGERS',
      label: `Additional passengers (${input.passengers - 1})`,
      amount: (input.passengers - 1) * cfg.additionalPassengerFare,
    });
  }

  const fareSubtotal = lines.reduce((s, l) => s + l.amount, 0);

  if (isNight(cfg, input.atMillis) && cfg.nightSurcharge.percent > 0) {
    lines.push({
      code: 'NIGHT_SURCHARGE',
      label: `Night surcharge (${cfg.nightSurcharge.percent}%)`,
      amount: Math.round((fareSubtotal * cfg.nightSurcharge.percent) / 100),
    });
  }

  if (input.discountCode) {
    const discount = cfg.discounts.find((d) => d.code === input.discountCode && d.enabled);
    if (discount && discount.percent > 0) {
      const discountable = lines.reduce((s, l) => s + l.amount, 0);
      lines.push({
        code: `DISCOUNT_${discount.code}`,
        label: `${discount.label} discount (${discount.percent}%)`,
        amount: -Math.round((discountable * discount.percent) / 100),
      });
    }
  }

  if (cfg.bookingFee > 0) {
    lines.push({ code: 'BOOKING_FEE', label: 'Booking fee', amount: cfg.bookingFee });
  }

  let total = lines.reduce((s, l) => s + l.amount, 0);
  if (total < cfg.minimumFare) {
    lines.push({ code: 'MINIMUM_FARE', label: 'Minimum fare adjustment', amount: cfg.minimumFare - total });
    total = cfg.minimumFare;
  }

  const rounded = roundTo(total, cfg.rounding.increment, cfg.rounding.mode);
  if (rounded !== total) {
    lines.push({ code: 'ROUNDING', label: 'Rounding', amount: rounded - total });
    total = rounded;
  }

  return { total, currency: 'PHP', lines, mode, zoneFrom, zoneTo };
}

/** Billable distance and its provenance. Straight-line distance is never presented as road distance. */
export function billableDistance(
  cfg: FareConfig,
  routeDistanceMeters: number | null,
  straightLineMeters: number,
): { distanceMeters: number; source: DistanceSource } {
  if (routeDistanceMeters != null && routeDistanceMeters > 0) {
    return { distanceMeters: Math.round(routeDistanceMeters), source: 'ROUTE' };
  }
  return { distanceMeters: Math.round(straightLineMeters * cfg.roadDistanceFactor), source: 'STRAIGHT_LINE_ESTIMATE' };
}

/** Waiting fee for time spent at pickup beyond the grace period (server timestamps only). */
export function computeWaitingFee(cfg: FareConfig, arrivedAtMs: number | null, startedAtMs: number | null): { minutes: number; amount: number } {
  if (!cfg.waitingFee.enabled || arrivedAtMs == null || startedAtMs == null || startedAtMs <= arrivedAtMs) {
    return { minutes: 0, amount: 0 };
  }
  const waited = Math.floor((startedAtMs - arrivedAtMs) / 60_000);
  const billable = Math.max(0, waited - cfg.waitingFee.graceMinutes);
  return { minutes: billable, amount: Math.min(cfg.waitingFee.maxFee, billable * cfg.waitingFee.perMinute) };
}

export interface FareAdjustmentInput {
  code: string;
  amount: number;
  note?: string;
}

/** Validates driver-entered adjustments against the published fare rules. */
export function validateAdjustments(cfg: FareConfig, adjustments: FareAdjustmentInput[]): FareLine[] {
  if (adjustments.length === 0) return [];
  if (!cfg.adjustments.enabled) {
    throw new AppError('failed-precondition', 'FARE_ADJUSTMENT_NOT_ALLOWED', 'Fare adjustments are not enabled.');
  }
  const seen = new Set<string>();
  let total = 0;
  const lines: FareLine[] = [];
  for (const adj of adjustments) {
    const rule = cfg.adjustments.reasons.find((r) => r.code === adj.code);
    if (!rule || seen.has(adj.code)) {
      throw new AppError('failed-precondition', 'FARE_ADJUSTMENT_NOT_ALLOWED', `Adjustment ${adj.code} is not allowed.`);
    }
    if (!Number.isInteger(adj.amount) || adj.amount <= 0 || adj.amount > rule.maxAmount) {
      throw new AppError('failed-precondition', 'FARE_ADJUSTMENT_NOT_ALLOWED', `Adjustment ${adj.code} exceeds the allowed amount.`);
    }
    seen.add(adj.code);
    total += adj.amount;
    lines.push({ code: `ADJ_${rule.code}`, label: rule.label, amount: adj.amount });
  }
  if (total > cfg.adjustments.maxTotal) {
    throw new AppError('failed-precondition', 'FARE_ADJUSTMENT_NOT_ALLOWED', 'Total adjustments exceed the allowed maximum.');
  }
  return lines;
}
