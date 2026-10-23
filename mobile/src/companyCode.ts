/**
 * Client-side preview of the company code — mirrors backend/src/services/tenant.service.ts:
 * first 5 letters of the name + last 5 digits of the mobile + subscription date (DDMMYYYY, Riyadh).
 * The server is authoritative; this only shows the user what their code will look like.
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('966') && digits.length === 12) digits = `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('5')) digits = `0${digits}`;
  return digits;
}

export function isSaudiMobile(raw: string) {
  return /^05\d{8}$/.test(normalizePhone(raw));
}

export function previewCompanyCode(name: string, phone: string, at = new Date()): string | null {
  const letters = Array.from(name.normalize('NFC')).filter((ch) => /\p{L}/u.test(ch));
  const digits = normalizePhone(phone);
  if (!letters.length || digits.length < 5) return null;
  // Riyadh is UTC+3 all year (no daylight saving).
  const riyadh = new Date(at.getTime() + 3 * 3600_000);
  const dd = String(riyadh.getUTCDate()).padStart(2, '0');
  const mm = String(riyadh.getUTCMonth() + 1).padStart(2, '0');
  return `${letters.slice(0, 5).join('').padEnd(5, 'X')}${digits.slice(-5)}${dd}${mm}${riyadh.getUTCFullYear()}`;
}
