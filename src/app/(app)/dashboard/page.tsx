import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { landingFor, parseIntent } from "@/lib/auth/intent";

// Single "go to my area" link used by the header and after every login. `?as=buyer|builder` is
// the door chosen on /login; it only picks where to send the person (see landingFor), and
// anything else in the address is ignored.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const intent = parseIntent((await searchParams).as);
  const returnTo = intent ? `/dashboard?as=${intent}` : "/dashboard";
  const user = await requireUser({ returnTo });
  redirect(landingFor(user.role, intent));
}
