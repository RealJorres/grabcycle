import { z } from 'zod';
import { AppError } from '../domain/errors';

/**
 * Input validation helpers. Every callable parses its payload with a strict
 * schema; unknown fields are rejected so clients cannot smuggle in
 * authoritative values (status, fare, role, timestamps...).
 */

export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = result.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError('invalid-argument', 'INVALID_ARGUMENT', 'Some information is missing or invalid.', { fields });
  }
  return result.data;
}

/** Trimmed single-line text without control characters. */
export const text = (min: number, max: number) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

/** Multi-line free text (support descriptions, notes). */
export const longText = (min: number, max: number) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex -- keep newlines/tabs, strip other control characters
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(min).max(max));

/** Person names: letters (incl. Filipino ñ and accents), spaces, apostrophes, dots, hyphens. */
export const personName = text(2, 100).pipe(
  z.string().regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, 'Name contains unsupported characters.'),
);

export const latLngSchema = z.strictObject({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const placeSchema = z.strictObject({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: text(1, 300),
  placeId: z.string().max(300).nullish(),
});

/** Client-generated idempotency key (UUID or similar). */
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid request id.');

/** Firestore document id produced by this backend. */
export const docId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, 'Invalid id.');

export const uploadId = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'Invalid upload id.');

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** Philippine mobile number in E.164 form (+639XXXXXXXXX). */
export const phPhone = z.string().regex(/^\+639\d{9}$/, 'Use a Philippine mobile number, e.g. +639171234567.');

export const reasonCode = z.string().regex(/^[A-Z0-9_]{2,40}$/, 'Invalid reason code.');
