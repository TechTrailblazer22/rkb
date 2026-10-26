import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { AMENITIES } from "@/lib/projects/amenities";
import { PROJECT_STAGES, PROJECT_TYPES } from "@/lib/projects/fields";
import {
  BUDGET_STEPS,
  SIZE_STEPS,
  budgetLabel,
  sizeLabel,
  withCurrent,
} from "@/lib/search/options";
import {
  APPROVAL_SLUGS,
  FACING_SLUGS,
  STAGE_SLUGS,
  TYPE_SLUGS,
  activeFilterCount,
  type SearchFilters,
} from "@/lib/search/params";

const FACING_LABELS: Record<string, string> = {
  NORTH: "North",
  SOUTH: "South",
  EAST: "East",
  WEST: "West",
  NORTH_EAST: "North-East",
  NORTH_WEST: "North-West",
  SOUTH_EAST: "South-East",
  SOUTH_WEST: "South-West",
};
const APPROVAL_LABELS: Record<string, string> = {
  RERA: "RERA registered",
  TNCP: "TNCP / DTCP approved",
  MUNICIPAL: "Municipal approved",
};
const FEATURED_AMENITIES = [
  "park",
  "gym",
  "swimming_pool",
  "security",
  "street_lights",
  "drainage",
  "clubhouse",
  "ev_charging",
];

/**
 * One block of filters that folds away. Open by default for the filters people use most, and
 * always open while it holds a choice, so an active filter is never hidden. The checkboxes stay in
 * the form when folded, and keep their fieldset and legend for screen readers.
 */
function Group({
  legend,
  children,
  open = false,
  selected = 0,
}: {
  legend: string;
  children: React.ReactNode;
  open?: boolean;
  selected?: number;
}) {
  return (
    <details open={open || selected > 0} className="group border-t border-slate-200 pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded py-1 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 [&::-webkit-details-marker]:hidden">
        <span>
          {legend}
          {selected > 0 && (
            <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
              {selected}
            </span>
          )}
        </span>
        <ChevronDown
          className="size-4 text-slate-600 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <fieldset className="pt-2">
        <legend className="sr-only">{legend}</legend>
        {children}
      </fieldset>
    </details>
  );
}

function Check({
  name,
  value,
  label,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-4 accent-teal-700"
      />
      {label}
    </label>
  );
}

/**
 * Every filter as plain HTML in a GET form: it works without JavaScript, and the result is an
 * ordinary address that can be shared. On a phone the form opens and closes with a CSS-only toggle.
 * `fixed` lists filters the page itself decides (for example the city), which are not shown.
 */
