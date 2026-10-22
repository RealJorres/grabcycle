import type { Transaction, WriteBatch } from 'firebase-admin/firestore';
import { db } from './firebase';
import { nowTs } from './time';

/**
 * Append-only audit trail for consequential actions (reviews, suspensions,
 * configuration changes, document access, ride interventions, payments).
 * Clients cannot read or write it directly; staff read it by role/category.
 */
export type AuditCategory = 'REVIEW' | 'SUPPORT' | 'SECURITY' | 'OPERATIONS' | 'CONFIG' | 'PAYMENT';

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  actorUid: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  /** Account the action concerns (for per-user history views). */
  targetUid?: string | null;
  reasonCode?: string | null;
  /** Non-sensitive structured details only. Never ID numbers, phone numbers or document URLs. */
  details?: Record<string, unknown>;
}

export function auditRef() {
  return db().collection('auditLogs').doc();
}

export function writeAudit(writer: Transaction | WriteBatch | null, entry: AuditEntry): Promise<unknown> | void {
  const data = {
    ...entry,
    targetUid: entry.targetUid ?? null,
    reasonCode: entry.reasonCode ?? null,
    details: entry.details ?? {},
    at: nowTs(),
  };
  const ref = auditRef();
  if (writer) {
    // Transaction and WriteBatch share the same `set` signature.
    (writer as WriteBatch).set(ref, data);
    return;
  }
  return ref.set(data);
}
