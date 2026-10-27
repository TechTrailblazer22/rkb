import { Check } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { requireBuilderContext } from "@/lib/builders/context";
import { formatRupees } from "@/lib/format";
import { GST_PERCENT, plans } from "@/lib/plans";
import { choosePlan } from "../actions";

export const metadata = { title: "Choose a plan" };

export default async function PlanPage({ searchParams }: PageProps<"/portal/plan">) {
  const { builder, mode } = await requireBuilderContext("/portal/plan", { ownerOnly: true });
  const { error } = await searchParams;
  const locked = mode === "locked";

  return (
    <form action={choosePlan} className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Which plan suits you?</h2>
        <p className="mt-1 text-sm text-slate-600">
          This only tells us what you are interested in. <strong>No payment is taken now</strong>,
          and you can change your mind later. Prices are proposed launch prices, excluding{" "}
          {GST_PERCENT}% GST, with no commission on your sales.
        </p>
      </div>

      {error === "choose" && (
        <p role="alert" className="text-sm font-medium text-red-600">
          Please choose a plan to continue.
        </p>
      )}

      <fieldset disabled={locked} className="grid gap-5 lg:grid-cols-3">
        <legend className="sr-only">Plan</legend>
        {plans.map((plan) => (
          <label key={plan.code} className="relative block cursor-pointer">
            <input
              type="radio"
              name="plan"
              value={plan.code}
              defaultChecked={builder.interestedPlan === plan.code}
              className="peer sr-only"
            />
            <span className="flex h-full flex-col rounded-2xl border-2 border-slate-200 bg-white p-6 transition peer-checked:border-teal-700 peer-checked:bg-teal-50/40 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-60">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold">{plan.name}</span>
                {plan.highlighted && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    Popular
                  </span>
                )}
              </span>
              <span className="text-sm text-slate-600">{plan.audience}</span>
              <span className="mt-3 text-3xl font-extrabold">
                {formatRupees(plan.priceMonthly)}
                <span className="text-base font-medium text-slate-500"> /month</span>
              </span>
              <span className="mt-4 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <span key={feature} className="flex items-start gap-2">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-teal-700"
                      aria-hidden="true"
                      strokeWidth={3}
                    />
                    {feature}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {!locked && (
        <button type="submit" className={buttonClass("primary", "lg")}>
          Save and continue
        </button>
      )}
    </form>
  );
}
