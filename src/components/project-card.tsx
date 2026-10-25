import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge, VerifiedBadge } from "@/components/ui/badge";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { formatRupees, formatRupeesCompact } from "@/lib/format";
import type { SampleProject } from "@/lib/sample-projects";

const typeTone: Record<SampleProject["type"], string> = {
  Plotted: "from-navy-900 to-navy-700",
  "Farm house": "from-teal-700 to-navy-800",
  Residential: "from-navy-800 to-slate-plot",
  Commercial: "from-navy-900 to-slate-plot",
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

// `href` is where the card leads. Until the marketplace ships (Phase 5) samples point at
// the "opening soon" page.
export function ProjectCard({
  project,
  href = "/projects",
}: {
  project: SampleProject;
  href?: string;
}) {
  const availablePercent = Math.round((project.availablePlots / project.totalPlots) * 100);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-lg">
      <Link
        href={href}
        className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <div className={`bg-gradient-to-br p-5 pt-12 ${typeTone[project.type]}`}>
          <PlotGridArt
            seed={project.artSeed}
            cols={10}
            rows={4}
            availableRatio={project.availablePlots / project.totalPlots}
            className="gap-1 opacity-95"
          />
        </div>
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <Badge tone="amber">Sample listing</Badge>
          <Badge tone="navy">{project.stage}</Badge>
        </div>
        <span className="sr-only">View {project.name}</span>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">
          {project.type}
        </p>
        <h3 className="text-navy-900 mt-1 text-lg font-bold">{project.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          {project.locality}, {project.city}
        </p>

        <div className="mt-4">
          <p className="text-navy-900 text-xl font-bold">
            {formatRupeesCompact(project.priceFrom)} to {formatRupeesCompact(project.priceTo)}
          </p>
          <p className="text-sm text-slate-600">
            {formatRupees(project.pricePerSqft)} per sq ft · {project.sizeRange}
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs font-semibold">
            <span className="text-navy-900">
              {project.availablePlots} of {project.totalPlots} available
            </span>
            <span className="text-slate-500">{availablePercent}%</span>
          </div>
          <div
            className="bg-surface mt-1.5 h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Share of plots still available"
            aria-valuenow={availablePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${availablePercent}%` }}
            />
          </div>
        </div>

        <ul className="mt-4 mb-5 flex flex-wrap gap-1.5">
          {project.approvals.map((approval) => (
            <li key={approval}>
              <Badge>{approval}</Badge>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center gap-3 border-t border-slate-100 pt-4">
          <span
            className="bg-navy-900 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-amber-500"
            aria-hidden="true"
          >
            {initials(project.builder.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{project.builder.name}</p>
            {project.builder.verified ? (
              <VerifiedBadge />
            ) : (
              <span className="text-xs text-slate-500">Verification pending</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
