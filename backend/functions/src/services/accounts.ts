import type { Transaction } from 'firebase-admin/firestore';
import { AppError, fail } from '../domain/errors';
import type { AccountType } from '../domain/types';
import { writeAudit } from '../lib/audit';
import { getConfig } from '../lib/configStore';
import type { CallerContext } from '../lib/context';
import { db } from '../lib/firebase';
import { enforceRateLimit } from '../lib/rateLimit';
import { nowTs } from '../lib/time';
import type { DriverDoc, UserDoc } from './models';
import { registerDeviceToken } from './notifications';

/**
 * Account registration and profile management.
 *
 * One Firebase Auth identity == one GrabCycle account of exactly one type.
 * The account type is fixed at registration by the server; becoming an
 * active driver additionally requires accreditation approval.
 */

export const usersCol = () => db().collection('users');
export const driversCol = () => db().collection('drivers');

export async function getUser(uid: string, tx?: Transaction): Promise<UserDoc | null> {
  const ref = usersCol().doc(uid);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

export function assertActive(user: UserDoc | null, type?: AccountType): UserDoc {
  if (!user) throw fail.precondition('ACCOUNT_NOT_REGISTERED', 'Please complete your registration first.');
  if (user.status !== 'ACTIVE') {
    throw fail.precondition('ACCOUNT_SUSPENDED', 'Your account is not active. Please contact GrabCycle support.');
  }
  if (type && user.accountType !== type) {
    throw fail.precondition('ACCOUNT_TYPE_MISMATCH', `This action is only available to ${type.toLowerCase()} accounts.`);
  }
  return user;
}

export async function requireActiveUser(uid: string, type?: AccountType, tx?: Transaction): Promise<UserDoc> {
  return assertActive(await getUser(uid, tx), type);
}

export interface RegistrationInput {
  accountType: AccountType;
  fullName: string;
  termsVersion: string;
  privacyNoticeVersion: string;
  locale: 'en' | 'fil';
}

function firstNameOf(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

/** Public-facing driver name: first name + last initial. */
export function publicDriverName(fullName: string): string {
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length < 2) return parts[0] ?? fullName;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

export async function completeRegistration(ctx: CallerContext, input: RegistrationInput) {
  if (ctx.staffRole) throw fail.forbidden('Staff accounts cannot register as passengers or drivers.');
  if (!ctx.phoneNumber || ctx.signInProvider !== 'phone') {
    throw fail.precondition('PHONE_NOT_VERIFIED', 'Please sign in with your mobile number to register.');
  }
  await enforceRateLimit(ctx.uid, 'completeRegistration');

  const policies = await getConfig('policies');
  if (input.termsVersion !== policies.terms.termsVersion || input.privacyNoticeVersion !== policies.terms.privacyNoticeVersion) {
    throw fail.precondition('CONSENT_REQUIRED', 'Please review and accept the latest Terms and Privacy Notice.', {
      termsVersion: policies.terms.termsVersion,
      privacyNoticeVersion: policies.terms.privacyNoticeVersion,
    });
  }

  return db().runTransaction(async (tx) => {
    const userRef = usersCol().doc(ctx.uid);
    const existing = await tx.get(userRef);
    if (existing.exists) {
      const user = existing.data() as UserDoc;
      if (user.accountType !== input.accountType) {
        throw new AppError('already-exists', 'ACCOUNT_ALREADY_REGISTERED', 'This mobile number is already registered with a different account type.');
      }
      return { uid: ctx.uid, accountType: user.accountType, created: false };
    }

    const now = nowTs();
    const user: UserDoc = {
      uid: ctx.uid,
      accountType: input.accountType,
      status: 'ACTIVE',
      displayName: input.fullName,
      firstName: firstNameOf(input.fullName),
      phoneNumber: ctx.phoneNumber,
      locale: input.locale,
      passengerVerification:
        input.accountType === 'PASSENGER'
          ? { status: 'NOT_SUBMITTED', caseId: null, validUntil: null, publicMessage: null, submittedAt: null, updatedAt: now }
          : null,
      activeRideId: null,
      emergencyContact: null,
      fareDiscount: null,
      consents: { termsVersion: input.termsVersion, privacyNoticeVersion: input.privacyNoticeVersion, acceptedAt: now },
      ratingSummary: { count: 0, sum: 0 },
      suspension: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(userRef, user);

    if (input.accountType === 'DRIVER') {
      const driver: DriverDoc = {
        uid: ctx.uid,
        displayName: input.fullName,
        firstName: user.firstName,
        status: 'PROFILE_INCOMPLETE',
        everApproved: false,
        applicationSubmittedAt: null,
        accountStatus: 'ACTIVE',
        profile: null,
        vehicle: null,
        availability: 'OFFLINE',
        currentOfferRideId: null,
        currentRideId: null,
        presenceSessionId: null,
        availabilityChangedAt: null,
        lastOnlineAt: null,
        eligibility: null,
        documentsSummary: {},
        publicProfile: { displayName: publicDriverName(input.fullName), photoPath: null, vehicleSummary: '' },
        ratingSummary: { count: 0, sum: 0 },
        missedOffers: 0,
        stats: { completedTrips: 0, cancelledByDriver: 0, declinedOffers: 0 },
        decision: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(driversCol().doc(ctx.uid), driver);
    }

    writeAudit(tx, {
      category: 'SECURITY',
      action: 'ACCOUNT_REGISTERED',
      actorUid: ctx.uid,
      actorRole: input.accountType,
      targetType: 'user',
      targetId: ctx.uid,
      targetUid: ctx.uid,
      details: { accountType: input.accountType },
    });
    return { uid: ctx.uid, accountType: input.accountType, created: true };
  });
}

export interface ProfileUpdateInput {
  emergencyContact?: { name: string; phone: string } | null;
  locale?: 'en' | 'fil';
}

export async function updateProfile(ctx: CallerContext, input: ProfileUpdateInput) {
  const user = await requireActiveUser(ctx.uid);
  const updates: Record<string, unknown> = { updatedAt: nowTs() };
  if (input.emergencyContact !== undefined) {
    if (input.emergencyContact && input.emergencyContact.phone === user.phoneNumber) {
      throw fail.invalid('Your emergency contact must be a different number from your own.');
    }
    updates.emergencyContact = input.emergencyContact;
  }
  if (input.locale) updates.locale = input.locale;
  await usersCol().doc(ctx.uid).update(updates);
  return { ok: true };
}

export async function registerDevice(ctx: CallerContext, input: { installationId: string; token: string; platform: 'android' | 'web' }) {
  await requireActiveUser(ctx.uid);
  await enforceRateLimit(ctx.uid, 'registerDevice');
  await registerDeviceToken(ctx.uid, input.installationId, input.token, input.platform);
  return { ok: true };
}

export async function unregisterDevice(ctx: CallerContext, input: { installationId: string }) {
  await usersCol().doc(ctx.uid).collection('devices').doc(input.installationId).delete();
  return { ok: true };
}

/** Data-subject requests (access / deletion) are logged and processed by staff. */
export async function requestDataAction(ctx: CallerContext, input: { type: 'ACCESS' | 'DELETION' | 'CORRECTION'; note: string | null }) {
  await enforceRateLimit(ctx.uid, 'dataRequest');
  const ref = db().collection('dataRequests').doc();
  await ref.set({
    requestId: ref.id,
    uid: ctx.uid,
    type: input.type,
    note: input.note,
    status: 'RECEIVED',
    createdAt: nowTs(),
    updatedAt: nowTs(),
  });
  await writeAudit(null, {
    category: 'SECURITY',
    action: 'DATA_REQUEST_RECEIVED',
    actorUid: ctx.uid,
    actorRole: 'USER',
    targetType: 'dataRequest',
    targetId: ref.id,
    targetUid: ctx.uid,
    details: { type: input.type },
  });
  return { requestId: ref.id };
}
