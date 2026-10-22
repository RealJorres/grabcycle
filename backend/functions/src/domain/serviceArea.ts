import type { ServiceAreaConfig } from './config';
import { localHour } from './dates';
import { isInAnyPolygon } from './geo';
import type { LatLng } from './types';

export function isInServiceArea(area: ServiceAreaConfig, point: LatLng): boolean {
  return isInAnyPolygon(
    point,
    area.polygons.map((p) => p.points),
  );
}

/** Operating hours in local time; start > end means service runs overnight. */
export function isWithinOperatingHours(area: ServiceAreaConfig, nowMs: number): boolean {
  const { enabled, startHour, endHour } = area.operatingHours;
  if (!enabled) return true;
  const h = localHour(nowMs);
  if (startHour === endHour) return true;
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}
