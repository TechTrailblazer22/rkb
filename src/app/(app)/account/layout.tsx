import { PortalTabs } from "@/components/portal/portal-tabs";
import { requireUser } from "@/lib/auth/session";
import { bookingConfig } from "@/lib/booking/config";

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
          { href: "/account/enquiries", label: "My enquiries" },
          { href: "/account/shortlist", label: "Saved projects" },
          ...(bookingConfig().enabled ? [{ href: "/account/bookings", label: "My bookings" }] : []),
          { href: "/account/privacy", label: "My data" },
        ]}
      />
      {children}
    </div>
  );
}
