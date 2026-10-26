"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";
import { formatRupees } from "@/lib/format";
import {
  GST_PERCENT,
  annualPrice,
  annualSavings,
  effectiveMonthly,
  plans,
  type Plan,
} from "@/lib/plans";

type Interval = "monthly" | "annual";

const headerTone: Record<Plan["code"], string> = {
  STARTER: "bg-navy-900",
  GROWTH: "bg-teal-700",
  PREMIER: "bg-navy-700",
};

export function PricingPlans() {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <div>
      <div className="flex flex-col items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="bg-surface inline-flex rounded-full p-1"
        >
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={interval === value}
              onClick={() => setInterval(value)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                interval === value
                  ? "bg-navy-900 text-white shadow"
                  : "hover:text-navy-900 text-slate-600"
              }`}
            >
              {value === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-teal-700">
          Annual plan: pay for 10 months, get 12.
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const annual = interval === "annual";
          return (
            <div
              key={plan.code}
              className={`flex flex-col overflow-hidden rounded-2xl bg-white ${
                plan.highlighted
                  ? "border-2 border-amber-500 shadow-xl lg:-my-3"
                  : "border border-slate-200 shadow-sm"
              }`}
            >
              <div className={`px-6 py-5 text-center text-white ${headerTone[plan.code]}`}>
                <h2 className="text-xl font-bold">{plan.name}</h2>
                <p className="text-sm text-white">{plan.audience}</p>
              </div>

              <div className="flex flex-1 flex-col p-6">
                <div className="text-center">
                  <p className="text-4xl font-extrabold tracking-tight">
                    {formatRupees(annual ? annualPrice(plan.priceMonthly) : plan.priceMonthly)}
                    <span className="text-base font-medium text-slate-600">
                      {annual ? " /year" : " /month"}
                    </span>
                  </p>
                  <p className="mt-1 min-h-10 text-sm text-slate-600">
                    {annual ? (
                      <>
                        About {formatRupees(effectiveMonthly(plan.priceMonthly))} a month. You save{" "}
                        <span className="font-semibold text-teal-700">
                          {formatRupees(annualSavings(plan.priceMonthly))}
                        </span>
                        .
                      </>
                    ) : (
                      "Billed every month. Cancel any time."
                    )}
                  </p>
                  <p className="text-xs text-slate-600">+ {GST_PERCENT}% GST</p>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-teal-700"
                        aria-hidden="true"
                        strokeWidth={3}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <a
                  href={LIST_PROJECT_HREF}
                  className={`${buttonClass(plan.highlighted ? "accent" : "secondary", "lg")} mt-8 w-full`}
                >
                  Get started with {plan.name}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
