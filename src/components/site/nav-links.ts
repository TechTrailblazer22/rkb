export const NAV_LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/for-builders", label: "For builders" },
  { href: "/pricing", label: "Pricing" },
] as const;

// Auth0 routes need full page navigations, so these are used with plain <a> tags.
export const LOGIN_HREF = "/auth/login";
export const LIST_PROJECT_HREF = "/auth/login?screen_hint=signup&returnTo=%2Fstart-listing";
