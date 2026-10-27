import { BuilderStatusBadge } from "@/components/portal/status-badge";
import { PortalTabs, type PortalTab } from "@/components/portal/portal-tabs";
import { bookingConfig } from "@/lib/booking/config";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { leadSummary } from "@/lib/leads/service";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const { builder, checklist, memberRole } = await requireBuilderContext("/portal");
  const leads = await leadSummary(getDb(), builder.id);
  const owner = memberRole === "OWNER";
  const verified = builder.status === "VERIFIED";

  // A teammate works on projects and leads. The company's own details, billing and team are the
  // owner's, so those tabs are not shown to anyone else (and their pages send them back).
  const tabs: PortalTab[] = [
    { href: "/portal", label: "Overview" },
    { href: "/portal/projects", label: "Projects" },
    { href: "/portal/leads", label: "Leads", badge: leads.unseen },
  ];
  if (verified) {
    tabs.push({ href: "/portal/analytics", label: "Analytics" });
    tabs.push({ href: "/portal/reviews", label: "Reviews" });
    if (bookingConfig().enabled) tabs.push({ href: "/portal/bookings", label: "Bookings" });
  }
  if (verified && memberRole !== "STAFF") tabs.push({ href: "/portal/promote", label: "Promote" });
  if (owner) {
    if (verified) tabs.push({ href: "/portal/team", label: "Team" });
    tabs.push(
      { href: "/portal/profile", label: "Company profile", done: checklist.profile.done },
      { href: "/portal/documents", label: "Documents", done: checklist.documents.done },
      verified
        ? { href: "/portal/billing", label: "Plan and billing" }
        : { href: "/portal/plan", label: "Plan", done: checklist.plan.done },
      {
        href: "/portal/review",
        label: "Review and submit",
        done: builder.status !== "DRAFT" && builder.status !== "CHANGES_REQUESTED",
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{builder.companyName ?? "Your company"}</h1>
        <BuilderStatusBadge status={builder.status} />
      </div>

      <PortalTabs tabs={tabs} />

      {children}
    </div>
  );
}
