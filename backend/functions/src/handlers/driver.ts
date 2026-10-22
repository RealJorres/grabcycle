import { z } from 'zod';
import { callable } from '../lib/callable';
import { dateString, text, uploadId } from '../lib/validation';
import { setDriverAvailability } from '../services/availability';
import { refreshMyEligibility, saveDriverProfile, submitDriverApplication, submitDriverDocument } from '../services/drivers';

const upper = (min: number, max: number, re: RegExp) =>
  text(min, max)
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(re));

export const saveDriverProfileFn = callable(
  'saveDriverProfile',
  z.strictObject({
    municipality: text(2, 60),
    vehicle: z.strictObject({
      plateNumber: upper(4, 12, /^[A-Z0-9][A-Z0-9 -]{2,11}$/),
      bodyNumber: upper(1, 12, /^[A-Z0-9-]{1,12}$/),
      make: text(2, 40),
      model: text(1, 40),
      color: text(3, 30),
      capacity: z.number().int().min(1).max(8),
      franchiseMunicipality: text(2, 60),
    }),
  }),
  saveDriverProfile,
);

export const submitDriverDocumentFn = callable(
  'submitDriverDocument',
  z.strictObject({
    requirementCode: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    uploads: z.array(z.strictObject({ side: z.enum(['FRONT', 'BACK', 'PHOTO']), uploadId })).min(1).max(3),
    expiryDate: dateString.nullable().default(null),
    documentNumber: z.string().max(40).nullable().default(null),
  }),
  submitDriverDocument,
  { memory: '512MiB', timeoutSeconds: 60 },
);

export const submitDriverApplicationFn = callable('submitDriverApplication', z.strictObject({}), (ctx) => submitDriverApplication(ctx));

export const refreshDriverEligibilityFn = callable('refreshDriverEligibility', z.strictObject({}), (ctx) => refreshMyEligibility(ctx));

export const setDriverAvailabilityFn = callable(
  'setDriverAvailability',
  z.strictObject({
    online: z.boolean(),
    location: z
      .strictObject({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        accuracy: z.number().finite().min(0).max(10_000),
        mock: z.boolean().default(false),
      })
      .nullable()
      .default(null),
  }),
  setDriverAvailability,
);
