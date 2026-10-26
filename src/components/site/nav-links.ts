export const NAV_LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/for-builders", label: "For builders" },
  { href: "/pricing", label: "Pricing" },
] as const;

// Our own page where people choose to log in as a buyer or as a builder. It is an ordinary page,
// so Link works. The Auth0 routes it leads to need full page navigations (plain <a> tags).
export const LOGIN_HREF = "/login";
export const LIST_PROJECT_HREF = "/auth/login?screen_hint=signup&returnTo=%2Fstart-listing";
