import { MapPin, Search } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

const TYPES = [
  { value: "plots", label: "Plots" },
  { value: "farm-houses", label: "Farm houses" },
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
];

const BUDGETS = [
  { value: "", label: "Any budget" },
  { value: "0-2500000", label: "Under ₹25 L" },
  { value: "2500000-5000000", label: "₹25 L to ₹50 L" },
  { value: "5000000-10000000", label: "₹50 L to ₹1 Cr" },
  { value: "10000000-", label: "Above ₹1 Cr" },
];

// A plain GET form: works without JavaScript, and the URL is shareable. The /projects page
// reads these same parameters once the marketplace ships.
export function SearchCard() {
  return (
    <form
      action="/projects"
      method="get"
      className="text-navy-900 rounded-2xl bg-white p-4 shadow-2xl shadow-black/20 sm:p-5"
    >
      <fieldset>
        <legend className="sr-only">Property type</legend>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((type, index) => (
            <label key={type.value} className="relative">
              <input
                type="radio"
                name="type"
                value={type.value}
                defaultChecked={index === 0}
                className="peer sr-only"
              />
              <span className="block cursor-pointer rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 peer-checked:border-teal-700 peer-checked:bg-teal-700 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 peer-focus-visible:ring-offset-2">
                {type.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <span className="sr-only">City or locality</span>
            <MapPin
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              name="q"
              placeholder="City or locality"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 py-3 pr-3 pl-10 text-sm placeholder:text-slate-500 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/30 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="sr-only">Budget</span>
            <select
              name="budget"
              defaultValue=""
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm focus:border-teal-700 focus:ring-2 focus:ring-teal-700/30 focus:outline-none"
            >
              {BUDGETS.map((budget) => (
                <option key={budget.value} value={budget.value}>
                  {budget.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}>
          <Search className="size-5" aria-hidden="true" />
          Search
        </button>
      </div>
    </form>
  );
}
