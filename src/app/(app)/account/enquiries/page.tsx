import Link from "next/link";
import { CalendarClock, MessageSquare } from "lucide-react";
import { LeadStatusBadge } from "@/components/leads/status-badge";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/leads/format";
import { listBuyerEnquiries } from "@/lib/leads/service";

export const metadata = { title: "My enquiries", robots: { index: false } };

export default async function MyEnquiriesPage() {
  const user = await requireUser({ returnTo: "/account/enquiries", roles: ["BUYER"] });
  const enquiries = await listBuyerEnquiries(getDb(), user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My enquiries</h1>
        <p className="mt-1 text-sm text-slate-600">
          The projects you have asked about, and where each one stands. The builder contacts you on
          the mobile number you gave.
        </p>
      </div>

      {enquiries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <MessageSquare className="mx-auto size-10 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">No enquiries yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            Open a project and press Send enquiry. It will appear here.
          </p>
          <Link href="/projects" className={`${buttonClass("primary")} mt-5`}>
            Browse projects
          </Link>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="my-enquiries">
          {enquiries.map((enquiry) => (
            <li
              key={enquiry.id}
              data-testid="my-enquiry"
              data-status={enquiry.status}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">
                    {enquiry.project.isPublic && enquiry.project.slug ? (
                      <Link href={`/project/${enquiry.project.slug}`} className="hover:underline">
                        {enquiry.project.name}
                      </Link>
                    ) : (
                      enquiry.project.name
                    )}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {[enquiry.builderName, enquiry.project.city].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <LeadStatusBadge status={enquiry.status} audience="buyer" />
              </div>
              {enquiry.canReview && (
                <p className="mt-2 text-sm">
                  <Link
                    href={`/account/reviews/${enquiry.builderId}`}
                    className="font-semibold text-teal-800 underline"
                    data-testid="review-link"
                  >
                    Review {enquiry.builderName ?? "this company"}
                  </Link>
                </p>
              )}
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-slate-600">Sent</dt>
                  <dd className="font-medium">{formatDate(enquiry.createdAt)}</dd>
                </div>
                {enquiry.preferredPlot && (
                  <div className="flex gap-2">
                    <dt className="text-slate-600">Plot</dt>
                    <dd className="font-medium">{enquiry.preferredPlot}</dd>
                  </div>
                )}
              </dl>
              {enquiry.nextVisit && (
                <p className="mt-3 flex items-center gap-2 text-sm font-medium text-teal-800">
                  <CalendarClock className="size-4" aria-hidden="true" />
                  Site visit{" "}
                  {enquiry.nextVisit.status === "CONFIRMED"
                    ? "confirmed for"
                    : "requested for"}{" "}
                  {formatDateTime(enquiry.nextVisit.scheduledAt)}
                </p>
              )}
              {!enquiry.project.isPublic && (
                <p className="mt-3 text-xs text-slate-600">
                  This project is not open to the public right now.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
