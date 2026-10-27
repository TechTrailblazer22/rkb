import type { Lead, PrismaClient, Prisma } from "@/generated/prisma/client";
import type { LeadStatus, VisitStatus } from "@/generated/prisma/enums";
import { recordStat } from "@/lib/analytics/stats";
import type { ExportLead } from "@/lib/leads/csv";
import type { EnquiryFields } from "@/lib/leads/input";
import { OPEN_STATUSES, leadStatusLabel } from "@/lib/leads/status";

// Everything that reads or changes enquiries. No Next.js imports, so it can be tested against a real
// Postgres. Rules that matter are listed in docs/LEADS.md.

/** A buyer may send this many new enquiries or follow-up messages in 24 hours. */
export const ENQUIRY_DAILY_LIMIT = 5;
export const LEADS_PAGE_SIZE = 20;
const DAY_MS = 86_400_000;

/** Everyone at a company who should be told about enquiries and reminders. */
export async function builderRecipients(db: PrismaClient, builderId: string): Promise<string[]> {
  const members = await db.builderMember.findMany({
    where: { builderId },
    select: { user: { select: { email: true } } },
  });
  return members.map((member) => member.user.email);
}

// ---------------------------------------------------------------------------------------
// the buyer's side

export type EnquiryResult =
  | {
      ok: true;
      lead: Lead;
      /** True when this was added to an enquiry the buyer already had open on the project. */
      repeat: boolean;
      projectName: string;
      companyName: string | null;
      /** Everyone at the builder who should be told. */
      recipients: string[];
    }
  | { ok: false; code: "not_found" | "own_project" | "rate_limited"; message: string };

/**
 * Records a buyer's enquiry about a project. The project must be public (live, and its builder
 * verified): an enquiry can never reveal or reach anything else. A second message while the first
 * enquiry is still open is added to it rather than creating a duplicate.
 */
export async function createEnquiry(
  db: PrismaClient,
  input: {
    buyer: { id: string; email: string; name: string | null };
    projectId: string;
    fields: EnquiryFields;
    termsVersion: string;
    /** Where the enquiry came from; defaults to the project page. */
    source?: string;
    now?: Date;
  },
): Promise<EnquiryResult> {
  const { buyer, fields } = input;
  const now = input.now ?? new Date();

  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      status: "LIVE",
      slug: { not: null },
      builder: { status: "VERIFIED" },
    },
    select: { id: true, name: true, builderId: true, builder: { select: { companyName: true } } },
  });
  if (!project) {
    return {
      ok: false,
      code: "not_found",
      message: "This project is not available for enquiries.",
    };
  }

  const isMember = await db.builderMember.findFirst({
    where: { builderId: project.builderId, userId: buyer.id },
    select: { id: true },
  });
  if (isMember) {
    return { ok: false, code: "own_project", message: "This is your own project." };
  }

  // Spam limit: new enquiries plus follow-up messages, per buyer, in the last 24 hours.
  const since = new Date(now.getTime() - DAY_MS);
  const [newLeads, messages] = await Promise.all([
    db.lead.count({ where: { buyerId: buyer.id, createdAt: { gte: since } } }),
    db.leadNote.count({
      where: { kind: "BUYER", lead: { buyerId: buyer.id }, createdAt: { gte: since } },
    }),
  ]);
  if (newLeads + messages >= ENQUIRY_DAILY_LIMIT) {
    return {
      ok: false,
      code: "rate_limited",
      message: "You have sent several enquiries today. Please try again tomorrow.",
    };
  }

  const open = await db.lead.findFirst({
    where: { buyerId: buyer.id, projectId: project.id, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });

  const lead = await db.$transaction(async (tx) => {
    let saved: Lead;
    let repeat = false;
    if (open) {
      repeat = true;
      saved = await tx.lead.update({
        where: { id: open.id },
        data: {
          name: fields.name,
          mobile: fields.mobile,
          lastBuyerMessageAt: now,
          seenAt: null,
          ...(input.source ? { source: input.source } : {}),
          ...(fields.preferredPlot ? { preferredPlot: fields.preferredPlot } : {}),
        },
      });
      await tx.leadNote.create({
        data: {
          leadId: open.id,
          authorId: buyer.id,
          kind: "BUYER",
          text: fields.message ?? "The buyer sent another enquiry without a message.",
          createdAt: now,
        },
      });
    } else {
      saved = await tx.lead.create({
        data: {
          projectId: project.id,
          builderId: project.builderId,
          buyerId: buyer.id,
          name: fields.name,
          mobile: fields.mobile,
          email: buyer.email,
          message: fields.message,
          preferredPlot: fields.preferredPlot,
          ...(input.source ? { source: input.source } : {}),
          consentAt: now,
          consentTermsVersion: input.termsVersion,
          lastBuyerMessageAt: now,
          createdAt: now,
        },
      });
    }
    if (fields.visitAt) {
      await tx.siteVisit.create({ data: { leadId: saved.id, scheduledAt: fields.visitAt } });
    }
    // Remember the buyer's number and name so the form is filled in next time.
    await tx.user.update({
      where: { id: buyer.id },
      data: { mobile: fields.mobile, ...(buyer.name ? {} : { name: fields.name }) },
    });
    return { saved, repeat };
  });

  // Page analytics: one enquiry, and a visit request if there was one. Never allowed to fail the enquiry.
  await recordStat(db, { projectId: project.id, event: "ENQUIRY" }).catch(() => {});
  if (fields.visitAt)
    await recordStat(db, { projectId: project.id, event: "VISIT" }).catch(() => {});

  return {
    ok: true,
    lead: lead.saved,
    repeat: lead.repeat,
    projectName: project.name,
    companyName: project.builder.companyName,
    recipients: await builderRecipients(db, project.builderId),
  };
}