export function FiltersForm({
  filters,
  action,
  fixed = [],
}: {
  filters: SearchFilters;
  action: string;
  fixed?: (keyof SearchFilters)[];
}) {
  const hidden = new Set(fixed);
  const count = activeFilterCount(filters, fixed);
  const amenityChoices = AMENITIES.filter((a) => FEATURED_AMENITIES.includes(a.code));
  const moreAmenities = AMENITIES.filter((a) => !FEATURED_AMENITIES.includes(a.code));
  const budgets = [
    withCurrent(BUDGET_STEPS, filters.budgetMin),
    withCurrent(BUDGET_STEPS, filters.budgetMax),
  ];
  const sizes = [
    withCurrent(SIZE_STEPS, filters.sizeMin),
    withCurrent(SIZE_STEPS, filters.sizeMax),
  ];

  return (
    <div>
      <input
        id="filters-toggle"
        type="checkbox"
        className="peer sr-only"
        aria-label="Show or hide filters"
      />
      <label
        htmlFor="filters-toggle"
        className={`${buttonClass("secondary")} w-full cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 lg:hidden`}
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filters{count > 0 ? ` (${count})` : ""}
      </label>

      <form
        method="get"
        action={action}
        aria-label="Filter projects"
        className="mt-4 hidden space-y-4 rounded-2xl border border-slate-200 bg-white p-5 peer-checked:block lg:mt-0 lg:block"
      >
        <div>
          <label htmlFor="f-q" className="mb-1.5 block text-sm font-bold">
            Search
          </label>
          <input
            id="f-q"
            name="q"
            defaultValue={filters.q}
            maxLength={80}
            placeholder="Project, locality or builder"
            className={inputClass}
          />
        </div>

        {!hidden.has("types") && (
          <Group legend="Type" open selected={filters.types.length}>
            {PROJECT_TYPES.map((t) => (
              <Check
                key={t.value}
                name="type"
                value={TYPE_SLUGS[t.value]}
                label={t.label}
                checked={filters.types.includes(t.value)}
              />
            ))}
          </Group>
        )}

        <Group legend="Stage" selected={filters.stages.length}>
          {PROJECT_STAGES.map((s) => (
            <Check
              key={s.value}
              name="stage"
              value={STAGE_SLUGS[s.value]}
              label={s.label}
              checked={filters.stages.includes(s.value)}
            />
          ))}
        </Group>

        <Group
          legend="Budget"
          open
          selected={Number(filters.budgetMin !== null) + Number(filters.budgetMax !== null)}
        >
          <div className="grid grid-cols-2 gap-2">
            {(["min", "max"] as const).map((key, i) => (
              <label key={key} className="block text-xs text-slate-600">
                {key === "min" ? "From" : "To"}
                <select
                  name={key}
                  defaultValue={String((i === 0 ? filters.budgetMin : filters.budgetMax) ?? "")}
                  className={`${inputClass} mt-1`}
                >
                  <option value="">{key === "min" ? "No min" : "No max"}</option>
                  {budgets[i].map((v) => (
                    <option key={v} value={v}>
                      {budgetLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Group>

        <Group
          legend="Plot size"
          selected={Number(filters.sizeMin !== null) + Number(filters.sizeMax !== null)}
        >
          <div className="grid grid-cols-2 gap-2">
            {(["smin", "smax"] as const).map((key, i) => (
              <label key={key} className="block text-xs text-slate-600">
                {key === "smin" ? "From" : "To"}
                <select
                  name={key}
                  defaultValue={String((i === 0 ? filters.sizeMin : filters.sizeMax) ?? "")}
                  className={`${inputClass} mt-1`}
                >
                  <option value="">{key === "smin" ? "No min" : "No max"}</option>
                  {sizes[i].map((v) => (
                    <option key={v} value={v}>
                      {sizeLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Group>

        <Group legend="Facing (plots still available)" selected={filters.facings.length}>
          <div className="grid grid-cols-2 gap-x-2">
            {Object.entries(FACING_SLUGS).map(([key, slug]) => (
              <Check
                key={key}
                name="facing"
                value={slug}
                label={FACING_LABELS[key]}
                checked={filters.facings.includes(key as keyof typeof FACING_SLUGS)}
              />
            ))}
          </div>
        </Group>

        <Group
          legend="Approvals"
          selected={filters.approvals.length + Number(filters.verifiedApprovals)}
        >
          {(Object.keys(APPROVAL_SLUGS) as (keyof typeof APPROVAL_SLUGS)[]).map((kind) => (
            <Check
              key={kind}
              name="approval"
              value={APPROVAL_SLUGS[kind]}
              label={APPROVAL_LABELS[kind]}
              checked={filters.approvals.includes(kind)}
            />
          ))}
          <Check
            name="verified"
            value="1"
            label="Only approvals verified by RKB"
            checked={filters.verifiedApprovals}
          />
        </Group>

        <Group legend="Amenities" selected={filters.amenities.length}>
          {amenityChoices.map((a) => (
            <Check
              key={a.code}
              name="amenity"
              value={a.code}
              label={a.label}
              checked={filters.amenities.includes(a.code)}
            />
          ))}
          <details className="mt-1">
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">
              More amenities
            </summary>
            {moreAmenities.map((a) => (
              <Check
                key={a.code}
                name="amenity"
                value={a.code}
                label={a.label}
                checked={filters.amenities.includes(a.code)}
              />
            ))}
          </details>
        </Group>

        {filters.sort !== "newest" && <input type="hidden" name="sort" value={filters.sort} />}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <button type="submit" className={buttonClass("primary")}>
            Show results
          </button>
          {count > 0 && (
            <Link href={action} className="text-sm font-semibold text-teal-700 underline">
              Clear all
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
