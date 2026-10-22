import type { LatLng } from '../domain/types';
import { log } from '../lib/log';
import { MAPS_SERVER_KEY } from '../lib/params';

/**
 * Server-side Google Maps Platform access (Routes API, Places API (New),
 * Geocoding API). The privileged key never ships in the Android app.
 *
 * Every call degrades gracefully: when the key is missing/DISABLED or a
 * request fails, callers receive `null` and must present a clearly labelled
 * fallback (never an invented route or ETA).
 */

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Encoded polyline as returned by the provider. */
  polyline: string | null;
}

export interface ProviderPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface MapsProvider {
  computeRoute(origin: LatLng, destination: LatLng): Promise<RouteResult | null>;
  /** Driving durations from many origins to one destination (seconds), same order as origins. */
  durationsTo(origins: LatLng[], destination: LatLng): Promise<Array<number | null> | null>;
  searchText(query: string, bounds: { low: LatLng; high: LatLng }): Promise<ProviderPlace[] | null>;
  reverseGeocode(point: LatLng): Promise<string | null>;
}

const TIMEOUT_MS = 6000;

function apiKey(): string | null {
  try {
    const key = MAPS_SERVER_KEY.value();
    return key && key !== 'DISABLED' ? key : null;
  } catch {
    return null;
  }
}

async function postJson(url: string, key: string, fieldMask: string, body: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn('maps.http_error', { url: new URL(url).pathname, status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    log.warn('maps.request_failed', { url: new URL(url).pathname, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const seconds = (duration: unknown): number | null => {
  if (typeof duration !== 'string') return null;
  const n = Number.parseFloat(duration.replace(/s$/, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

export const googleMapsProvider: MapsProvider = {
  async computeRoute(origin, destination) {
    const key = apiKey();
    if (!key) return null;
    const json = (await postJson(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      key,
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      { origin: waypoint(origin), destination: waypoint(destination), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' },
    )) as { routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }> } | null;
    const route = json?.routes?.[0];
    const durationSeconds = seconds(route?.duration);
    if (!route?.distanceMeters || durationSeconds == null) return null;
    return { distanceMeters: route.distanceMeters, durationSeconds, polyline: route.polyline?.encodedPolyline ?? null };
  },

  async durationsTo(origins, destination) {
    const key = apiKey();
    if (!key || origins.length === 0) return null;
    const json = (await postJson(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      key,
      'originIndex,destinationIndex,duration,condition',
      { origins: origins.map((o) => ({ waypoint: waypoint(o) })), destinations: [{ waypoint: waypoint(destination) }], travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' },
    )) as Array<{ originIndex?: number; duration?: string; condition?: string }> | null;
    if (!Array.isArray(json)) return null;
    const out: Array<number | null> = origins.map(() => null);
    for (const el of json) {
      if (el.condition === 'ROUTE_EXISTS' && typeof el.originIndex === 'number') out[el.originIndex] = seconds(el.duration);
    }
    return out;
  },

  async searchText(query, bounds) {
    const key = apiKey();
    if (!key) return null;
    const json = (await postJson(
      'https://places.googleapis.com/v1/places:searchText',
      key,
      'places.id,places.displayName,places.formattedAddress,places.location',
      {
        textQuery: query,
        maxResultCount: 8,
        languageCode: 'en',
        regionCode: 'PH',
        locationRestriction: {
          rectangle: {
            low: { latitude: bounds.low.lat, longitude: bounds.low.lng },
            high: { latitude: bounds.high.lat, longitude: bounds.high.lng },
          },
        },
      },
    )) as { places?: Array<{ id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }> } | null;
    if (!json) return null;
    return (json.places ?? [])
      .filter((p) => p.location)
      .map((p) => ({
        placeId: p.id,
        name: p.displayName?.text ?? p.formattedAddress ?? 'Unnamed place',
        address: p.formattedAddress ?? '',
        lat: p.location!.latitude,
        lng: p.location!.longitude,
      }));
  },

  async reverseGeocode(point) {
    const key = apiKey();
    if (!key) return null;
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${point.lat},${point.lng}`);
      url.searchParams.set('key', key);
      url.searchParams.set('language', 'en');
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const json = (await res.json()) as { status?: string; results?: Array<{ formatted_address?: string }> };
      return json.status === 'OK' ? (json.results?.[0]?.formatted_address ?? null) : null;
    } catch (err) {
      log.warn('maps.geocode_failed', { message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
};

let provider: MapsProvider = googleMapsProvider;

export function maps(): MapsProvider {
  return provider;
}

/** Test hook: inject a deterministic provider (clearly labelled fakes only). */
export function setMapsProviderForTesting(p: MapsProvider | null): void {
  provider = p ?? googleMapsProvider;
}
