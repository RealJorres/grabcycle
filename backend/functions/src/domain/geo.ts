import { distanceBetween } from 'geofire-common';
import type { LatLng } from './types';

/** Great-circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  return distanceBetween([a.lat, a.lng], [b.lat, b.lng]) * 1000;
}

export function isValidLatLng(p: { lat: unknown; lng: unknown }): p is LatLng {
  return (
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/**
 * Ray-casting point-in-polygon test on [lat, lng] vertices. A planar
 * approximation is accurate at province scale and away from the antimeridian.
 */
export function pointInPolygon(point: LatLng, polygon: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  const x = point.lng;
  const y = point.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]!;
    const [yj, xj] = polygon[j]!;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isInAnyPolygon(point: LatLng, polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): boolean {
  return polygons.some((poly) => pointInPolygon(point, poly));
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundsOf(polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, marginDeg = 0): Bounds {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const poly of polygons) {
    for (const [lat, lng] of poly) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    minLat: r(Math.max(-90, minLat - marginDeg)),
    maxLat: r(Math.min(90, maxLat + marginDeg)),
    minLng: r(Math.max(-180, minLng - marginDeg)),
    maxLng: r(Math.min(180, maxLng + marginDeg)),
  };
}

/**
 * Coarsens a coordinate before showing it to someone who is not on a trip
 * with the driver. 3 decimals ≈ 110 m at Marinduque's latitude.
 */
export function coarsen(p: LatLng, decimals = 3): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

/** Rounds a distance for display so it does not imply false precision. */
export function roundDistanceForDisplay(meters: number): number {
  if (meters < 1000) return Math.max(50, Math.round(meters / 50) * 50);
  return Math.round(meters / 100) * 100;
}
