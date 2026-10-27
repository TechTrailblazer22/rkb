"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

// A Razorpay Route linked account looks like acc_ followed by letters and digits.
const ACCOUNT = /^acc_[A-Za-z0-9]{6,30}$/;

/** Staff connect (or disconnect) the account that receives a company's online token payments. */
export async function setPayoutAccount(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });
  const builderId = String(formData.get("builderId") ?? "");
  const raw = String(formData.get("payoutAccountId") ?? "").trim();
  const back = (params: Record<string, string>): never =>
    redirect(`/admin/builders/${builderId}?${new URLSearchParams(params).toString()}`);
  if (raw && !ACCOUNT.test(raw)) {
    back({ error: "A payout account looks like acc_ followed by letters and digits." });
  }

  const changed = await getDb().builder.updateMany({
    where: { id: builderId },
    data: { payoutAccountId: raw || null },
  });
  if (changed.count !== 1) redirect("/admin/builders");
  await recordAudit(getDb(), {
    actorId: admin.id,
    action: raw ? "builder.payout_connected" : "builder.payout_removed",
    entity: "Builder",
    entityId: builderId,
    meta: raw ? { payoutAccountId: raw } : undefined,
  });
  revalidatePath(`/admin/builders/${builderId}`);
  back({ saved: raw ? "Payout account connected." : "Payout account removed." });
}
