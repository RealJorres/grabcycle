import { createHash, randomBytes } from 'node:crypto';

/** Unguessable identifier for storage objects and records (base64url, 128+ bits). */
export function randomId(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Deterministic ride id derived from the passenger and the client-generated
 * idempotency key, so retried booking requests resolve to the same ride.
 */
export function rideIdFor(passengerUid: string, requestId: string): string {
  return createHash('sha256').update(`ride:${passengerUid}:${requestId}`).digest('hex').slice(0, 32);
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Masks a phone number for display in queues and logs: +63917•••4567. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 7) return '•••';
  return `${phone.slice(0, 6)}•••${phone.slice(-4)}`;
}
