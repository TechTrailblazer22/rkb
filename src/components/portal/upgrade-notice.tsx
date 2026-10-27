import Link from "next/link";
import { Lock } from "lucide-react";
import { PLAN_LABELS } from "@/lib/plans";
import type { PlanCode } from "@/generated/prisma/enums";

/** Shown in place of a feature the company's plan does not include. Says which plan unlocks it. */
export function UpgradeNotice({
  feature,
  plan,
  lapsed = false,
  className = "",
}: {
  feature: string;
  plan: PlanCode | null;
  /** True when the company has no plan in force at all, rather than a smaller one. */
  lapsed?: boolean;
  className?: string;
}) {
  return (
    <div
      role="note"
      data-testid="upgrade-notice"
      className={`flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm ${className}`}
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
      <p className="text-slate-800">
        <strong>{feature}</strong>{" "}
        {lapsed || !plan
          ? "needs an active plan."
          : `is part of the ${PLAN_LABELS[plan]} plan and above.`}{" "}
        <Link href="/portal/billing" className="font-semibold text-teal-800 underline">
          See plans
        </Link>
      </p>
    </div>
  );
}
