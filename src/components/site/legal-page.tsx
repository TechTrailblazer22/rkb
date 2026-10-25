import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { TERMS_VERSION } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <div className="mt-3 h-1.5 w-12 rounded-full bg-amber-500" />
      <p className="mt-4 text-sm text-slate-500">Version {TERMS_VERSION}</p>

      <p
        role="note"
        className="mt-6 rounded-xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-700"
      >
        <strong>Draft for legal review.</strong> This text explains how the platform is intended to
        work. Items in [square brackets] must be completed, and the whole page reviewed by a lawyer,
        before launch.
      </p>

      <div className="[&_h2]:text-navy-900 mt-8 space-y-8 text-base leading-relaxed text-slate-700 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
        {children}
      </div>
    </Container>
  );
}
