"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { parseIndianDateTime } from "@/lib/leads/input";
import { addBuilderNote, setFollowUp, setLeadStatus, setVisitStatus } from "@/lib/leads/service";
import { parseLeadStatus, parseVisitStatus } from "@/lib/leads/status";

// Every action finds the company from the logged-in user (never from the form), and the service
// only touches leads that belong to it. A lead id from another company simply does nothing and
// shows "not found".

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function back(leadId: string, message: { saved?: string; error?: string }): never {
  const query = new URLSearchParams(message as Record<string, string>).toString();
  redirect(`/portal/leads/${leadId}?${query}`);
}

async function context(formData: FormData) {
  const leadId = text(formData, "leadId");
  const ctx = await requireBuilderContext(`/portal/leads/${leadId}`);
  return { leadId, ctx, actor: { id: ctx.user.id, name: ctx.user.name } };
}

export async function changeLeadStatus(formData: FormData) {
  const { leadId, ctx, actor } = await context(formData);
  const status = parseLeadStatus(text(formData, "status"));
  if (!status) back(leadId, { error: "Choose a status." });
  const ok = await setLeadStatus(getDb(), { builderId: ctx.builder.id, leadId, status, actor });
  if (!ok) back(leadId, { error: "That enquiry was not found." });
  revalidatePath("/portal/leads");
  back(leadId, { saved: "Status updated." });
}

export async function addLeadNote(formData: FormData) {
  const { leadId, ctx, actor } = await context(formData);
  const note = text(formData, "text");
  if (!note.trim()) back(leadId, { error: "Write a note first." });
  const ok = await addBuilderNote(getDb(), {
    builderId: ctx.builder.id,
    leadId,
    text: note,
    actor,
  });
  if (!ok) back(leadId, { error: "That enquiry was not found." });
  back(leadId, { saved: "Note added." });
}

export async function changeFollowUp(formData: FormData) {
  const { leadId, ctx } = await context(formData);
  if (ctx.entitlements.leads !== "full") {
    back(leadId, { error: "Follow-up dates are part of the Growth plan and above." });
  }
  const raw = text(formData, "followUpAt").trim();
  let followUpAt: Date | null = null;
  if (raw) {
    followUpAt = parseIndianDateTime(raw);
    if (!followUpAt) back(leadId, { error: "Choose a valid date and time." });
  }
  const ok = await setFollowUp(getDb(), { builderId: ctx.builder.id, leadId, followUpAt });
  if (!ok) back(leadId, { error: "That enquiry was not found." });
  revalidatePath("/portal/leads");
  back(leadId, { saved: followUpAt ? "Follow-up date saved." : "Follow-up date cleared." });
}

export async function changeVisitStatus(formData: FormData) {
  const { leadId, ctx } = await context(formData);
  if (ctx.entitlements.leads !== "full") {
    back(leadId, { error: "Tracking site visits is part of the Growth plan and above." });
  }
  const status = parseVisitStatus(text(formData, "status"));
  if (!status) back(leadId, { error: "Choose what happened to the visit." });
  const ok = await setVisitStatus(getDb(), {
    builderId: ctx.builder.id,
    leadId,
    visitId: text(formData, "visitId"),
    status,
  });
  if (!ok) back(leadId, { error: "That visit was not found." });
  back(leadId, { saved: "Visit updated." });
}
