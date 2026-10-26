import Link from "next/link";
import { X } from "lucide-react";
import { AMENITIES } from "@/lib/projects/amenities";
import { PROJECT_STAGES, PROJECT_TYPES } from "@/lib/projects/fields";
import { budgetLabel, sizeLabel } from "@/lib/search/options";
import { filtersToParams, type SearchFilters } from "@/lib/search/params";

type Chip = { label: string; remove: Partial<SearchFilters> };

function chipsFor(filters: SearchFilters, fixed: Set<keyof SearchFilters>): Chip[] {
  const chips: Chip[] = [];
  if (filters.q) chips.push({ label: `“${filters.q}”`, remove: { q: "" } });
  if (!fixed.has("types")) {
    for (const type of filters.types)
      chips.push({
        label: PROJECT_TYPES.find((t) => t.value === type)?.label ?? type,
        remove: { types: filters.types.filter((t) => t !== type) },
      });
  }
  for (const stage of filters.stages)
    chips.push({
      label: PROJECT_STAGES.find((s) => s.value === stage)?.label ?? stage,
      remove: { stages: filters.stages.filter((s) => s !== stage) },
    });

  if (filters.budgetMin !== null || filters.budgetMax !== null) {
    const from = filters.budgetMin !== null ? budgetLabel(filters.budgetMin) : null;
    const to = filters.budgetMax !== null ? budgetLabel(filters.budgetMax) : null;
    chips.push({
      label: from && to ? `${from} to ${to}` : from ? `From ${from}` : `Up to ${to}`,
      remove: { budgetMin: null, budgetMax: null },
    });
  }
  if (filters.sizeMin !== null || filters.sizeMax !== null) {
    const from = filters.sizeMin !== null ? sizeLabel(filters.sizeMin) : null;
    const to = filters.sizeMax !== null ? sizeLabel(filters.sizeMax) : null;
    chips.push({
      label: from && to ? `${from} to ${to}` : from ? `From ${from}` : `Up to ${to}`,
      remove: { sizeMin: null, sizeMax: null },
    });
  }
  for (const facing of filters.facings)
    chips.push({
      label: `${facing.replace("_", "-").toLowerCase()} facing`.replace(/^./, (c) =>
        c.toUpperCase(),
      ),
      remove: { facings: filters.facings.filter((f) => f !== facing) },
    });
  for (const approval of filters.approvals)
    chips.push({
      label: approval === "MUNICIPAL" ? "Municipal" : approval,
      remove: { approvals: filters.approvals.filter((a) => a !== approval) },
    });
  if (filters.verifiedApprovals)
    chips.push({ label: "Verified approvals", remove: { verifiedApprovals: false } });
  for (const code of filters.amenities)
    chips.push({
      label: AMENITIES.find((a) => a.code === code)?.label ?? code,
      remove: { amenities: filters.amenities.filter((a) => a !== code) },
    });
  return chips;
}

/** The filters in use, each with a button that removes just that one and keeps the rest. */
export function FilterChips({
  filters,
  basePath,
  fixed = [],
}: {
  filters: SearchFilters;
  basePath: string;
  fixed?: (keyof SearchFilters)[];
}) {
  const fixedSet = new Set(fixed);
  const chips = chipsFor(filters, fixedSet);
  if (chips.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Filters in use">
      {chips.map((chip) => {
        const next = { ...filters, ...chip.remove, page: 1 };
        const query = filtersToParams(next, [...fixedSet]).toString();
        return (
          <li key={chip.label}>
            <Link
              href={`${basePath}${query ? `?${query}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100"
            >
              {chip.label}
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Remove this filter</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