export type BuyerEnquiry = {
  id: string;
  status: LeadStatus;
  createdAt: Date;
  lastBuyerMessageAt: Date;
  preferredPlot: string | null;
  project: { name: string; slug: string | null; city: string | null; isPublic: boolean };
  builderName: string | null;
  builderId: string;
  canReview: boolean;
  nextVisit: { scheduledAt: Date; status: VisitStatus } | null;
};

/** A buyer's own enquiries, newest first. Never includes the builder's notes. */
export async function listBuyerEnquiries(
  db: PrismaClient,
  buyerId: string,
): Promise<BuyerEnquiry[]> {
  const leads = await db.lead.findMany({
    where: { buyerId },
    orderBy: { lastBuyerMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      builderId: true,
      status: true,
      createdAt: true,
      lastBuyerMessageAt: true,
      preferredPlot: true,
      project: { select: { name: true, slug: true, city: true, status: true } },
      builder: { select: { companyName: true, status: true } },
      visits: {
        where: { status: { in: ["REQUESTED", "CONFIRMED"] } },
        orderBy: { scheduledAt: "asc" },
        take: 1,
        select: { scheduledAt: true, status: true },
      },
    },
  });
  return leads.map((lead) => ({
    id: lead.id,
    status: lead.status,
    createdAt: lead.createdAt,
    lastBuyerMessageAt: lead.lastBuyerMessageAt,
    preferredPlot: lead.preferredPlot,
    project: {
      name: lead.project.name,
      slug: lead.project.slug,
      city: lead.project.city,
      // A link is only offered while the project can still be opened by anyone.
      isPublic: lead.project.status === "LIVE" && lead.builder.status === "VERIFIED",
    },
    builderName: lead.builder.companyName,
    builderId: lead.builderId,
    // Reviews are written for companies that can be seen publicly.
    canReview: lead.builder.status === "VERIFIED",
    nextVisit: lead.visits[0] ?? null,
  }));
}

// ---------------------------------------------------------------------------------------
// the builder's side. Every function takes the builder's id, found from the logged-in user's
// membership, and filters by it, so a lead of another company is simply "not found".

export type LeadFilters = {
  status?: LeadStatus | null;
  projectId?: string | null;
  q?: string;
  /** Only open leads whose follow-up date has arrived. */
  due?: boolean;
  page?: number;
};

function leadWhere(builderId: string, filters: LeadFilters, now: Date): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { builderId };
  if (filters.status) where.status = filters.status;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.due) {
    where.status = { in: [...OPEN_STATUSES] };
    where.followUpAt = { lte: now };
  }
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q.replace(/\D/g, "") || "no-match" } },
      { email: { contains: q, mode: "insensitive" } },
      { project: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function listLeads(
  db: PrismaClient,
  builderId: string,
  filters: LeadFilters = {},
  now: Date = new Date(),
) {
  const where = leadWhere(builderId, filters, now);
  const page = Math.max(1, filters.page ?? 1);
  const [rows, total, byStatus] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { lastBuyerMessageAt: "desc" },
      skip: (page - 1) * LEADS_PAGE_SIZE,
      take: LEADS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        mobile: true,
        status: true,
        preferredPlot: true,
        source: true,
        followUpAt: true,
        lastBuyerMessageAt: true,
        createdAt: true,
        seenAt: true,
        project: { select: { id: true, name: true } },
        visits: {
          where: { status: { in: ["REQUESTED", "CONFIRMED"] } },
          take: 1,
          select: { id: true },
        },
      },
    }),
    db.lead.count({ where }),
    db.lead.groupBy({ by: ["status"], where: { builderId }, _count: { _all: true } }),
  ]);
  const counts: Record<LeadStatus, number> = {
    NEW: 0,
    CONTACTED: 0,
    SITE_VISIT: 0,
    NEGOTIATION: 0,
    BOOKED: 0,
    LOST: 0,
  };
  for (const row of byStatus) counts[row.status] = row._count._all;
  return { rows, total, counts, page, pages: Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE)) };
}

