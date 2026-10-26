import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { getSessionRole, getSessionUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";

// Everything under this group is per-user, so it is always rendered per request.
export const dynamic = "force-dynamic";

// The header inside the logged-in areas says which kind of account this is and offers the links
// that matter for it. It only changes what is shown; each page still checks the role itself.
const SHELLS: Record<
  Role,
  { label: string; badge: string; links: { href: string; label: string }[] }
> = {
  BUYER: {
    label: "Buyer account",
    badge: "bg-teal-500/20 text-teal-50",
    links: [
      { href: "/projects", label: "Browse projects" },
      { href: "/account/shortlist", label: "Saved" },
      { href: "/account", label: "My account" },
    ],
  },
  BUILDER_OWNER: {
    label: "Builder account",
    badge: "bg-amber-500/20 text-amber-100",
    links: [
      { href: "/portal", label: "Portal" },
      { href: "/projects", label: "Marketplace" },
    ],
  },
  BUILDER_TEAM: {
    label: "Builder account",
    badge: "bg-amber-500/20 text-amber-100",
    links: [
      { href: "/portal", label: "Portal" },
      { href: "/projects", label: "Marketplace" },
    ],
  },
  ADMIN: {
    label: "Admin",
    badge: "bg-white/15 text-white",
    links: [
      { href: "/admin", label: "Console" },
      { href: "/projects", label: "Marketplace" },
    ],
  },
};

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  const role = user ? await getSessionRole() : null;
  const shell = role ? SHELLS[role] : null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-bold">
              <span className="rounded-lg bg-teal-500 px-2 py-1 text-sm">RKB</span>
              <span className="hidden text-sm font-medium text-white/80 sm:inline">Platform</span>
            </Link>
            {shell && (
              <span
                data-testid="account-kind"
                className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${shell.badge}`}
              >
                {shell.label}
              </span>
            )}
          </div>
          <nav aria-label="Account" className="flex items-center gap-3 text-sm">
            {user ? (
              <>
                {shell ? (
                  shell.links.map((link) => (
                    <Link key={link.href} href={link.href} className="hover:text-amber-500">
                      {link.label}
                    </Link>
                  ))
                ) : (
                  <Link href="/dashboard" className="hover:text-amber-500">
                    Dashboard
                  </Link>
                )}
                <span className="hidden max-w-40 truncate text-white/70 lg:inline">
                  {user.name ?? user.email}
                </span>
                {/* plain <a>: the Auth0 SDK needs a full navigation, not client routing */}
                <a href="/auth/logout" className={buttonClass("secondary")}>
                  Log out
                </a>
              </>
            ) : (
              <Link href="/login" className={buttonClass("secondary")}>
                Log in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
