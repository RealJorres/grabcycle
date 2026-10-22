import { boundsOf, distanceMeters } from '../domain/geo';
import { isInServiceArea } from '../domain/serviceArea';
import type { LatLng } from '../domain/types';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { enforceRateLimit } from '../lib/rateLimit';
import { now } from '../lib/time';
import { requireActiveUser } from './accounts';
import { maps } from './maps';

/**
 * Place search and reverse geocoding for pickup/destination selection.
 *
 * Results merge the operator's curated local landmarks (`landmarks`
 * collection — useful where map coverage of barangays and sitios is thin)
 * with Google Places results restricted to the service area. Both are
 * fetched server-side so no privileged key ships in the app.
 */

export interface LandmarkDoc {
  name: string;
  municipality: string;
  barangay: string | null;
  keywords: string[];
  lat: number;
  lng: number;
  active: boolean;
  isSample: boolean;
}

export interface PlaceResult {
  source: 'LANDMARK' | 'GOOGLE';
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  inServiceArea: boolean;
  distanceMeters: number | null;
}

let landmarkCache: { at: number; items: Array<LandmarkDoc & { id: string }> } | null = null;

async function activeLandmarks(): Promise<Array<LandmarkDoc & { id: string }>> {
  if (landmarkCache && now() - landmarkCache.at < 300_000) return landmarkCache.items;
  const snap = await db().collection('landmarks').where('active', '==', true).limit(3000).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as LandmarkDoc) }));
  landmarkCache = { at: now(), items };
  return items;
}

export function clearLandmarkCache(): void {
  landmarkCache = null;
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchPlaces(ctx: CallerContext, input: { query: string; near: LatLng | null }) {
  await requireActiveUser(ctx.uid);
  await enforceRateLimit(ctx.uid, 'placesSearch');
  const area = await getConfig('serviceArea');
  const q = normalize(input.query);
  const tokens = q.split(' ').filter(Boolean);

  const landmarks = (await activeLandmarks())
    .filter((l) => {
      const hay = normalize([l.name, l.municipality, l.barangay ?? '', ...l.keywords].join(' '));
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, 8)
    .map<PlaceResult>((l) => ({
      source: 'LANDMARK',
      placeId: `landmark:${l.id}`,
      name: l.name,
      address: [l.barangay, l.municipality, 'Marinduque'].filter(Boolean).join(', '),
      lat: l.lat,
      lng: l.lng,
      inServiceArea: isInServiceArea(area, l),
      distanceMeters: input.near ? Math.round(distanceMeters(input.near, l)) : null,
    }));

  const b = boundsOf(area.polygons.map((p) => p.points), 0);
  const google = await maps().searchText(input.query, { low: { lat: b.minLat, lng: b.minLng }, high: { lat: b.maxLat, lng: b.maxLng } });
  const googleResults = (google ?? []).map<PlaceResult>((p) => ({
    source: 'GOOGLE',
    placeId: `google:${p.placeId}`,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    inServiceArea: isInServiceArea(area, p),
    distanceMeters: input.near ? Math.round(distanceMeters(input.near, p)) : null,
  }));

  const results = [...landmarks, ...googleResults];
  if (input.near) results.sort((a, b2) => Number(b2.inServiceArea) - Number(a.inServiceArea) || (a.distanceMeters ?? 0) - (b2.distanceMeters ?? 0));
  return { results: results.slice(0, 12), providerAvailable: google != null };
}

export async function reverseGeocode(ctx: CallerContext, input: LatLng) {
  await requireActiveUser(ctx.uid);
  await enforceRateLimit(ctx.uid, 'placesSearch');
  const area = await getConfig('serviceArea');
  // Prefer a nearby curated landmark (within 75 m) as a recognizable label.
  const nearest = (await activeLandmarks())
    .map((l) => ({ l, d: distanceMeters(input, l) }))
    .filter((x) => x.d <= 75)
    .sort((a, b) => a.d - b.d)[0];
  const address = nearest
    ? `Near ${nearest.l.name}, ${nearest.l.municipality}`
    : await maps().reverseGeocode(input);
  return {
    address,
    source: nearest ? 'LANDMARK' : address ? 'GOOGLE' : null,
    inServiceArea: isInServiceArea(area, input),
  };
}
