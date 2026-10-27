"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { addInterval, planSubtotalPaise } from "@/lib/billing/money";
import { assignSubscription } from "@/lib/billing/subscriptions";
import { getDb } from "@/lib/db";
import { revalidateProjectPages } from "@/lib/projects/revalidate";

const schema = z.object({
  builderId: z.string().min(1),
  plan: z.enum(["STARTER", "GROWTH", "PREMIER"]),
  interval: z.enum(["MONTHLY", "ANNUAL"]),
  periods: z.coerce.number().int().min(1).max(24),
  kind: z.enum(["paid", "comp"]),
  // Rupees, before GST. Empty means the list price.
  amount: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().min(0).max(1_000_000).optional(),
  ),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
});

function back(builderId: string, params: Record<string, string>): never {
  redirect(`/admin/builders/${builderId}?${new URLSearchParams(params).toString()}`);
}

/**
 * Staff put a company on a plan: either one the company paid for outside the website (a bank
 * transfer, with an invoice), or a complimentary one. Online payments, when switched on, go through
 * the same function.
 */
export async function assignPlan(formData: FormData) {
  const admin = await requireUser({ returnTo: "/admin", roles: ["ADMIN"] });
  const raw = Object.fromEntries(
    ["builderId", "plan", "interval", "periods", "kind", "amount", "reference", "note"].map((k) => [
      k,
      formData.get(k) ?? undefined,
    ]),
  );
  const parsed = schema.safeParse(raw);
  const builderId = typeof raw.builderId === "string" ? raw.builderId : "";
  if (!parsed.success) {
    back(builderId, { error: "Check the plan, the number of periods (1 to 24) and the amount." });
  }
  const input = parsed.data;

  const db = getDb();
  const builder = await db.builder.findUnique({
    where: { id: input.builderId },
    select: { id: true },
  });
  if (!builder) redirect("/admin/builders");

  const now = new Date();
  const subtotalPaise =
    input.amount !== undefined
      ? Math.round(input.amount * 100)
      : planSubtotalPaise(input.plan, input.interval) * input.periods;
  const paid = input.kind === "paid" && subtotalPaise > 0;

  const result = await assignSubscription(db, {
    builderId: input.builderId,
    plan: input.plan,
    interval: input.interval,
    source: paid ? "MANUAL" : "COMP",
    periodStart: now,
    periodEnd: addInterval(now, input.interval, input.periods),
    note: input.note || null,
    invoice: paid
      ? {
          subtotalPaise,
          paymentMethod: "manual",
          paymentReference: input.reference || null,
        }
      : undefined,
    actorId: admin.id,
  });

  for (const projectId of result.resumedProjectIds) await revalidateProjectPages(db, projectId);
  revalidatePath(`/admin/builders/${input.builderId}`);
  back(input.builderId, {
    saved: result.invoice
      ? `Plan set. Invoice ${result.invoice.number} issued.`
      : result.resumedProjectIds.length > 0
        ? `Plan set. ${result.resumedProjectIds.length} project(s) went live again.`
        : "Plan set.",
  });
}
