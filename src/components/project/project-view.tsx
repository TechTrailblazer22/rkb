import { BadgeCheck, MapPin, Phone, MessageCircle } from "lucide-react";
import { Badge, VerifiedBadge } from "@/components/ui/badge";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { PlotLegend, PlotStatusChip } from "@/components/ui/plot-status";
import { FACING_OPTIONS } from "@/components/project/steps/plot-fields";
import { amenityLabel } from "@/lib/projects/amenities";
import { PROJECT_STAGES, PROJECT_TYPES } from "@/lib/projects/fields";
import type { ProjectViewData } from "@/lib/projects/view";
import { formatRupees, formatRupeesCompact } from "@/lib/format";
import { youTubeEmbedUrl, parseYouTubeId } from "@/lib/projects/video";

const label = (list: { value: string; label: string }[], value: string) =>
  list.find((item) => item.value === value)?.label ?? value;

const formatDay = (date: Date) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    date,
  );

const APPROVAL_LABEL: Record<string, string> = {
  RERA: "RERA",
  TNCP: "TNCP / DTCP",
  MUNICIPAL: "Municipal",
  BANK_LOAN: "Bank loan",
  OTHER: "Approval",
};

/**
 * What a buyer sees on a project's page. One component for the builder's preview, the admin's
 * review and the public page, so they can never drift apart.
 */
