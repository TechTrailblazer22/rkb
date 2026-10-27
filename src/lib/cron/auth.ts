import { createHash, timingSafeEqual } from "node:crypto";

export type CronAccess = "ok" | "disabled" | "denied";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks the secret a scheduler sends in the `Authorization: Bearer ...` header. With no secret
 * configured the scheduled endpoints are off entirely ("disabled"), so they cannot be reached by
 * accident. The comparison takes the same time whatever is sent.
 */
export function checkCronAccess(
  headers: { get(name: string): string | null },
  secret: string | undefined = process.env.CRON_SECRET,
): CronAccess {
  if (!secret || secret.length < 16) return "disabled";
  const header = headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return given && timingSafeEqual(digest(given), digest(secret)) ? "ok" : "denied";
}
