import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft, MessageCircle, Phone } from "lucide-react";
import { LeadStatusBadge } from "@/components/leads/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { formatDateTime, toInputValue } from "@/lib/leads/format";
import { getLeadForBuilder, markLeadSeen } from "@/lib/leads/service";
import {
  LEAD_STATUSES,
  VISIT_STATUSES,
  leadStatusLabel,
  visitStatusLabel,
} from "@/lib/leads/status";
import { whatsappLink } from "@/lib/mail/templates";
import { addLeadNote, changeFollowUp, changeLeadStatus, changeVisitStatus } from "../actions";

export const metadata = { title: "Lead" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LeadPage({ params, searchParams }: PageProps<"/portal/leads/[id]">) {
  const { id } = await params;
  const ctx = await requireBuilderContext(`/portal/leads/${id}`);
  const fullLeads = ctx.entitlements.leads === "full";
  const db = getDb();
  // Looked up through the company, so another company's lead is simply not found.
  const lead = await getLeadForBuilder(db, ctx.builder.id, id);
  if (!lead) notFound();
  await markLeadSeen(db, ctx.builder.id, id);

  const raw = await searchParams;
  const saved = first(raw.saved);
  const error = first(raw.error);
  const chat = whatsappLink(
    lead.mobile,
    `Hello ${lead.name}, this is ${ctx.builder.companyName ?? "the builder"} about ${lead.project.name}. Thank you for your enquiry.`,
  );

  return (
    <div className="space-y-6">
      <Link
        href="/portal/leads"
        className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> All leads
      </Link>

      {(saved || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`rounded-lg px-4 py-3 text-sm font-medium ${error ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-800"}`}
        >
          {error ?? saved}
        </p>
      )}

      <section
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
        data-testid="lead-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{lead.name}</h1>
            <p className="text-sm text-slate-600">
              About{" "}
              <Link
                href={`/portal/projects/${lead.project.id}/review`}
                className="font-semibold underline"
              >
                {lead.project.name}
              </Link>
              {lead.project.city ? `, ${lead.project.city}` : ""}
            </p>
          </div>
          <LeadStatusBadge status={lead.status} />
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">Mobile</dt>
            <dd className="flex flex-wrap items-center gap-2 font-semibold">
              {lead.mobile}
              {!lead.mobileVerified && <Badge tone="neutral">Not verified</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Email</dt>
            <dd className="font-semibold break-all">{lead.email}</dd>
          </div>
          {lead.preferredPlot && (
            <div>
              <dt className="text-slate-600">Plot</dt>
              <dd className="font-semibold">{lead.preferredPlot}</dd>
            </div>
          )}
          <div>
            <dt className="text-slate-600">Received</dt>
            <dd className="font-semibold">{formatDateTime(lead.createdAt)}</dd>
          </div>
        </dl>

        {lead.message && (
          <blockquote className="bg-surface mt-4 rounded-lg border-l-4 border-amber-500 px-4 py-3 text-sm whitespace-pre-wrap">
            {lead.message}
          </blockquote>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`tel:+91${lead.mobile}`}
            className={buttonClass("primary")}
            data-testid="call-lead"
          >
            <Phone className="size-4" aria-hidden="true" /> Call
          </a>
          <a
            href={chat}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("secondary")}
            data-testid="whatsapp-lead"
          >
            <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          The buyer agreed on {formatDateTime(lead.consentAt)} that these details are shared with
          you.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold">Where is this enquiry?</h2>
          <form action={changeLeadStatus} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="leadId" value={lead.id} />
            <div className="min-w-0 flex-1 basis-44">
              <Field id="lead-status" label="Status">
                <select
                  id="lead-status"
                  name="status"
                  defaultValue={lead.status}
                  className={inputClass}
                >
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {leadStatusLabel[status]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="submit" className={buttonClass("primary")}>
              Update
            </button>
          </form>

          {fullLeads ? (
            <form action={changeFollowUp} className="mt-5 flex flex-wrap items-end gap-3">
              <input type="hidden" name="leadId" value={lead.id} />
              <div className="min-w-0 flex-1 basis-56">
                <Field
                  id="lead-followup"
                  label="Follow up on"
                  hint="We email you when it is due. Leave empty for none."
                >
                  <input
                    id="lead-followup"
                    name="followUpAt"
                    type="datetime-local"
                    defaultValue={toInputValue(lead.followUpAt)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <button type="submit" className={buttonClass("secondary")}>
                Save date
              </button>
            </form>
          ) : (
            <UpgradeNotice
              className="mt-5"
              feature="Follow-up dates and email reminders"
              plan="GROWTH"
              lapsed={!ctx.entitlements.active}
            />
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold">Site visits</h2>
          {lead.visits.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">The buyer has not asked for a visit.</p>
          ) : (
            <ul className="mt-3 space-y-3" data-testid="visits">
              {lead.visits.map((visit) => (
                <li
                  key={visit.id}
                  className="rounded-lg border border-slate-200 p-3"
                  data-visit-status={visit.status}
                >
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <CalendarClock className="size-4 text-teal-700" aria-hidden="true" />
                    {formatDateTime(visit.scheduledAt)}
                    <Badge
                      tone={
                        visit.status === "CONFIRMED"
                          ? "teal"
                          : visit.status === "REQUESTED"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {visitStatusLabel[visit.status]}
                    </Badge>
                  </p>
                  {fullLeads && (
                    <form action={changeVisitStatus} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="visitId" value={visit.id} />
                      {VISIT_STATUSES.filter((s) => s !== visit.status).map((s) => (
                        <button
                          key={s}
                          name="status"
                          value={s}
                          className="hover:bg-surface rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                        >
                          Mark {visitStatusLabel[s].toLowerCase()}
                        </button>
                      ))}
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!fullLeads && lead.visits.length > 0 && (
            <UpgradeNotice
              className="mt-3"
              feature="Confirming and tracking site visits"
              plan="GROWTH"
              lapsed={!ctx.entitlements.active}
            />
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">Notes and history</h2>
        <form action={addLeadNote} className="mt-3 space-y-3">
          <input type="hidden" name="leadId" value={lead.id} />
          <Field
            id="lead-note"
            label="Add a note"
            hint="Only you and your team can see notes. The buyer cannot."
          >
            <textarea id="lead-note" name="text" rows={2} maxLength={2000} className={inputClass} />
          </Field>
          <button type="submit" className={buttonClass("secondary")}>
            Add note
          </button>
        </form>

        <ol className="mt-5 space-y-3" data-testid="timeline">
          {[...lead.notes].reverse().map((note) => (
            <li
              key={note.id}
              className="border-l-2 border-slate-200 pl-4"
              data-note-kind={note.kind}
            >
              <p className="text-xs text-slate-600">
                {note.kind === "BUYER"
                  ? `${lead.name} wrote`
                  : note.kind === "SYSTEM"
                    ? "Update"
                    : `${note.author?.name ?? "You"} noted`}{" "}
                · {formatDateTime(note.createdAt)}
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
          <li className="border-l-2 border-slate-200 pl-4">
            <p className="text-xs text-slate-600">
              Enquiry received · {formatDateTime(lead.createdAt)}
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}
