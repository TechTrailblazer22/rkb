import { Field, inputClass } from "@/components/ui/field";

export const FACING_OPTIONS = [
  { value: "NORTH", label: "North" },
  { value: "SOUTH", label: "South" },
  { value: "EAST", label: "East" },
  { value: "WEST", label: "West" },
  { value: "NORTH_EAST", label: "North-East" },
  { value: "NORTH_WEST", label: "North-West" },
  { value: "SOUTH_EAST", label: "South-East" },
  { value: "SOUTH_WEST", label: "South-West" },
];

export type PlotDefaults = {
  number?: string;
  sizeSqft?: number | null;
  dimensions?: string | null;
  facing?: string | null;
  isCorner?: boolean;
  roadWidthFt?: number | null;
  ratePerSqft?: number | null;
  price?: number | null;
  status?: string;
  phase?: string | null;
  unitType?: string | null;
  builtUpSqft?: number | null;
};

const v = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** The fields of one plot or unit, shared by the "add" and "edit" forms. `prefix` keeps ids unique. */
export function PlotFields({ prefix, defaults = {} }: { prefix: string; defaults?: PlotDefaults }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={id("number")} label="Plot number" required>
          <input
            id={id("number")}
            name="number"
            required
            maxLength={20}
            defaultValue={v(defaults.number)}
            className={inputClass}
            placeholder="A-12"
          />
        </Field>
        <Field id={id("sizeSqft")} label="Size (sq ft)" required>
          <input
            id={id("sizeSqft")}
            name="sizeSqft"
            required
            inputMode="numeric"
            defaultValue={v(defaults.sizeSqft)}
            className={inputClass}
            placeholder="1200"
          />
        </Field>
        <Field id={id("dimensions")} label="Dimensions">
          <input
            id={id("dimensions")}
            name="dimensions"
            defaultValue={v(defaults.dimensions)}
            className={inputClass}
            placeholder="30x40"
          />
        </Field>
        <Field id={id("facing")} label="Facing">
          <select
            id={id("facing")}
            name="facing"
            defaultValue={v(defaults.facing)}
            className={inputClass}
          >
            <option value="">Not set</option>
            {FACING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("ratePerSqft")} label="Rate per sq ft (₹)">
          <input
            id={id("ratePerSqft")}
            name="ratePerSqft"
            inputMode="numeric"
            defaultValue={v(defaults.ratePerSqft)}
            className={inputClass}
            placeholder="1850"
          />
        </Field>
        <Field id={id("price")} label="Total price (₹)" hint="Leave empty to use rate × size.">
          <input
            id={id("price")}
            name="price"
            inputMode="numeric"
            defaultValue={v(defaults.price)}
            className={inputClass}
          />
        </Field>
        <Field id={id("status")} label="Status">
          <select
            id={id("status")}
            name="status"
            defaultValue={defaults.status ?? "AVAILABLE"}
            className={inputClass}
          >
            <option value="AVAILABLE">Available</option>
            <option value="BOOKED">Booked</option>
            <option value="SOLD">Sold</option>
          </select>
        </Field>
        <div className="flex items-end pb-2.5">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              name="corner"
              defaultChecked={defaults.isCorner ?? false}
              className="size-4 accent-teal-700"
            />
            Corner plot
          </label>
        </div>
      </div>

      <details className="rounded-lg border border-slate-200 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">More details</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id={id("roadWidthFt")} label="Road width (ft)">
            <input
              id={id("roadWidthFt")}
              name="roadWidthFt"
              inputMode="numeric"
              defaultValue={v(defaults.roadWidthFt)}
              className={inputClass}
            />
          </Field>
          <Field id={id("phase")} label="Phase or block">
            <input
              id={id("phase")}
              name="phase"
              maxLength={40}
              defaultValue={v(defaults.phase)}
              className={inputClass}
            />
          </Field>
          <Field
            id={id("unitType")}
            label="Unit type"
            hint="For built units, such as 2 BHK or Shop."
          >
            <input
              id={id("unitType")}
              name="unitType"
              maxLength={40}
              defaultValue={v(defaults.unitType)}
              className={inputClass}
            />
          </Field>
          <Field id={id("builtUpSqft")} label="Built-up area (sq ft)">
            <input
              id={id("builtUpSqft")}
              name="builtUpSqft"
              inputMode="numeric"
              defaultValue={v(defaults.builtUpSqft)}
              className={inputClass}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}
