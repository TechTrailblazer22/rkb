import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Browse verified plotted, farm house, residential and commercial projects. Opening soon.",
};

// Placeholder until the marketplace search ships (Phase 5). Search links already point here,
// so they will start working without any change on the home page.
export default function ProjectsPage() {
  return (
    <section className="py-16 sm:py-24">
      <Container className="max-w-2xl text-center">
        <PlotGridArt live cols={12} rows={3} className="mx-auto max-w-sm" />
        <h1 className="mt-10 text-3xl font-extrabold tracking-tight sm:text-4xl">
          The project marketplace opens soon
        </h1>
        <div className="mx-auto mt-4 h-1.5 w-12 rounded-full bg-amber-500" />
        <p className="mt-5 text-lg text-slate-600">
          We are onboarding verified builders right now. Their projects, with live plot
          availability, will appear here as they go live.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={LIST_PROJECT_HREF} className={buttonClass("primary", "lg")}>
            I&apos;m a builder, list my project
          </a>
          <Link href="/" className={buttonClass("secondary", "lg")}>
            Back to home
          </Link>
        </div>
      </Container>
    </section>
  );
}
