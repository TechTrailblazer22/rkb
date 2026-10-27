"use server";

import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { parseEnquiry } from "@/lib/leads/input";
import { createEnquiry } from "@/lib/leads/service";
import { TERMS_VERSION } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { enquirySentMail, newLeadMail } from "@/lib/mail/templates";

export type EnquiryState =
  | null
  | { ok: true; repeat: boolean; projectName: string }
  | {
      ok: false;
      message?: string;
      errors?: Record<string, string>;
    };

/**
 * A buyer sends an enquiry about a project. Only a logged-in buyer can; the project must be public;
 * the details are checked here, not just in the form; and the builder is emailed after it is saved.
 */
export async function submitEnquiry(
  slug: string,
  _previous: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const buyer = await requireUser({ returnTo: `/project/${slug}?enquire=1`, roles: ["BUYER"] });

  const parsed = parseEnquiry(Object.fromEntries(formData));
  if (!parsed.ok) {
    // A bot that filled in the hidden field is told it worked, and nothing is saved.
    if (parsed.spam) return { ok: true, repeat: false, projectName: "this project" };
    return {
      ok: false,
      errors: parsed.errors,
      message: "Please check the highlighted fields.",
    };
  }

  const projectId = formData.get("projectId");
  if (typeof projectId !== "string" || !projectId) {
    return { ok: false, message: "This project is not available for enquiries." };
  }

  const db = getDb();
  const result = await createEnquiry(db, {
    buyer: { id: buyer.id, email: buyer.email, name: buyer.name },
    projectId,
    fields: parsed.value,
    termsVersion: TERMS_VERSION,
    // A request to book a plot (when online booking is not on) is shown to the builder as such.
    source: formData.get("intent") === "booking" ? "booking_request" : undefined,
  });
  if (!result.ok) return { ok: false, message: result.message };

  // After the enquiry is saved. Mail is best-effort and never throws.
  await sendMail({
    to: result.recipients,
    ...newLeadMail({
      leadId: result.lead.id,
      projectName: result.projectName,
      companyName: result.companyName,
      buyerName: parsed.value.name,
      mobile: parsed.value.mobile,
      email: buyer.email,
      message: parsed.value.message,
      preferredPlot: parsed.value.preferredPlot,
      visitAt: parsed.value.visitAt,
      repeat: result.repeat,
    }),
  });
  if (!result.repeat) {
    await sendMail({
      to: buyer.email,
      ...enquirySentMail({ projectName: result.projectName, companyName: result.companyName }),
    });
  }
  return { ok: true, repeat: result.repeat, projectName: result.projectName };
}
