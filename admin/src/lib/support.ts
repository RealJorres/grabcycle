import type { SupportCase } from './models';

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };

/** Urgent (safety) cases first, then oldest first within a priority. */
export function sortCases<T extends Pick<SupportCase, 'priority' | 'createdAt'>>(cases: T[]): T[] {
  return [...cases].sort((a, b) => {
    const p = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
    if (p !== 0) return p;
    return (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0);
  });
}
