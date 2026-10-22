/** Normalizes a Philippine mobile number to E.164 (+639XXXXXXXXX), or null. Mirrors the app's rule. */
export function normalizePhilippineMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  let national: string;
  if (digits.startsWith('63') && digits.length === 12) national = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10) national = digits;
  else return null;
  return national.startsWith('9') ? `+63${national}` : null;
}
