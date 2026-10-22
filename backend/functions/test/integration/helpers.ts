import { randomBytes } from 'node:crypto';
import { ServerValue } from 'firebase-admin/database';
import { geohashForLocation } from 'geofire-common';
import { expect } from 'vitest';
import { SAMPLE_DOCUMENT_POLICY, SAMPLE_FARE_CONFIG, SAMPLE_SERVICE_AREA, DEFAULT_MATCHING, DEFAULT_POLICIES } from '../../src/domain/defaults';
import type { AppError, ErrorReason } from '../../src/domain/errors';
import type { DocumentSide, StaffRole } from '../../src/domain/types';
import { clearConfigCache } from '../../src/lib/configStore';
import type { CallerContext } from '../../src/lib/context';
import { auth, bucket, db, rtdb } from '../../src/lib/firebase';
import { setClockForTesting } from '../../src/lib/time';
import { completeRegistration } from '../../src/services/accounts';
import { setDriverAvailability } from '../../src/services/availability';
import { getFareQuote } from '../../src/services/quotes';
import {
  decideDriver,
  reviewDriverDocument,
  reviewVehicle,
  saveDriverProfile,
  submitDriverApplication,
  submitDriverDocument,
} from '../../src/services/drivers';
import type { DriverDocumentDoc } from '../../src/services/models';
import { useNotificationCaptureForTesting } from '../../src/services/notifications';
import { decidePassengerVerification, submitPassengerVerification } from '../../src/services/passengerVerification';
import { syncServiceBounds } from '../../src/services/presence';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grabcycle';

export const TERMS = DEFAULT_POLICIES.terms;
export const BOAC = { lat: 13.4467, lng: 121.8406 };
export const MOGPOG = { lat: 13.475, lng: 121.8617 };

let phoneCounter = 100000;

export function ctx(uid: string, opts: { staffRole?: StaffRole; phone?: string | null; provider?: string } = {}): CallerContext {
  return {
    uid,
    staffRole: opts.staffRole ?? null,
    phoneNumber: opts.phone === undefined ? `+639170${String(phoneCounter++).padStart(6, '0')}` : opts.phone,
    email: opts.staffRole ? `${uid}@staff.test` : null,
    emailVerified: !!opts.staffRole,
    signInProvider: opts.provider ?? (opts.staffRole ? 'password' : 'phone'),
  };
}

export const reviewer = ctx('reviewer-1', { staffRole: 'reviewer' });
export const admin = ctx('admin-1', { staffRole: 'admin' });
export const superadmin = ctx('super-1', { staffRole: 'superadmin' });
export const support = ctx('support-1', { staffRole: 'support' });

export async function resetEmulators(): Promise<void> {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST!;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await rtdb().ref().set(null);
  const [files] = await bucket().getFiles();
  await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
  clearConfigCache();
  setClockForTesting(null);
  useNotificationCaptureForTesting(true);
}

export async function seedConfig(): Promise<void> {
  const batch = db().batch();
  batch.set(db().doc('config/serviceArea'), SAMPLE_SERVICE_AREA);
  batch.set(db().doc('config/documentPolicy'), SAMPLE_DOCUMENT_POLICY);
  batch.set(db().doc('config/matching'), DEFAULT_MATCHING);
  batch.set(db().doc('config/policies'), DEFAULT_POLICIES);
  batch.set(db().doc('fareConfigs/v1'), { ...SAMPLE_FARE_CONFIG, version: 'v1' });
  batch.set(db().doc('config/fare'), { activeVersion: 'v1' });
  await batch.commit();
  clearConfigCache();
  await syncServiceBounds();
}

/** Builds a structurally valid JPEG byte sequence (SOI ... EOI). */
export function jpegBytes(size = 4096): Buffer {
  const buf = randomBytes(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[size - 2] = 0xff;
  buf[size - 1] = 0xd9;
  return buf;
}

export async function stageUpload(uid: string, opts: { bytes?: Buffer; contentType?: string } = {}): Promise<string> {
  const uploadId = randomBytes(18).toString('base64url');
  await bucket()
    .file(`uploads/${uid}/${uploadId}`)
    .save(opts.bytes ?? jpegBytes(), { resumable: false, contentType: opts.contentType ?? 'image/jpeg' });
  return uploadId;
}

export async function uploadsFor(uid: string, sides: DocumentSide[]) {
  return Promise.all(sides.map(async (side) => ({ side, uploadId: await stageUpload(uid) })));
}

export async function createAuthUser(c: CallerContext): Promise<void> {
  await auth().createUser({ uid: c.uid, ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {}) });
}

export async function registerPassenger(name = 'Juan Dela Cruz'): Promise<CallerContext> {
  const c = ctx(`p-${randomBytes(5).toString('hex')}`);
  await createAuthUser(c);
  await completeRegistration(c, { accountType: 'PASSENGER', fullName: name, ...TERMS, locale: 'en' });
  return c;
}

export async function registerDriver(name = 'Pedro Santos'): Promise<CallerContext> {
  const c = ctx(`d-${randomBytes(5).toString('hex')}`);
  await createAuthUser(c);
  await completeRegistration(c, { accountType: 'DRIVER', fullName: name, ...TERMS, locale: 'en' });
  return c;
}

