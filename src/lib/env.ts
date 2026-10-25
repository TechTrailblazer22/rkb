import { z } from "zod";

// Validated lazily so `next build` works without secrets present.
// Later phases extend this schema (Auth0, Cloudinary, Resend, cron secret...).
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1).optional(),
  // Comma separated. A verified email on this list becomes ADMIN at login (see lib/auth/roles.ts).
  ADMIN_EMAILS: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}
