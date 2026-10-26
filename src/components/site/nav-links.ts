// `for` says which side a link belongs to. A logged-in buyer is not shown builder links and a
// logged-in builder is not shown buyer links (see data-for in globals.css); visitors see them all.
export const NAV_LINKS = [
  { href: "/projects", label: "Projects", for: "buyer" },
  { href: "/for-builders", label: "For builders", for: "builder" },
  { href: "/pricing", label: "Pricing", for: "builder" },
] as const;

// Our own page where people choose to log in as a buyer or as a builder. It is an ordinary page,
// so Link works. The Auth0 routes it leads to need full page navigations (plain <a> tags).
export const LOGIN_HREF = "/login";
export const LIST_PROJECT_HREF = "/auth/login?screen_hint=signup&returnTo=%2Fstart-listing";
