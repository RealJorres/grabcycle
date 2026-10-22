import { limit, orderBy, where, type QueryConstraint } from 'firebase/firestore';

export interface AuditFilter {
  category: string;
  targetUid: string;
  actorUid: string;
}

/**
 * Builds constraints that match an existing composite index and that the
 * security rules can prove: non-admin roles must always filter by their
 * permitted category, otherwise the whole query is denied.
 */
export function auditConstraints(f: AuditFilter, allowed: string[] | 'ALL'): QueryConstraint[] | null {
  const c: QueryConstraint[] = [];
  const category = allowed === 'ALL' ? f.category : f.category || allowed[0];
  if (allowed !== 'ALL' && (!category || !allowed.includes(category))) return null;
  if (category) c.push(where('category', '==', category));
  if (f.targetUid) c.push(where('targetUid', '==', f.targetUid));
  else if (f.actorUid && allowed === 'ALL' && !category) c.push(where('actorUid', '==', f.actorUid));
  c.push(orderBy('at', 'desc'), limit(100));
  return c;
}
