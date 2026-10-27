import type { LeadStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { buyerStatusLabel, leadStatusLabel } from "@/lib/leads/status";

const TONE = {
  NEW: "amber",
  CONTACTED: "teal",
  SITE_VISIT: "navy",
  NEGOTIATION: "navy",
  BOOKED: "teal",
  LOST: "neutral",
} as const;

/** A lead's status as a badge. The buyer sees friendlier words than the builder does. */
export function LeadStatusBadge({
  status,
  audience = "builder",
}: {
  status: LeadStatus;
  audience?: "builder" | "buyer";
}) {
  return (
    <Badge tone={TONE[status]}>
      {audience === "buyer" ? buyerStatusLabel[status] : leadStatusLabel[status]}
    </Badge>
  );
}
