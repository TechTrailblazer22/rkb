import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/ui/logo";
import { HeaderControls } from "@/components/site/header-controls";
import { NAV_LINKS } from "@/components/site/nav-links";

export function SiteHeader() {
  return (
    <header className="bg-navy-900 sticky top-0 z-40 border-b border-white/10 text-white">
      <Container className="relative flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-10">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-for={link.for}
                className="rounded-lg px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <HeaderControls />
      </Container>
    </header>
  );
}
