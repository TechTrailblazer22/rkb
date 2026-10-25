"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

export type PortalTab = { href: string; label: string; done?: boolean };

// Steps of the application, with a tick once each is complete. Scrolls sideways on phones.
export function PortalTabs({ tabs }: { tabs: PortalTab[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Application steps" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const active =
            tab.href === "/portal" ? pathname === "/portal" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap ${
                  active
                    ? "border-teal-700 text-teal-700"
                    : "hover:text-navy-900 border-transparent text-slate-600"
                }`}
              >
                {tab.done && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-teal-500 text-white">
                    <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                    <span className="sr-only">Complete</span>
                  </span>
                )}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
