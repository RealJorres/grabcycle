import { z } from 'zod';
import { CONFIG_KEYS, type ConfigKey } from '../domain/config';
import { STAFF_ROLES, SUPPORT_STATUSES } from '../domain/types';
import { callable } from '../lib/callable';
import { requirePermission } from '../lib/permissions';
import { dateString, docId, longText, reasonCode, text } from '../lib/validation';
import { getDocumentFile, getOverview, setAccountStatus, setFareDiscount, setStaffRole } from '../services/admin';
import { activateFareVersion, publishFareConfig, updateConfig, upsertLandmark } from '../services/configAdmin';
import { decideDriver, reviewDriverDocument, reviewVehicle } from '../services/drivers';
import {
  adminUpdatePassengerVerification,
  claimVerificationCase,
  decidePassengerVerification,
} from '../services/passengerVerification';
import { resolvePayment } from '../services/payments';
import { deleteUserData, exportUserData, resolveDataRequest } from '../services/privacy';
import { cancelRide, completeRide } from '../services/rides';
import { updateSupportCase } from '../services/support';

const admin = { admin: true } as const;
const uid = z.string().min(6).max(128);
const rideId = z.string().regex(/^[a-f0-9]{32}$/);
const publicMessage = longText(5, 500);
const internalNote = longText(1, 2000).nullable().default(null);
const decision = z.enum(['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION']);

export const adminClaimVerificationCaseFn = callable('adminClaimVerificationCase', z.strictObject({ caseId: docId }), claimVerificationCase, admin);

export const adminDecidePassengerVerificationFn = callable(
  'adminDecidePassengerVerification',
  z.strictObject({
    caseId: docId,
    decision,
    reasonCode: reasonCode.nullable().default(null),
    publicMessage: publicMessage.nullable().default(null),
    internalNote,
    checklist: z
      .strictObject({
        nameMatchesProfile: z.boolean().optional(),
        photoClear: z.boolean().optional(),
        documentUnexpired: z.boolean().optional(),
        appearsAuthentic: z.boolean().optional(),
      })
      .default({}),
  }),
  decidePassengerVerification,
  admin,
);

export const adminUpdatePassengerVerificationFn = callable(
  'adminUpdatePassengerVerification',
  z.strictObject({ uid, action: z.enum(['SUSPEND', 'REINSTATE', 'REVOKE', 'REOPEN']), reasonCode, publicMessage, internalNote }),
  adminUpdatePassengerVerification,
  admin,
);

export const adminReviewDriverDocumentFn = callable(
  'adminReviewDriverDocument',
  z.strictObject({
    driverUid: uid,
    requirementCode: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    submissionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    decision,
    reasonCode: reasonCode.nullable().default(null),
    publicMessage: publicMessage.nullable().default(null),
    internalNote,
    verifiedExpiryDate: dateString.nullable().default(null),
  }),
  reviewDriverDocument,
  admin,
);

export const adminReviewVehicleFn = callable(
  'adminReviewVehicle',
  z.strictObject({ driverUid: uid, decision, reasonCode: reasonCode.nullable().default(null), publicMessage: publicMessage.nullable().default(null), internalNote }),
  reviewVehicle,
  admin,
);

export const adminDecideDriverFn = callable(
  'adminDecideDriver',
  z.strictObject({
    driverUid: uid,
    decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']),
    reasonCode: reasonCode.nullable().default(null),
    publicMessage: publicMessage.nullable().default(null),
    internalNote,
  }),
  decideDriver,
  admin,
);

export const adminGetDocumentFileFn = callable(
  'adminGetDocumentFile',
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('PASSENGER_CASE'), caseId: docId, side: z.enum(['FRONT', 'BACK']) }),
    z.strictObject({
      kind: z.literal('DRIVER_DOCUMENT'),
      driverUid: uid,
      requirementCode: z.string().regex(/^[A-Z0-9_]{2,40}$/),
      version: z.enum(['pending', 'approved']),
      side: z.enum(['FRONT', 'BACK', 'PHOTO']),
    }),
  ]),
  getDocumentFile,
  { ...admin, memory: '512MiB' },
);

