import { Building2, Home, LandPlot, Store, Trees, type LucideIcon } from "lucide-react";

const TYPE_ICON: Record<string, LucideIcon> = {
  PLOTTED: LandPlot,
  FARM_HOUSE: Trees,
  RESIDENTIAL: Home,
  COMMERCIAL: Store,
  MIXED_USE: Building2,
};

const TYPE_TONE: Record<string, string> = {
  PLOTTED: "from-navy-900 to-navy-700",
  FARM_HOUSE: "from-teal-800 to-navy-800",
  RESIDENTIAL: "from-navy-800 to-slate-plot",
  COMMERCIAL: "from-navy-900 to-slate-plot",
  MIXED_USE: "from-navy-900 to-teal-800",
};

/**
 * What a project shows while the builder has not added photos. It says so plainly and draws
 * nothing that looks like real data (no invented plot map). One place, used by cards and the
 * project page.
 */
export function MediaPlaceholder({
  type,
  compact = false,
}: {
  /** The project type key (PLOTTED, FARM_HOUSE, ...). Picks the icon and the colour. */
  type: string;
  compact?: boolean;
}) {
  const Icon = TYPE_ICON[type] ?? Building2;
  return (
    <div
      className={`flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br text-white/80 ${TYPE_TONE[type] ?? TYPE_TONE.PLOTTED}`}
    >
      <Icon className={compact ? "size-8" : "size-10"} strokeWidth={1.5} aria-hidden="true" />
      <p className="text-xs font-medium">Photos coming soon</p>
    </div>
  );
}
