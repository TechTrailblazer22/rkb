import type { Invoice, PrismaClient, Prisma, Subscription } from "@/generated/prisma/client";
import type { BillingInterval, PlanCode, SubscriptionSource } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { computeGst, financialYear, formatInvoiceNumber } from "@/lib/billing/money";
import { PLAN_LABELS } from "@/lib/plans";

// Plans and invoices. Our database is the source of truth for who is on which plan until when; a
// payment gateway only collects money (see docs/ROADMAP-7-10.md). Everything here works in a
// transaction so a plan and its invoice always appear together.

export type Supplier = {
  name: string;
  gstin: string;
  state: string;
  address: string;
  /** Services Accounting Code. Confirm the right one with your CA. */
  sac: string;
};

export function supplierFromEnv(env: Record<string, string | undefined> = process.env): Supplier {
  return {
    name: env.BILLING_SUPPLIER_NAME || "RKB Platform",
    gstin: env.BILLING_SUPPLIER_GSTIN || "",
    state: env.BILLING_SUPPLIER_STATE || "Tamil Nadu",
    address: env.BILLING_SUPPLIER_ADDRESS || "",
    sac: env.INVOICE_SAC || "998439",
  };
}

type Tx = Prisma.TransactionClient;

/** The next invoice number for the financial year. Atomic: two payments at once never share one. */
async function nextInvoiceNumber(tx: Tx, at: Date): Promise<string> {
  const fy = financialYear(at);
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "InvoiceCounter" ("fy", "last") VALUES (${fy}, 1)
    ON CONFLICT ("fy") DO UPDATE SET "last" = "InvoiceCounter"."last" + 1
    RETURNING "last"`;
  return formatInvoiceNumber(fy, rows[0].last);
}

export type BillTo = {
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
};

export type InvoiceInput = {
  subtotalPaise: number;
  paymentMethod: "razorpay" | "test" | "manual" | "comp";
  paymentReference: string | null;
  description?: string;
};

/** Writes the invoice for a payment inside the caller's transaction. */
export async function issueInvoice(
  tx: Tx,
  input: {
    builderId: string;
    subscriptionId: string | null;
    plan: PlanCode;
    interval: BillingInterval;
    periodStart: Date;
    periodEnd: Date;
    invoice: InvoiceInput;
    supplier: Supplier;
    now: Date;
  },
): Promise<Invoice> {
  const builder = await tx.builder.findUniqueOrThrow({
    where: { id: input.builderId },
    select: {
      companyName: true,
      gstin: true,
      addressLine: true,
      city: true,
      state: true,
      pincode: true,
    },
  });
  const billTo: BillTo = {
    name: builder.companyName ?? "Builder",
    gstin: builder.gstin,
    address: builder.addressLine,
    city: builder.city,
    state: builder.state,
    pincode: builder.pincode,
  };
  const gst = computeGst({
    subtotalPaise: input.invoice.subtotalPaise,
    supplierState: input.supplier.state,
    customerState: builder.state,
  });
  return tx.invoice.create({
    data: {
      number: await nextInvoiceNumber(tx, input.now),
      builderId: input.builderId,
      subscriptionId: input.subscriptionId,
      description:
        input.invoice.description ??
        `RKB Platform ${PLAN_LABELS[input.plan]} plan, ${input.interval === "ANNUAL" ? "annual" : "monthly"}`,
      plan: input.plan,
      interval: input.interval,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      subtotalPaise: input.invoice.subtotalPaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      totalPaise: gst.totalPaise,
      status: "PAID",
      paymentMethod: input.invoice.paymentMethod,
      paymentReference: input.invoice.paymentReference,
      billTo: billTo as unknown as Prisma.InputJsonValue,
      supplier: input.supplier as unknown as Prisma.InputJsonValue,
      sac: input.supplier.sac,
      issuedAt: input.now,
      paidAt: input.now,
    },
  });
}

export type AssignResult = {
  subscription: Subscription;
  invoice: Invoice | null;
  /** Projects that went live again because the plan came back. */
  resumedProjectIds: string[];
};

export type AssignInput = {
  builderId: string;
  plan: PlanCode;
  interval: BillingInterval;
  source: SubscriptionSource;
  periodStart?: Date;
  periodEnd: Date;
  note?: string | null;
  invoice?: InvoiceInput;
  /** What was paid for the period, before GST. Defaults to the invoice's amount (0 for none). */
  paidSubtotalPaise?: number;
  actorId: string | null;
  supplier?: Supplier;
  now?: Date;
};

/**
 * The write itself, inside the caller's transaction, so a payment can be marked paid and the plan
 * set in one atomic step. Replaces any earlier subscription of the company, clears a scheduled
 * downgrade or cancellation, optionally issues the invoice.
 */
export async function applyAssignment(
  tx: Tx,
  input: AssignInput,
): Promise<{ subscription: Subscription; invoice: Invoice | null }> {
  const now = input.now ?? new Date();
  const periodStart = input.periodStart ?? now;
  if (input.periodEnd.getTime() <= periodStart.getTime()) {
    throw new Error("The plan's end must be after its start.");
  }
  const data = {
    plan: input.plan,
    interval: input.interval,
    status: "ACTIVE" as const,
    source: input.source,
    currentPeriodStart: periodStart,
    currentPeriodEnd: input.periodEnd,
    pendingPlan: null,
    pendingInterval: null,
    cancelAtPeriodEnd: false,
    lastReminderDays: null,
    paidSubtotalPaise: input.paidSubtotalPaise ?? input.invoice?.subtotalPaise ?? 0,
    note: input.note ?? null,
  };
  const saved = await tx.subscription.upsert({
    where: { builderId: input.builderId },
    create: { builderId: input.builderId, ...data },
    update: data,
  });
  const issued = input.invoice
    ? await issueInvoice(tx, {
        builderId: input.builderId,
        subscriptionId: saved.id,
        plan: input.plan,
        interval: input.interval,
        periodStart,
        periodEnd: input.periodEnd,
        invoice: input.invoice,
        supplier: input.supplier ?? supplierFromEnv(),
        now,
      })
    : null;
  await recordAudit(tx, {
    actorId: input.actorId,
    action: "subscription.assigned",
    entity: "Builder",
    entityId: input.builderId,
    meta: {
      plan: input.plan,
      interval: input.interval,
      source: input.source,
      periodEnd: input.periodEnd.toISOString(),
      ...(issued ? { invoice: issued.number } : {}),
    },
  });
  return { subscription: saved, invoice: issued };
}

/**
 * Puts a company on a plan for a period. Used by the admin's manual billing and by every settled
 * payment. Also brings back any project that was paused only because the plan had ended.
 */
export async function assignSubscription(
  db: PrismaClient,
  input: AssignInput,
): Promise<AssignResult> {
  const { subscription, invoice } = await db.$transaction((tx) => applyAssignment(tx, input));
  const resumedProjectIds = await resumeLapsedProjects(db, input.builderId, input.actorId);
  return { subscription, invoice, resumedProjectIds };
}

/** Brings back the projects that were paused only because the plan had ended. */
export async function resumeLapsedProjects(
  db: PrismaClient,
  builderId: string,
  actorId: string | null,
): Promise<string[]> {
  const paused = await db.project.findMany({
    where: {
      builderId,
      status: "PAUSED",
      pauseReason: "PLAN_LAPSED",
      builder: { status: "VERIFIED" },
    },
    select: { id: true },
  });
  const ids: string[] = [];
  for (const { id } of paused) {
    const won = await db.project.updateMany({
      where: { id, status: "PAUSED", pauseReason: "PLAN_LAPSED" },
      data: { status: "LIVE", pauseReason: null, reviewNote: null },
    });
    if (won.count !== 1) continue;
    ids.push(id);
    await recordAudit(db, {
      actorId,
      action: "project.resumed_plan_back",
      entity: "Project",
      entityId: id,
    });
  }
  return ids;
}
