import { Auth0Client } from "@auth0/nextjs-auth0/server";

const REQUIRED_AUTH_ENV = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;

export function missingAuthEnv(env: Record<string, string | undefined> = process.env): string[] {
  return REQUIRED_AUTH_ENV.filter((key) => !env[key]);
}

export function isAuthConfigured(): boolean {
  return missingAuthEnv().length === 0;
}

// Created lazily so builds, health checks and public pages keep working while Auth0 is
// not configured yet (for example on a fresh Render deploy).
let client: Auth0Client | undefined;

export function getAuth0(): Auth0Client {
  if (!client) {
    const missing = missingAuthEnv();
    if (missing.length > 0) {
      throw new Error(
        `Auth0 is not configured. Missing environment variables: ${missing.join(", ")}`,
      );
    }
    client = new Auth0Client({
      // Render injects RENDER_EXTERNAL_URL, so production needs no APP_BASE_URL.
      appBaseUrl: process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || undefined,
    });
  }
  return client;
}
