import { HttpsError, onCall, type CallableOptions } from 'firebase-functions/https';
import type { z } from 'zod';
import { AppError } from '../domain/errors';
import { contextFromToken, type CallerContext } from './context';
import { log } from './log';
import { ADMIN_ORIGINS, ENFORCE_APP_CHECK } from './params';
import { parseInput } from './validation';

/**
 * Builds an authenticated, validated callable function.
 *
 *  - Rejects unauthenticated callers.
 *  - Optionally enforces App Check (controlled by ENFORCE_APP_CHECK).
 *  - Parses the payload with a strict zod schema.
 *  - Maps domain errors to HttpsError with a stable `details.reason`
 *    and hides unexpected internals from clients.
 *
 * Business logic lives in services that receive (ctx, input) so it can be
 * integration-tested without the HTTP layer.
 */
export type Handler<I, O> = (ctx: CallerContext, input: I) => Promise<O>;

interface Options {
  /** Admin-dashboard functions restrict browser origins via CORS. */
  admin?: boolean;
  memory?: CallableOptions['memory'];
  timeoutSeconds?: number;
  secrets?: CallableOptions['secrets'];
  minInstances?: number;
}

export function toHttpsError(err: unknown, fn: string): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof AppError) {
    return new HttpsError(err.status, err.message, { reason: err.reason, ...err.meta });
  }
  const code = (err as { code?: unknown })?.code;
  // Firestore transaction contention that exhausted retries.
  if (code === 10 || code === 'aborted' || code === 'ABORTED') {
    return new HttpsError('aborted', 'The server is busy. Please try again.', { reason: 'SERVICE_UNAVAILABLE' });
  }
  log.error('callable.unhandled', { fn, message: err instanceof Error ? err.message : String(err) });
  return new HttpsError('internal', 'Something went wrong. Please try again.', { reason: 'INTERNAL' });
}

export function callable<S extends z.ZodType, O>(name: string, schema: S, handler: Handler<z.infer<S>, O>, options: Options = {}) {
  return onCall(
    {
      enforceAppCheck: ENFORCE_APP_CHECK,
      cors: options.admin ? ADMIN_ORIGINS : true,
      memory: options.memory ?? '256MiB',
      timeoutSeconds: options.timeoutSeconds ?? 30,
      secrets: options.secrets,
      minInstances: options.minInstances,
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Sign in required.', { reason: 'UNAUTHENTICATED' });
      }
      const ctx = contextFromToken(request.auth.uid, request.auth.token as unknown as Record<string, unknown>);
      try {
        const input = parseInput(schema, request.data);
        return await handler(ctx, input);
      } catch (err) {
        throw toHttpsError(err, name);
      }
    },
  );
}
