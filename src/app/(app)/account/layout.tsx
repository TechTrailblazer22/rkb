import { PortalTabs } from "@/components/portal/portal-tabs";
import { requireUser } from "@/lib/auth/session";

// The buyer area. Builders and the admin are sent to their own areas by requireUser.
export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  await requireUser({ returnTo: "/account", roles: ["BUYER"] });

  return (
    <div className="space-y-6">
      <PortalTabs
        root="/account"
        label="Your account"
        tabs={[
          { href: "/account", label: "Overview" },
          { href: "/account/shortlist", label: "Saved projects" },
        ]}
      />
      {children}
    </div>
  );
}
