import Link from "next/link";
import type { Mode } from "@/lib/auth/mode";
import { getSessionAccount, getSessionUser } from "@/lib/auth/session";
import { ModeSwitch } from "@/components/site/mode-switch";
import { ModeSync } from "@/components/site/mode-sync";
import { buttonClass } from "@/components/ui/button";

// Everything under this group is per-user, so it is always rendered per request.
export const dynamic = "force-dynamic";

// The header inside the logged-in areas says which account is in use and offers the links that
// belong to it, and nothing from the other side: a buyer is not shown builder links and a builder is
// not shown buyer links. It only changes what is shown; each page still checks the role itself.
const SHELLS: Record<
  Mode,
  { label: string; badge: string; links: { href: string; label: string }[] }
> = {
  buyer: {
    label: "Buyer account",
    badge: "bg-teal-500/20 text-teal-50",
    links: [
      { href: "/projects", label: "Browse projects" },
      { href: "/account/enquiries", label: "Enquiries" },
      { href: "/account/shortlist", label: "Saved" },
      { href: "/account", label: "My account" },
    ],
  },
  builder: {
    label: "Builder account",
    badge: "bg-amber-500/20 text-amber-100",
    links: [{ href: "/portal", label: "Portal" }],
  },
  admin: {
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
  const account = user ? await getSessionAccount() : null;
  const shell = account ? SHELLS[account.mode] : null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50">
      {account && <ModeSync mode={account.mode} />}
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
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
          <nav aria-label="Account" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
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
                {account && (
                  <ModeSwitch
                    mode={account.mode}
                    canBuild={account.canBuild}
                    className={`${buttonClass("onDark")} !px-3 !py-1.5 !text-xs`}
                  />
                )}
                <span className="hidden max-w-40 truncate text-white/70 lg:inline">
                  {user.name ?? user.email}
                </span>
                {/* plain <a>: /logout clears the remembered account, then hands over to Auth0 */}
                <a href="/logout" className={buttonClass("secondary")}>
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
