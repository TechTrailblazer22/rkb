import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";

// Single "go to my area" link used by the header and after login.
export default async function DashboardPage() {
  const user = await requireUser({ returnTo: "/dashboard" });
  redirect(homePathForRole(user.role));
}
