const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** Always in Indian time, wherever the server runs. */
export const formatDateTime = (date: Date) => DATE_TIME.format(date);
export const formatDate = (date: Date) => DATE.format(date);

/** "2026-11-03T10:30" in Indian time, for a datetime-local input. */
export function toInputValue(date: Date | null): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + (5 * 60 + 30) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
