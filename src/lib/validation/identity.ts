// Format checks for Indian business identifiers. These catch typos early; they do not prove
// the number belongs to the builder. That is what the document review is for.

export function normalizePan(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** 5 letters, 4 digits, 1 letter, e.g. ABCDE1234F. */
export function isValidPan(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizePan(value));
}

export function normalizeGstin(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a check digit over the first 14 (base 36). */
function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** State code (2 digits), the holder's PAN, entity number, a literal Z, and a check character. */
export function isValidGstin(value: string): boolean {
  const gstin = normalizeGstin(value);
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/** The PAN a GSTIN was issued against is embedded in it (characters 3 to 12). */
export function panFromGstin(value: string): string {
  return normalizeGstin(value).slice(2, 12);
}

/** Returns the 10 digit Indian mobile number, or null if it is not one. Accepts +91 and 0 prefixes. */
export function normalizeMobile(value: string): string | null {
  let digits = value.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
}

export function isValidPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}

/** Builds a valid GSTIN from its first 14 characters by adding the check character. For seed data and tests. */
export function completeGstin(first14: string): string {
  return first14 + gstinCheckChar(first14);
}
