import { BuilderStatusBadge } from "@/components/portal/status-badge";
import { PortalTabs } from "@/components/portal/portal-tabs";
import { requireBuilderContext } from "@/lib/builders/context";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const { builder, checklist } = await requireBuilderContext("/portal");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{builder.companyName ?? "Your company"}</h1>
        <BuilderStatusBadge status={builder.status} />
      </div>

      <PortalTabs
        tabs={[
          { href: "/portal", label: "Overview" },
          { href: "/portal/profile", label: "Company profile", done: checklist.profile.done },
          { href: "/portal/documents", label: "Documents", done: checklist.documents.done },
          { href: "/portal/plan", label: "Plan", done: checklist.plan.done },
          {
            href: "/portal/review",
            label: "Review and submit",
            done: builder.status !== "DRAFT" && builder.status !== "CHANGES_REQUESTED",
          },
        ]}
      />

      {children}
    </div>
  );
}
