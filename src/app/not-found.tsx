import Link from "next/link";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export const metadata = { title: "Page not found", robots: { index: false } };

// Shown for any address that does not exist, and wherever a page calls notFound() (a project that is
// no longer public, someone else's booking, an unknown invoice). It says nothing about why.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="py-20 text-center">
          <p className="text-sm font-semibold tracking-wide text-teal-700 uppercase">Error 404</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            We could not find that page
          </h1>
          <p className="mx-auto mt-3 max-w-md text-slate-600">
            The link may be old, or the project may no longer be listed. Try searching for what you
            were looking for.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/projects" className={buttonClass("primary", "lg")}>
              Browse projects
            </Link>
            <Link href="/" className={buttonClass("secondary", "lg")}>
              Go to the home page
            </Link>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
