import { z } from 'zod';
import { callable } from '../lib/callable';
import { dateString, personName, phPhone, text, uploadId } from '../lib/validation';
import { completeRegistration, registerDevice, requestDataAction, unregisterDevice, updateProfile } from '../services/accounts';
import { submitPassengerVerification } from '../services/passengerVerification';

export const completeRegistrationFn = callable(
  'completeRegistration',
  z.strictObject({
    accountType: z.enum(['PASSENGER', 'DRIVER']),
    fullName: personName,
    termsVersion: z.string().min(1).max(20),
    privacyNoticeVersion: z.string().min(1).max(20),
    locale: z.enum(['en', 'fil']).default('en'),
  }),
  completeRegistration,
);

export const updateProfileFn = callable(
  'updateProfile',
  z.strictObject({
    emergencyContact: z.strictObject({ name: personName, phone: phPhone }).nullable().optional(),
    locale: z.enum(['en', 'fil']).optional(),
  }),
  updateProfile,
);

export const registerDeviceFn = callable(
  'registerDevice',
  z.strictObject({
    installationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    token: z.string().min(20).max(4096),
    platform: z.enum(['android', 'web']),
  }),
  registerDevice,
);

export const unregisterDeviceFn = callable(
  'unregisterDevice',
  z.strictObject({ installationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }),
  unregisterDevice,
);

export const requestDataActionFn = callable(
  'requestDataAction',
  z.strictObject({ type: z.enum(['ACCESS', 'DELETION', 'CORRECTION']), note: text(0, 1000).nullable().default(null) }),
  requestDataAction,
);

const uploadRef = z.strictObject({ side: z.enum(['FRONT', 'BACK', 'PHOTO']), uploadId });

export const submitPassengerVerificationFn = callable(
  'submitPassengerVerification',
  z.strictObject({
    idType: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    nameOnId: personName,
    idExpiry: dateString.nullable().default(null),
    uploads: z.array(uploadRef).min(1).max(2),
  }),
  submitPassengerVerification,
  { memory: '512MiB', timeoutSeconds: 60 },
);
