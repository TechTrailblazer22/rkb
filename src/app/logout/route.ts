import { withoutModeCookie } from "@/lib/auth/mode-cookie";
import { redirectTo } from "@/lib/http";

// Log out: forget which account was in use, then let Auth0 end the session. Every Log out link in
// the site points here instead of straight to /auth/logout.
export function GET() {
  return withoutModeCookie(redirectTo("/auth/logout"));
}
