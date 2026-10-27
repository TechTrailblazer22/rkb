import Link from "next/link";

const LINKS = [
  { key: "overview", href: "/admin", label: "Overview" },
  { key: "builders", href: "/admin/builders", label: "Builders" },
  { key: "projects", href: "/admin/projects", label: "Projects" },
  { key: "reviews", href: "/admin/reviews", label: "Reviews" },
  { key: "billing", href: "/admin/billing", label: "Billing" },
] as const;

export function AdminNav({ current }: { current: (typeof LINKS)[number]["key"] }) {
  return (
    <nav
      aria-label="Admin sections"
      className="-mx-4 -mt-2 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
    >
      {LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap ${
            link.key === current
              ? "border-teal-700 text-teal-700"
              : "hover:text-navy-900 border-transparent text-slate-600"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
