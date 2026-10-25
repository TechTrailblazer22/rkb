/**
 * A string that sorts plot numbers the way people expect: "A-2" before "A-10".
 * Every run of digits is zero-padded, and case is ignored.
 */
export function plotSortKey(number: string): string {
  return number
    .toLowerCase()
    .replace(/\d+/g, (digits) => digits.padStart(8, "0"))
    .slice(0, 80);
}
