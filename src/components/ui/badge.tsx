import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";

type Tone = "neutral" | "teal" | "amber" | "navy";

const tones: Record<Tone, string> = {
  neutral: "bg-surface text-navy-900",
  teal: "bg-teal-50 text-teal-800",
  amber: "bg-amber-50 text-amber-700",
  navy: "bg-navy-900 text-white",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <Badge tone="teal">
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      Verified builder
    </Badge>
  );
}
