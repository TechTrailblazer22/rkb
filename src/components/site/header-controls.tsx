"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { LIST_PROJECT_HREF, LOGIN_HREF, NAV_LINKS } from "@/components/site/nav-links";

type Role = "BUYER" | "BUILDER_OWNER" | "BUILDER_TEAM" | "ADMIN";
type AuthState = {
  authenticated: boolean;
  emailVerified: boolean;
  name: string | null;
  role?: Role | null;
};

const LOGGED_OUT: AuthState = { authenticated: false, emailVerified: false, name: null };

// Login buttons and the mobile menu. The page itself stays static; who is logged in, and as what,
// is fetched after load. Until it arrives the buttons are invisible but keep their space, so
// logged-in visitors never see a flash of "Log in" and nothing jumps.
//
// What is shown depends on the account: a buyer sees Saved and My account, a builder sees the
// builder portal, the admin sees the console. (This only changes the links; what each account may
// open is decided on the server.)
export function HeaderControls() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: AuthState | null) => setAuth(data ?? LOGGED_OUT))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuth(LOGGED_OUT);
        }
      });
    return () => controller.abort();
  }, []);

  const ready = auth !== null;
  const loggedIn = auth?.authenticated ?? false;
  const needsVerification = loggedIn && !auth?.emailVerified;
  const role = auth?.role ?? null;

  const logout = (
    <a href="/auth/logout" className={buttonClass("onDark")}>
      Log out
    </a>
  );

  const actions = needsVerification ? (
    // Signed in at Auth0 but our app will not open anything until the email is verified.
    <>
      <Link href="/account-problem?reason=email-unverified" className={buttonClass("accent")}>
        Verify your email
      </Link>
      {logout}
    </>
  ) : loggedIn && role === "BUYER" ? (
    <>
      <Link href="/account/shortlist" className={buttonClass("onDark")}>
        Saved
      </Link>
      <Link href="/account" className={buttonClass("accent")}>
        My account
      </Link>
      {logout}
    </>
  ) : loggedIn && (role === "BUILDER_OWNER" || role === "BUILDER_TEAM") ? (
    <>
      <Link href="/portal" className={buttonClass("accent")}>
        Builder portal
      </Link>
      {logout}
    </>
  ) : loggedIn && role === "ADMIN" ? (
    <>
      <Link href="/admin" className={buttonClass("accent")}>
        Admin console
      </Link>
      {logout}
    </>
  ) : loggedIn ? (
    // Logged in, but the role could not be read: /dashboard works it out on the server.
    <>
      <Link href="/dashboard" className={buttonClass("accent")}>
        Dashboard
      </Link>
      {logout}
    </>
  ) : (
    <>
      <Link href={LOGIN_HREF} className={buttonClass("onDark")}>
        Log in
      </Link>
      <a href={LIST_PROJECT_HREF} className={buttonClass("accent")}>
        List your project
      </a>
    </>
  );

  return (
    <>
      <div
        className={`hidden items-center gap-3 transition-opacity md:flex ${ready ? "opacity-100" : "opacity-0"}`}
      >
        {actions}
      </div>

      <button
        type="button"
        className="inline-flex size-10 items-center justify-center rounded-lg text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 md:hidden"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <Menu className="size-6" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="bg-navy-900 absolute inset-x-0 top-full border-t border-white/10 px-4 pb-5 shadow-xl md:hidden"
        >
          <nav aria-label="Mobile" className="flex flex-col py-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-base font-medium text-white hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-2 flex flex-col gap-3">{actions}</div>
        </div>
      )}
    </>
  );
}
