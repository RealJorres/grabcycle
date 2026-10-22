/** Parses editor text; returns the object or a readable error. Exported for tests. */
export function parseConfigJson(text: string): { value: Record<string, unknown> | null; error: string | null } {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { value: null, error: 'The configuration must be a JSON object.' };
    // `meta` is written by the server (revision, editor, time) and is not editable.
    const { meta: _meta, ...rest } = v as Record<string, unknown>;
    return { value: rest, error: null };
  } catch (e) {
    return { value: null, error: `Invalid JSON: ${(e as Error).message}` };
  }
}
