import type { Role } from "@/generated/prisma/enums";

export type AuthUser = {
  id: string;
  role: Role;
  /** Builders this user belongs to (any member role). */
  builderIds: string[];
};

export type Action = "account:access" | "portal:access" | "admin:access" | "builder:manage";

export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string, adminEmails: string[]): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}

/**
 * Role to store for a user after login. Admin comes only from the ADMIN_EMAILS allowlist
 * AND a verified email, otherwise anyone could sign up with an admin's address.
 * The allowlist only promotes; it never demotes (admins are managed in the console later).
 */
export function computeRole(input: {
  current: Role;
  email: string;
  emailVerified: boolean;
  adminEmails: string[];
}): Role {
  if (input.current === "ADMIN") return "ADMIN";
  if (input.emailVerified && isAdminEmail(input.email, input.adminEmails)) return "ADMIN";
  return input.current;
}

export function homePathForRole(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "BUILDER_OWNER":
    case "BUILDER_TEAM":
      return "/portal";
    default:
      return "/account";
  }
}

/**
 * Single place for authorisation rules. Always call this on the server; hiding a
 * button in the UI is not access control.
 */
export function can(
  user: AuthUser | null,
  action: Action,
  resource?: { builderId?: string },
): boolean {
  if (!user) return false;
  switch (action) {
    case "account:access":
      return true;
    case "admin:access":
      return user.role === "ADMIN";
    case "portal:access":
      return user.role === "BUILDER_OWNER" || user.role === "BUILDER_TEAM";
    case "builder:manage":
      if (user.role === "ADMIN") return true;
      if (user.role !== "BUILDER_OWNER" && user.role !== "BUILDER_TEAM") return false;
      return resource?.builderId !== undefined && user.builderIds.includes(resource.builderId);
    default:
      return false;
  }
}
