import { FirebaseError } from 'firebase/app';

/** Stable backend reasons the dashboard explains specially. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  PERMISSION_DENIED: 'Your role does not allow this action.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  SERVICE_UNAVAILABLE: 'The service is busy. Try again.',
  INVALID_STATE_TRANSITION: 'This record changed in the meantime. Reload and review it again.',
  NOT_FOUND: 'The record no longer exists.',
};

export interface DisplayError {
  message: string;
  reason: string | null;
  /** Field-level validation issues returned by config updates. */
  fields: Array<{ path: string; message: string }>;
}

export function toDisplayError(err: unknown): DisplayError {
  if (err instanceof FirebaseError) {
    const details = (err as FirebaseError & { details?: unknown }).details as
      | { reason?: unknown; fields?: unknown }
      | undefined;
    const reason = typeof details?.reason === 'string' ? details.reason : null;
    const fields = Array.isArray(details?.fields)
      ? (details!.fields as unknown[]).filter(
          (f): f is { path: string; message: string } =>
            typeof f === 'object' && f != null && typeof (f as { path?: unknown }).path === 'string',
        )
      : [];
    if (err.code === 'permission-denied' || err.code === 'functions/permission-denied') {
      return { message: reason && MESSAGES[reason] ? MESSAGES[reason] : MESSAGES.PERMISSION_DENIED!, reason: reason ?? 'PERMISSION_DENIED', fields };
    }
    if (err.code === 'unavailable' || err.code === 'functions/unavailable') {
      return { message: 'Network or service unavailable. Check your connection and try again.', reason, fields };
    }
    // Backend messages are written for people and never contain internals.
    const message = (reason && MESSAGES[reason]) || err.message.replace(/^Firebase:\s*/, '') || 'Something went wrong.';
    return { message, reason, fields };
  }
  return { message: err instanceof Error ? err.message : 'Something went wrong.', reason: null, fields: [] };
}