export function ProjectView({ data }: { data: ProjectViewData }) {
  const { project, builder, photos, plots, plotCounts, approvals } = data;
  const cover = photos.find((p) => p.isCover) ?? photos[0];
  const others = photos.filter((p) => p !== cover).slice(0, 4);
  const location = [project.locality, project.city].filter(Boolean).join(", ");
  const verifiedApproval = approvals.some(
    (a) => a.verified && a.kind !== "BANK_LOAN" && a.kind !== "OTHER",
  );
  const videoId = project.videoUrl ? parseYouTubeId(project.videoUrl) : null;

  const facts: [string, string | null][] = [
    ["Project size", project.acres !== null ? `${project.acres} acres` : null],
    ["Plots or units", project.totalPlots !== null ? String(project.totalPlots) : null],
    [
      "Available now",
      plotCounts.total > 0 ? `${plotCounts.AVAILABLE} of ${plotCounts.total}` : null,
    ],
    [
      "Plot sizes",
      data.sizeFrom !== null && data.sizeTo !== null
        ? data.sizeFrom === data.sizeTo
          ? `${data.sizeFrom.toLocaleString("en-IN")} sq ft`
          : `${data.sizeFrom.toLocaleString("en-IN")} to ${data.sizeTo.toLocaleString("en-IN")} sq ft`
        : null,
    ],
    ["Open area", project.openAreaPercent !== null ? `${project.openAreaPercent}%` : null],
    ["Phases", project.phasesCount !== null ? String(project.phasesCount) : null],
    ["Land use", project.landUse],
    ["Title", project.titleStatus],
    ["Possession", project.completionDate ? formatDay(project.completionDate) : null],
  ];

  return (
    <article className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-8">
        {/* gallery */}
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <div className="bg-navy-900 relative aspect-[4/3] overflow-hidden rounded-2xl sm:row-span-2 sm:aspect-[16/10]">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS
              <img
                src={cover.url}
                alt={`${project.name}, cover photo`}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center p-8">
                <PlotGridArt
                  seed={7}
                  cols={10}
                  rows={5}
                  availableRatio={0.6}
                  className="w-full max-w-md"
                />
              </div>
            )}
          </div>
          {others.slice(0, 2).map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS
            <img
              key={photo.id}
              src={photo.url}
              alt={`${project.name}, photo`}
              loading="lazy"
              className="hidden aspect-[16/10] w-full rounded-2xl object-cover sm:block"
            />
          ))}
        </div>
        {photos.length > 3 && (
          <ul className="-mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="More photos">
            {photos.slice(1).map((photo) => (
              <li key={photo.id} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS */}
                <img
                  src={photo.url}
                  alt=""
                  loading="lazy"
                  className="h-20 w-28 rounded-lg object-cover"
                />
              </li>
            ))}
          </ul>
        )}

        {/* headline */}
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="navy">{label(PROJECT_TYPES, project.type)}</Badge>
            <Badge tone="amber">{label(PROJECT_STAGES, project.stage)}</Badge>
            {verifiedApproval && (
              <Badge tone="teal">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> Approvals verified
              </Badge>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{project.name}</h1>
          {location && (
            <p className="mt-1 flex items-center gap-1 text-slate-600">
              <MapPin className="size-4" aria-hidden="true" />
              {location}
              {project.mapUrl && (
                <a
                  href={project.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 font-semibold text-teal-700 underline"
                >
                  View on map
                </a>
              )}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-1">
            {data.priceFrom !== null && (
              <p className="text-2xl font-extrabold">
                {formatRupeesCompact(data.priceFrom)}
                {data.priceTo !== null &&
                  data.priceTo !== data.priceFrom &&
                  ` to ${formatRupeesCompact(data.priceTo)}`}
              </p>
            )}
            {project.pricePerSqft !== null && (
              <p className="text-slate-600">{formatRupees(project.pricePerSqft)} per sq ft</p>
            )}
          </div>
        </header>

        {/* key facts */}
        <section aria-labelledby="facts-heading">
          <h2 id="facts-heading" className="sr-only">
            Key facts
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {facts
              .filter(([, value]) => value)
              .map(([name, value]) => (
                <div key={name} className="bg-surface rounded-xl px-4 py-3">
                  <dt className="text-xs text-slate-500">{name}</dt>
                  <dd className="font-bold">{value}</dd>
                </div>
              ))}
          </dl>
        </section>

        {project.description && (
          <section>
            <h2 className="text-xl font-bold">About this project</h2>
            <p className="mt-3 leading-relaxed whitespace-pre-line text-slate-700">
              {project.description}
            </p>
          </section>
        )}

        {project.amenities.length > 0 && (
          <section>
            <h2 className="text-xl font-bold">Amenities</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {project.amenities.map((code) => (
                <li key={code}>
                  <Badge tone="teal">{amenityLabel(code)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plots.length > 0 && (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Plots and availability</h2>
              <PlotLegend />
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="sr-only">Plot availability</caption>
                <thead className="bg-surface border-b border-slate-200 text-xs text-slate-600 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Plot
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Size
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Facing
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Price
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plots.map((plot) => (
                    <tr key={plot.id}>
                      <td className="px-4 py-2.5 font-semibold">
                        {plot.number}
                        {plot.isCorner && " (corner)"}
                      </td>
                      <td className="px-4 py-2.5">
                        {plot.sizeSqft.toLocaleString("en-IN")} sq ft
                        {plot.dimensions ? `, ${plot.dimensions}` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        {plot.facing
                          ? FACING_OPTIONS.find((o) => o.value === plot.facing)?.label
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {plot.price ? formatRupees(plot.price) : "On request"}
                      </td>
                      <td className="px-4 py-2.5">
                        <PlotStatusChip status={plot.status === "HELD" ? "BOOKED" : plot.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plotCounts.total > plots.length && (
              <p className="mt-2 text-sm text-slate-500">
                Showing {plots.length} of {plotCounts.total} plots.
              </p>
            )}
          </section>
        )}

        {approvals.length > 0 && (
          <section>
            <h2 className="text-xl font-bold">Approvals</h2>
            <ul className="mt-3 space-y-2">
              {approvals.map((approval) => (
                <li
                  key={approval.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm"
                >
                  <span className="font-bold">
                    {APPROVAL_LABEL[approval.kind] ?? approval.kind}
                  </span>
                  <span>{approval.number}</span>
                  {approval.validTill && (
                    <span className="text-slate-500">
                      valid until {formatDay(approval.validTill)}
                    </span>
                  )}
                  {approval.verified ? (
                    <Badge tone="teal">
                      <BadgeCheck className="size-3.5" aria-hidden="true" /> Verified
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-500">Not yet verified</span>
                  )}
                </li>
              ))}
            </ul>
            {project.bankLoans.length > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                Loans available from: {project.bankLoans.join(", ")}
              </p>
            )}
          </section>
        )}

        {(project.paymentPlan ||
          project.additionalCharges ||
          project.offers ||
          project.tokenAmount) && (
          <section>
            <h2 className="text-xl font-bold">Pricing details</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {project.tokenAmount !== null && (
                <div>
                  <dt className="font-semibold">Token amount</dt>
                  <dd>{formatRupees(project.tokenAmount)}</dd>
                </div>
              )}
              {project.paymentPlan && (
                <div>
                  <dt className="font-semibold">Payment plan</dt>
                  <dd className="whitespace-pre-line text-slate-700">{project.paymentPlan}</dd>
                </div>
              )}
              {project.additionalCharges && (
                <div>
                  <dt className="font-semibold">Additional charges</dt>
                  <dd className="whitespace-pre-line text-slate-700">
                    {project.additionalCharges}
                  </dd>
                </div>
              )}
              {project.offers && (
                <div>
                  <dt className="font-semibold">Current offers</dt>
                  <dd className="whitespace-pre-line text-slate-700">{project.offers}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {project.percentComplete !== null && (
          <section>
            <h2 className="text-xl font-bold">Progress</h2>
            <div className="mt-3 flex items-center gap-4">
              <div
                className="bg-surface h-2.5 flex-1 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={project.percentComplete}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Project completion"
              >
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${project.percentComplete}%` }}
                />
              </div>
              <span className="text-sm font-bold">{project.percentComplete}% complete</span>
            </div>
          </section>
        )}

        {videoId && (
          <section>
            <h2 className="text-xl font-bold">Video</h2>
            <div className="bg-navy-900 mt-3 aspect-video overflow-hidden rounded-2xl">
              <iframe
                src={youTubeEmbedUrl(videoId)}
                title={`${project.name} video`}
                loading="lazy"
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
                className="size-full"
              />
            </div>
          </section>
        )}

        {(data.layoutUrl || data.brochureUrl) && (
          <section className="flex flex-wrap gap-3">
            {data.layoutUrl && (
              <a
                href={data.layoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-surface rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold"
              >
                View layout plan
              </a>
            )}
            {data.brochureUrl && (
              <a
                href={data.brochureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-surface rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold"
              >
                Download brochure
              </a>
            )}
          </section>
        )}
      </div>

      {/* contact card */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            {builder.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- builder-supplied image, sized by CSS
              <img src={builder.logoUrl} alt="" className="size-12 rounded-lg object-cover" />
            ) : (
              <span
                className="bg-navy-900 flex size-12 items-center justify-center rounded-lg text-sm font-bold text-amber-500"
                aria-hidden="true"
              >
                {(builder.companyName ?? "?").slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-bold">{builder.companyName ?? "Builder"}</p>
              {builder.verified && <VerifiedBadge />}
            </div>
          </div>

          {data.priceFrom !== null && (
            <p className="text-lg font-extrabold">
              {formatRupeesCompact(data.priceFrom)}
              {data.priceTo !== null &&
                data.priceTo !== data.priceFrom &&
                ` to ${formatRupeesCompact(data.priceTo)}`}
            </p>
          )}

          <div className="space-y-1 text-sm">
            {project.contactName && <p className="font-semibold">{project.contactName}</p>}
            {project.hideContactNumber ? (
              <p className="text-slate-600">Contact through RKB</p>
            ) : (
              project.contactMobile && (
                <p className="flex items-center gap-2 text-slate-700">
                  <Phone className="size-4" aria-hidden="true" />
                  {project.contactMobile}
                </p>
              )
            )}
            {project.whatsapp && !project.hideContactNumber && (
              <p className="flex items-center gap-2 text-slate-700">
                <MessageCircle className="size-4" aria-hidden="true" />
                WhatsApp {project.whatsapp}
              </p>
            )}
            {project.visitingHours && (
              <p className="text-slate-600">Visiting hours: {project.visitingHours}</p>
            )}
          </div>

          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white opacity-60"
          >
            Contact builder
          </button>
          <p className="text-xs text-slate-500">Enquiries open when the marketplace launches.</p>
        </div>
      </aside>
    </article>
  );
}
