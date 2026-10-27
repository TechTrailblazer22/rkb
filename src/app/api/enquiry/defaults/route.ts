import { getApiUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// What the enquiry form fills in for a logged-in buyer: their name and the mobile number they gave
// last time. Only their own, only in the buyer account.
export async function GET() {
  const auth = await getApiUser();
  if (auth.status !== "ok" || auth.user.role !== "BUYER") {
    return Response.json(
      { name: "", mobile: "" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const user = await getDb().user.findUnique({
    where: { id: auth.user.id },
    select: { name: true, mobile: true },
  });
  return Response.json(
    { name: user?.name ?? "", mobile: user?.mobile ?? "" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
