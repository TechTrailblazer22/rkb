import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button";

// Everything under this group is per-user, so it is always rendered per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="rounded-lg bg-teal-500 px-2 py-1 text-sm">RKB</span>
            <span className="hidden text-sm font-medium text-white/80 sm:inline">Platform</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            {user ? (
              <>
                <Link href="/dashboard" className="hover:text-amber-500">
                  Dashboard
                </Link>
                <span className="hidden max-w-40 truncate text-white/70 sm:inline">
                  {user.name ?? user.email}
                </span>
                {/* plain <a>: the Auth0 SDK needs a full navigation, not client routing */}
                <a href="/auth/logout" className={buttonClass("secondary")}>
                  Log out
                </a>
              </>
            ) : (
              <a href="/auth/login" className={buttonClass("secondary")}>
                Log in
              </a>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
