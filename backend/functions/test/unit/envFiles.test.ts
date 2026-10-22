import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The functions runtime parses list parameters with JSON.parse, and the
 * emulator hands it the .env text unchanged. A value that is not a JSON array
 * makes firebase-functions disable CORS, so the dashboard cannot call any
 * admin function.
 */
function adminOrigins(file: string): unknown {
  const text = readFileSync(join(__dirname, '../..', file), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('ADMIN_ORIGINS='));
  if (!line) throw new Error(`ADMIN_ORIGINS missing from ${file}`);
  return JSON.parse(line.slice('ADMIN_ORIGINS='.length));
}

describe('functions .env files', () => {
  it.each(['.env.demo-grabcycle', '.env.example'])('%s lists ADMIN_ORIGINS as a JSON array of origins', (file) => {
    const origins = adminOrigins(file);
    expect(Array.isArray(origins)).toBe(true);
    for (const o of origins as unknown[]) expect(String(o)).toMatch(/^https?:\/\/[^/,\s]+$/);
  });

  it('the emulator config allows the dashboard dev server', () => {
    expect(adminOrigins('.env.demo-grabcycle')).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
  });
});