export const adminSetAccountStatusFn = callable(
  'adminSetAccountStatus',
  z.strictObject({ uid, status: z.enum(['ACTIVE', 'SUSPENDED']), reasonCode, publicMessage, internalNote }),
  setAccountStatus,
  admin,
);

export const adminSetFareDiscountFn = callable(
  'adminSetFareDiscount',
  z.strictObject({ uid, code: z.string().regex(/^[A-Z_]{2,20}$/).nullable(), expiresOn: dateString.nullable().default(null), reasonCode }),
  setFareDiscount,
  admin,
);

export const adminSetStaffRoleFn = callable(
  'adminSetStaffRole',
  z.strictObject({ email: z.email().max(200), role: z.enum(STAFF_ROLES).nullable() }),
  setStaffRole,
  admin,
);

export const adminGetOverviewFn = callable('adminGetOverview', z.strictObject({}), (ctx) => getOverview(ctx), admin);

export const adminUpdateConfigFn = callable(
  'adminUpdateConfig',
  z.strictObject({ key: z.enum(CONFIG_KEYS as [ConfigKey, ...ConfigKey[]]), value: z.record(z.string(), z.unknown()) }),
  updateConfig,
  admin,
);

export const adminPublishFareConfigFn = callable(
  'adminPublishFareConfig',
  z.strictObject({ config: z.record(z.string(), z.unknown()), activate: z.boolean() }),
  publishFareConfig,
  admin,
);

export const adminActivateFareVersionFn = callable(
  'adminActivateFareVersion',
  z.strictObject({ version: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/) }),
  activateFareVersion,
  admin,
);

export const adminUpsertLandmarkFn = callable(
  'adminUpsertLandmark',
  z.strictObject({
    id: docId.nullable().default(null),
    name: text(2, 120),
    municipality: text(2, 60),
    barangay: text(2, 80).nullable().default(null),
    keywords: z.array(text(1, 40)).max(10).default([]),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    active: z.boolean().default(true),
  }),
  upsertLandmark,
  admin,
);

export const adminCancelRideFn = callable(
  'adminCancelRide',
  z.strictObject({ rideId, reasonCode, note: text(1, 300).nullable().default(null) }),
  (ctx, input) => {
    requirePermission(ctx, 'rides.intervene');
    return cancelRide(ctx, input);
  },
  admin,
);

export const adminCompleteRideFn = callable(
  'adminCompleteRide',
  z.strictObject({ rideId, cashCollected: z.number().int().min(0).max(10_000_000).nullable().default(null) }),
  (ctx, input) => {
    requirePermission(ctx, 'rides.intervene');
    return completeRide(ctx, { ...input, adjustments: [] });
  },
  admin,
);

export const adminResolvePaymentFn = callable(
  'adminResolvePayment',
  z.strictObject({ rideId, status: z.enum(['PAID', 'REFUNDED', 'FAILED']), note: longText(3, 500) }),
  resolvePayment,
  admin,
);

export const adminUpdateSupportCaseFn = callable(
  'adminUpdateSupportCase',
  z.strictObject({
    caseId: docId,
    status: z.enum(SUPPORT_STATUSES),
    publicResponse: longText(1, 2000).nullable().default(null),
    internalNote,
    assignToMe: z.boolean().default(false),
  }),
  updateSupportCase,
  admin,
);

export const adminExportUserDataFn = callable(
  'adminExportUserData',
  z.strictObject({ requestId: docId }),
  exportUserData,
  { ...admin, memory: '512MiB', timeoutSeconds: 120 },
);

export const adminResolveDataRequestFn = callable(
  'adminResolveDataRequest',
  z.strictObject({ requestId: docId, status: z.enum(['COMPLETED', 'REJECTED']), resolutionNote: longText(3, 1000) }),
  resolveDataRequest,
  admin,
);

export const adminDeleteUserDataFn = callable(
  'adminDeleteUserData',
  z.strictObject({ requestId: docId, confirmUid: uid }),
  deleteUserData,
  { ...admin, memory: '512MiB', timeoutSeconds: 540 },
);
