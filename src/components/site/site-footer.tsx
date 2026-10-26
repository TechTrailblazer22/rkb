import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";

// `for` marks links that belong to one side only (see NAV_LINKS).
type FooterLink = { href: string; label: string; for?: "buyer" | "builder" };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Platform",
    links: [
      { href: "/projects", label: "Projects", for: "buyer" },
      { href: "/for-builders", label: "For builders", for: "builder" },
      { href: "/pricing", label: "Pricing", for: "builder" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of use" },
      { href: "/privacy", label: "Privacy notice" },
      { href: "/disclaimer", label: "Disclaimer" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-navy-900 text-white">
      <Container className="py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-white/70">
              A digital showroom where verified builders list projects, show live plot availability
              and receive buyer enquiries directly.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-sm font-semibold text-amber-500">{column.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href} data-for={link.for}>
                    <Link href={link.href} className="text-sm text-white/75 hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/60">
          <p>
            RKB Platform is a listing and booking facilitation service. Builders are responsible for
            the accuracy of their information and approvals. Nothing on this site is legal advice.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} RKB Platform</p>
        </div>
      </Container>
    </footer>
  );
}
