import { httpsCallable } from 'firebase/functions';
import { requireFirebase } from './firebase';
import type { StaffRole } from './permissions';

/**
 * Typed wrappers for the staff-facing Cloud Functions. Inputs mirror the
 * backend zod schemas (backend/functions/src/handlers/admin.ts); the backend
 * re-validates everything and enforces the caller's role.
 */
async function call<I, O>(name: string, data: I): Promise<O> {
  const fn = httpsCallable<I, O>(requireFirebase().functions, name, { timeout: 60_000 });
  const res = await fn(data);
  return res.data;
}

export type Decision = 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';

export interface DecisionFields {
  decision: Decision;
  reasonCode: string | null;
  publicMessage: string | null;
  internalNote: string | null;
}

export const VERIFICATION_CHECKLIST = ['nameMatchesProfile', 'photoClear', 'documentUnexpired', 'appearsAuthentic'] as const;
export type ChecklistKey = (typeof VERIFICATION_CHECKLIST)[number];

export interface Overview {
  passengers: number;
  passengersPendingVerification: number;
  drivers: number;
  driversAwaitingApproval: number;
  driverDocumentsPendingReview: number;
  driversOnline: number;
  activeRides: number;
  completedToday: number;
  cancelledToday: number;
  openSupportCases: number;
  paymentsNeedingAttention: number;
  generatedAt?: number;
}

export type DocumentFileRequest =
  | { kind: 'PASSENGER_CASE'; caseId: string; side: 'FRONT' | 'BACK' }
  | { kind: 'DRIVER_DOCUMENT'; driverUid: string; requirementCode: string; version: 'pending' | 'approved'; side: 'FRONT' | 'BACK' | 'PHOTO' };

export const api = {
  overview: () => call<Record<string, never>, Overview>('adminGetOverview', {}),

  claimVerificationCase: (caseId: string) => call<{ caseId: string }, unknown>('adminClaimVerificationCase', { caseId }),
  decidePassengerVerification: (input: DecisionFields & { caseId: string; checklist: Partial<Record<ChecklistKey, boolean>> }) =>
    call<typeof input, unknown>('adminDecidePassengerVerification', input),
  updatePassengerVerification: (input: {
    uid: string;
    action: 'SUSPEND' | 'REINSTATE' | 'REVOKE' | 'REOPEN';
    reasonCode: string;
    publicMessage: string;
    internalNote: string | null;
  }) => call<typeof input, unknown>('adminUpdatePassengerVerification', input),

  reviewDriverDocument: (input: DecisionFields & {
    driverUid: string;
    requirementCode: string;
    submissionId: string;
    verifiedExpiryDate: string | null;
  }) => call<typeof input, unknown>('adminReviewDriverDocument', input),
  reviewVehicle: (input: DecisionFields & { driverUid: string }) => call<typeof input, unknown>('adminReviewVehicle', input),
  decideDriver: (input: {
    driverUid: string;
    decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';
    reasonCode: string | null;
    publicMessage: string | null;
    internalNote: string | null;
  }) => call<typeof input, unknown>('adminDecideDriver', input),

  getDocumentFile: (input: DocumentFileRequest) => call<DocumentFileRequest, { contentType: string; dataBase64: string }>('adminGetDocumentFile', input),

  setAccountStatus: (input: { uid: string; status: 'ACTIVE' | 'SUSPENDED'; reasonCode: string; publicMessage: string; internalNote: string | null }) =>
    call<typeof input, unknown>('adminSetAccountStatus', input),
  setFareDiscount: (input: { uid: string; code: string | null; expiresOn: string | null; reasonCode: string }) =>
    call<typeof input, unknown>('adminSetFareDiscount', input),

  cancelRide: (input: { rideId: string; reasonCode: string; note: string | null }) => call<typeof input, unknown>('adminCancelRide', input),
  completeRide: (input: { rideId: string; cashCollected: number | null }) => call<typeof input, unknown>('adminCompleteRide', input),
  resolvePayment: (input: { rideId: string; status: 'PAID' | 'REFUNDED' | 'FAILED'; note: string }) =>
    call<typeof input, unknown>('adminResolvePayment', input),

  updateSupportCase: (input: {
    caseId: string;
    status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
    publicResponse: string | null;
    internalNote: string | null;
    assignToMe: boolean;
  }) => call<typeof input, unknown>('adminUpdateSupportCase', input),

  updateConfig: (key: ConfigKey, value: Record<string, unknown>) =>
    call<{ key: ConfigKey; value: Record<string, unknown> }, { key: string }>('adminUpdateConfig', { key, value }),
  publishFareConfig: (config: Record<string, unknown>, activate: boolean) =>
    call<{ config: Record<string, unknown>; activate: boolean }, { version: string; active: boolean }>('adminPublishFareConfig', { config, activate }),
  activateFareVersion: (version: string) => call<{ version: string }, { version: string }>('adminActivateFareVersion', { version }),
  upsertLandmark: (input: {
    id: string | null;
    name: string;
    municipality: string;
    barangay: string | null;
    keywords: string[];
    lat: number;
    lng: number;
    active: boolean;
  }) => call<typeof input, { id: string }>('adminUpsertLandmark', input),

  exportUserData: (requestId: string) => call<{ requestId: string }, Record<string, unknown>>('adminExportUserData', { requestId }),
  resolveDataRequest: (input: { requestId: string; status: 'COMPLETED' | 'REJECTED'; resolutionNote: string }) =>
    call<typeof input, { status: string }>('adminResolveDataRequest', input),
  deleteUserData: (input: { requestId: string; confirmUid: string }) =>
    call<typeof input, { status: string; rides: number; ratings: number; supportCases: number; verificationCases: number; files: number }>('adminDeleteUserData', input),

  setStaffRole: (email: string, role: StaffRole | null) =>
    call<{ email: string; role: StaffRole | null }, { uid: string; role: StaffRole | null }>('adminSetStaffRole', { email, role }),
};

export const CONFIG_KEYS = ['serviceArea', 'matching', 'documentPolicy', 'policies', 'payments', 'app'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