export async function approvePassenger(c: CallerContext): Promise<void> {
  const { caseId } = await submitPassengerVerification(c, {
    idType: 'PHILSYS',
    nameOnId: 'Juan Dela Cruz',
    idExpiry: null,
    uploads: await uploadsFor(c.uid, ['FRONT', 'BACK']),
  });
  await decidePassengerVerification(reviewer, {
    caseId,
    decision: 'APPROVE',
    reasonCode: null,
    publicMessage: null,
    internalNote: null,
    checklist: { nameMatchesProfile: true, photoClear: true, documentUnexpired: true, appearsAuthentic: true },
  });
}

export const VEHICLE = {
  plateNumber: '123ABC',
  bodyNumber: 'BOAC-042',
  make: 'Honda',
  model: 'TMX 155',
  color: 'Blue',
  capacity: 3,
  franchiseMunicipality: 'Boac',
};

export async function submitAllDriverDocuments(c: CallerContext, expiry = '2030-12-31'): Promise<void> {
  await saveDriverProfile(c, { municipality: 'Boac', vehicle: VEHICLE });
  for (const req of SAMPLE_DOCUMENT_POLICY.driverRequirements.filter((r) => r.mandatory)) {
    await submitDriverDocument(c, {
      requirementCode: req.code,
      uploads: await uploadsFor(c.uid, req.sides),
      expiryDate: req.hasExpiry ? expiry : null,
      documentNumber: req.numberField ? 'N01-12-123456' : null,
    });
  }
  await submitDriverApplication(c);
}

export async function approveAllDriverDocuments(driverUid: string): Promise<void> {
  const docs = await db().collection(`drivers/${driverUid}/documents`).get();
  for (const d of docs.docs) {
    const data = d.data() as DriverDocumentDoc;
    if (!data.pending) continue;
    await reviewDriverDocument(reviewer, {
      driverUid,
      requirementCode: d.id,
      submissionId: data.pending.submissionId,
      decision: 'APPROVE',
      reasonCode: null,
      publicMessage: null,
      internalNote: null,
      verifiedExpiryDate: null,
    });
  }
}

export async function registerApprovedDriver(name?: string): Promise<CallerContext> {
  const c = await registerDriver(name);
  await submitAllDriverDocuments(c);
  await approveAllDriverDocuments(c.uid);
  await reviewVehicle(reviewer, { driverUid: c.uid, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null });
  await decideDriver(reviewer, { driverUid: c.uid, decision: 'APPROVE', reasonCode: null, publicMessage: null, internalNote: null });
  return c;
}

/** Asserts that a promise rejects with an AppError carrying `reason`. */
export async function expectReason(promise: Promise<unknown>, reason: ErrorReason): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect((err as AppError).reason, (err as Error).message).toBe(reason);
    return err as AppError;
  }
  throw new Error(`Expected rejection with ${reason}, but the call succeeded.`);
}

export async function getDoc<T = Record<string, unknown>>(path: string): Promise<T | undefined> {
  return (await db().doc(path).get()).data() as T | undefined;
}

// ---------------------------------------------------------------------------
// Location & ride helpers
// ---------------------------------------------------------------------------

export async function goOnline(c: CallerContext, at: { lat: number; lng: number } = BOAC): Promise<{ availability: string; sessionId: string }> {
  const res = await setDriverAvailability(c, { online: true, location: { lat: at.lat, lng: at.lng, accuracy: 10, mock: false } });
  if (!('sessionId' in res)) throw new Error('Driver did not go online');
  return res;
}

/** Publishes a driver location as the device would (server timestamp, current session). */
export async function moveDriver(uid: string, at: { lat: number; lng: number }, opts: { ageMs?: number; acc?: number } = {}) {
  const sid = (await db().doc(`drivers/${uid}`).get()).get('presenceSessionId');
  await rtdb()
    .ref(`locations/${uid}`)
    .set({
      lat: at.lat,
      lng: at.lng,
      acc: opts.acc ?? 10,
      g: geohashForLocation([at.lat, at.lng], 10),
      ts: opts.ageMs ? Date.now() - opts.ageMs : ServerValue.TIMESTAMP,
      cts: Date.now() - (opts.ageMs ?? 0),
      sid,
    });
}

/** A point roughly `meters` north of `from`. */
export function north(from: { lat: number; lng: number }, meters: number) {
  return { lat: from.lat + meters / 111_320, lng: from.lng };
}

export async function quoteFor(c: CallerContext, pickup = BOAC, destination = MOGPOG) {
  return getFareQuote(c, {
    pickup: { ...pickup, address: 'Pickup', placeId: null },
    destination: { ...destination, address: 'Destination', placeId: null },
    passengers: 1,
  });
}

export async function approvedPassenger(name?: string): Promise<CallerContext> {
  const p = await registerPassenger(name);
  await approvePassenger(p);
  return p;
}

export function requestId(): string {
  return randomBytes(12).toString('base64url');
}
