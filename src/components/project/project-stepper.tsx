"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

export type StepperItem = { slug: string; label: string; done: boolean };
export type ExtraLink = { slug: string; label: string };

/**
 * The wizard's steps. A vertical list beside the form on large screens; a row you can scroll
 * sideways, with a "Step 3 of 10" bar above it, on a phone.
 */
export function ProjectStepper({
  projectId,
  steps,
  extras = [],
}: {
  projectId: string;
  steps: StepperItem[];
  /** Pages beside the wizard (the layout map, progress updates), listed after the steps. */
  extras?: ExtraLink[];
}) {
  const pathname = usePathname();
  const found = steps.findIndex(
    (step) => pathname === `/portal/projects/${projectId}/${step.slug}`,
  );
  // On one of the extra pages no wizard step is current.
  const onStep = found >= 0;
  const current = Math.max(0, found);

  return (
    <nav aria-label="Project steps">
      <div className="mb-3 lg:hidden" hidden={!onStep}>
        <p className="text-sm font-semibold">
          Step {current + 1} of {steps.length}: {steps[current].label}
        </p>
        <div className="bg-surface mt-2 h-1.5 overflow-hidden rounded-full" aria-hidden="true">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${((current + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <ol className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {steps.map((step, index) => {
          const active = onStep && index === current;
          return (
            <li key={step.slug} className="shrink-0 lg:shrink">
              <Link
                href={`/portal/projects/${projectId}/${step.slug}`}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold whitespace-nowrap ${
                  active ? "bg-navy-900 text-white" : "hover:bg-surface text-slate-700"
                }`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                    step.done
                      ? "bg-teal-500 text-white"
                      : active
                        ? "bg-white/20 text-white"
                        : "bg-surface text-slate-600"
                  }`}
                >
                  {step.done ? (
                    <>
                      <Check className="size-3.5" strokeWidth={3.5} aria-hidden="true" />
                      <span className="sr-only">Complete: </span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                {step.label}
              </Link>
            </li>
          );
        })}
      </ol>
      {extras.length > 0 && (
        <ul
          aria-label="More for this project"
          className="-mx-4 mt-2 flex gap-1 overflow-x-auto border-slate-200 px-4 pb-2 lg:mx-0 lg:mt-4 lg:flex-col lg:overflow-visible lg:border-t lg:px-0 lg:pt-3 lg:pb-0"
        >
          {extras.map((extra) => {
            const href = `/portal/projects/${projectId}/${extra.slug}`;
            const active = pathname === href;
            return (
              <li key={extra.slug} className="shrink-0 lg:shrink">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center rounded-lg px-3 py-2.5 text-sm font-semibold whitespace-nowrap ${
                    active ? "bg-navy-900 text-white" : "hover:bg-surface text-slate-700"
                  }`}
                >
                  {extra.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