/** What the portal's tab and dashboard show: how many are new, and how many follow-ups are due. */
export async function leadSummary(db: PrismaClient, builderId: string, now: Date = new Date()) {
  const [newCount, dueCount, unseen] = await Promise.all([
    db.lead.count({ where: { builderId, status: "NEW" } }),
    db.lead.count({
      where: { builderId, status: { in: [...OPEN_STATUSES] }, followUpAt: { lte: now } },
    }),
    db.lead.count({ where: { builderId, seenAt: null } }),
  ]);
  return { new: newCount, followUpsDue: dueCount, unseen };
}

export async function getLeadForBuilder(db: PrismaClient, builderId: string, leadId: string) {
  return db.lead.findFirst({
    where: { id: leadId, builderId },
    include: {
      project: { select: { id: true, name: true, slug: true, city: true, locality: true } },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      visits: { orderBy: { scheduledAt: "asc" } },
    },
  });
}

/** Marks the lead as seen by the builder. Harmless if it was already. */
export async function markLeadSeen(db: PrismaClient, builderId: string, leadId: string) {
  await db.lead.updateMany({
    where: { id: leadId, builderId, seenAt: null },
    data: { seenAt: new Date() },
  });
}

type Actor = { id: string; name: string | null };

export async function setLeadStatus(
  db: PrismaClient,
  input: { builderId: string; leadId: string; status: LeadStatus; actor: Actor },
): Promise<boolean> {
  const lead = await db.lead.findFirst({
    where: { id: input.leadId, builderId: input.builderId },
    select: { status: true },
  });
  if (!lead) return false;
  if (lead.status === input.status) return true;
  await db.$transaction([
    db.lead.update({
      where: { id: input.leadId },
      data: { status: input.status, seenAt: new Date() },
    }),
    db.leadNote.create({
      data: {
        leadId: input.leadId,
        authorId: input.actor.id,
        kind: "SYSTEM",
        text: `Status changed from ${leadStatusLabel[lead.status]} to ${leadStatusLabel[input.status]}.`,
      },
    }),
  ]);
  return true;
}

export async function addBuilderNote(
  db: PrismaClient,
  input: { builderId: string; leadId: string; text: string; actor: Actor },
): Promise<boolean> {
  const text = input.text.trim().slice(0, 2000);
  if (!text) return false;
  const lead = await db.lead.findFirst({
    where: { id: input.leadId, builderId: input.builderId },
    select: { id: true },
  });
  if (!lead) return false;
  await db.leadNote.create({
    data: { leadId: lead.id, authorId: input.actor.id, kind: "BUILDER", text },
  });
  return true;
}

/** Sets, changes or clears the follow-up date. A new date makes the reminder fire again. */
export async function setFollowUp(
  db: PrismaClient,
  input: { builderId: string; leadId: string; followUpAt: Date | null },
): Promise<boolean> {
  const changed = await db.lead.updateMany({
    where: { id: input.leadId, builderId: input.builderId },
    data: { followUpAt: input.followUpAt, reminderSentAt: null },
  });
  return changed.count === 1;
}

export async function setVisitStatus(
  db: PrismaClient,
  input: { builderId: string; leadId: string; visitId: string; status: VisitStatus },
): Promise<boolean> {
  const changed = await db.siteVisit.updateMany({
    where: { id: input.visitId, leadId: input.leadId, lead: { builderId: input.builderId } },
    data: { status: input.status },
  });
  return changed.count === 1;
}

/** The leads to export, newest first, capped so one click cannot build an enormous file. */
export async function leadsForExport(
  db: PrismaClient,
  builderId: string,
  filters: LeadFilters = {},
  now: Date = new Date(),
): Promise<ExportLead[]> {
  const rows = await db.lead.findMany({
    where: leadWhere(builderId, filters, now),
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      createdAt: true,
      name: true,
      mobile: true,
      mobileVerified: true,
      email: true,
      preferredPlot: true,
      message: true,
      status: true,
      followUpAt: true,
      project: { select: { name: true } },
    },
  });
  return rows.map(({ project, ...lead }) => ({ ...lead, projectName: project.name }));
}
