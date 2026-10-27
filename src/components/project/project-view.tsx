import { LayoutMapView } from "@/components/public/layout-map-view";
import { Stars } from "@/components/public/stars";
import type { ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import { EnquiryDialog } from "@/components/public/enquiry-dialog";
import { Gallery } from "@/components/public/gallery";
import { PlotTable, type PublicPlot } from "@/components/public/plot-table";
import { FACING_OPTIONS } from "@/components/project/steps/plot-fields";
import { Badge, VerifiedBadge } from "@/components/ui/badge";
import { AvailabilityBar } from "@/components/ui/availability-bar";
import { MediaPlaceholder } from "@/components/ui/media-placeholder";
import { amenityLabel } from "@/lib/projects/amenities";
import { PROJECT_STAGES, PROJECT_TYPES } from "@/lib/projects/fields";
import type { ProjectViewData } from "@/lib/projects/view";
import { formatRupees, formatRupeesCompact } from "@/lib/format";
import { youTubeEmbedUrl, parseYouTubeId } from "@/lib/projects/video";

const label = (list: { value: string; label: string }[], value: string) =>
  list.find((item) => item.value === value)?.label ?? value;

const formatMonth = (date: Date) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
const formatDay = (date: Date) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);

const APPROVAL_LABEL: Record<string, string> = {
  RERA: "RERA",
  TNCP: "TNCP / DTCP",
  MUNICIPAL: "Municipal",
  BANK_LOAN: "Bank loan",
  OTHER: "Approval",
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "plots", label: "Plots" },
  { id: "approvals", label: "Approvals" },
  { id: "pricing", label: "Pricing" },
  { id: "builder", label: "Builder" },
] as const;

export function priceText(from: number | null, to: number | null): string | null {
  if (from === null) return null;
  return `${formatRupeesCompact(from)}${to !== null && to !== from ? ` to ${formatRupeesCompact(to)}` : ""}`;
}

/** Ten digits for tel: and wa.me links, whatever way the builder typed the number. */
const tenDigits = (value: string) => value.replace(/\D/g, "").slice(-10);

/** The number to ring or message, or null when the builder prefers enquiries to come through RKB. */
function contactDetails(project: ProjectViewData["project"]) {
  if (project.hideContactNumber || !project.contactMobile) return null;
  const phone = tenDigits(project.contactMobile);
  if (phone.length !== 10) return null;
  return { phone, whatsapp: tenDigits(project.whatsapp ?? project.contactMobile) };
}

/** Opens the enquiry form (see EnquiryDialog): a link to #enquire, so it works as a link too. */
function EnquireLink({ compact }: { compact?: boolean }) {
  return (
    <a
      href="#enquire"
      data-testid="enquire-button"
      className={`flex items-center justify-center gap-2 rounded-lg bg-teal-700 text-sm font-semibold text-white hover:bg-teal-700/90 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}
    >
      <Send className="size-4" aria-hidden="true" /> Send enquiry
    </a>
  );
}

function ContactButtons({
  name,
  contact,
  compact,
}: {
  name: string;
  contact: NonNullable<ReturnType<typeof contactDetails>>;
  compact?: boolean;
}) {
  const text = `Hello, I am interested in ${name}. I found it on RKB Platform.`;
  const size = compact ? "px-3 py-2.5" : "px-4 py-3";
  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
      <a
        href={`tel:+91${contact.phone}`}
        data-testid="call-builder"
        data-track="CALL"
        className={`flex items-center justify-center gap-2 rounded-lg border border-teal-700 text-sm font-semibold text-teal-700 hover:bg-teal-50 ${size}`}
      >
        <Phone className="size-4" aria-hidden="true" /> {compact ? "Call" : `Call ${contact.phone}`}
      </a>
      <a
        href={`https://wa.me/91${contact.whatsapp}?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="whatsapp-builder"
        data-track="WHATSAPP"
        className={`flex items-center justify-center gap-2 rounded-lg border border-teal-700 text-sm font-semibold text-teal-700 hover:bg-teal-50 ${size}`}
      >
        <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
      </a>
    </div>
  );
}

/**
 * What a buyer sees on a project's page. One component for the builder's preview, the admin's
 * review and the public page, so they can never drift apart. `mode` only changes the contact
 * card: a preview cannot be used to contact anyone.
 */
export function ProjectView({
  data,
  mode = "preview",
  actions,
}: {
  data: ProjectViewData;
  mode?: "preview" | "public";
  /** Buttons under the title, such as Save and Share. */
  actions?: ReactNode;
}) {
  const { project, builder, photos, plots, plotCounts, approvals } = data;
  const isPublic = mode === "public";
  const location = [project.locality, project.city].filter(Boolean).join(", ");
  const verifiedApproval = approvals.some(
    (a) => a.verified && a.kind !== "BANK_LOAN" && a.kind !== "OTHER",
  );
  const videoId = project.videoUrl ? parseYouTubeId(project.videoUrl) : null;
  const price = priceText(data.priceFrom, data.priceTo);
  const contact = isPublic ? contactDetails(project) : null;

  const publicPlots: PublicPlot[] = plots.map((plot) => ({
    id: plot.id,
    number: plot.number,
    sizeSqft: plot.sizeSqft,
    dimensions: plot.dimensions,
    facing: plot.facing
      ? (FACING_OPTIONS.find((option) => option.value === plot.facing)?.label ?? null)
      : null,
    isCorner: plot.isCorner,
    price: plot.price,
    status: plot.status === "HELD" ? "BOOKED" : plot.status,
  }));

  const facts: [string, string | null][] = [
    ["Project size", project.acres !== null ? `${project.acres} acres` : null],
    ["Plots or units", project.totalPlots !== null ? String(project.totalPlots) : null],
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
    ["Possession", project.completionDate ? formatMonth(project.completionDate) : null],
  ];

  const hasPricing = Boolean(
    project.paymentPlan || project.additionalCharges || project.offers || project.tokenAmount,
  );

  return (
    <article
      className={`grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] ${isPublic ? "pb-20 lg:pb-0" : ""}`}
    >
      <div className="min-w-0 space-y-8">
        <Gallery
          photos={photos}
          name={project.name}
          fallback={
            <div className="aspect-[16/6] min-h-40">
              <MediaPlaceholder type={project.type} compact />
            </div>
          }
        />

        <header id="overview" className="scroll-mt-28">
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
            <p className="mt-1 flex flex-wrap items-center gap-1 text-slate-600">
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
            {price && <p className="text-2xl font-extrabold">{price}</p>}
            {project.pricePerSqft !== null && (
              <p className="text-slate-600">{formatRupees(project.pricePerSqft)} per sq ft</p>
            )}
          </div>
          {actions && <div className="mt-4 flex flex-wrap gap-3">{actions}</div>}
        </header>

        {plotCounts.total > 0 && (
          <section
            aria-labelledby="availability-heading"
            data-testid="availability-summary"
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="availability-heading" className="text-lg font-bold">
                {plotCounts.AVAILABLE} of {plotCounts.total} plots available
              </h2>
              {publicPlots.length > 0 && (
                <a href="#plots" className="text-sm font-semibold text-teal-700 underline">
                  See every plot
                </a>
              )}
            </div>
            <AvailabilityBar
              available={plotCounts.AVAILABLE}
              booked={plotCounts.BOOKED + plotCounts.HELD}
              sold={plotCounts.SOLD}
              size="md"
              legend
              className="mt-3"
            />
          </section>
        )}

        {isPublic && (
          <nav
            aria-label="On this page"
            className="sticky top-16 z-20 -mx-4 overflow-x-auto border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:mx-0 sm:px-0"
          >
            <ul className="flex min-w-max gap-1">
              {SECTIONS.filter((s) => s.id !== "plots" || publicPlots.length > 0).map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block px-4 py-3 text-sm font-semibold text-slate-700 hover:text-teal-700"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <section aria-labelledby="facts-heading">
          <h2 id="facts-heading" className="sr-only">
            Key facts
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {facts
              .filter(([, value]) => value)
              .map(([name, value]) => (
                <div key={name} className="bg-surface rounded-xl px-4 py-3">
                  <dt className="text-xs text-slate-600">{name}</dt>
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

        {publicPlots.length > 0 && (
          <section id="plots" className="scroll-mt-28">
            <h2 className="text-xl font-bold">Plots and availability</h2>
            <p className="mt-1 text-sm text-slate-600">
              Updated by the builder as plots are booked and sold.
            </p>
            {data.layoutMap && (
              <div className="mt-4">
                <LayoutMapView map={data.layoutMap} projectName={project.name} />
              </div>
            )}
            <div className="mt-4">
              <PlotTable
                plots={publicPlots}
                total={plotCounts.total}
                action={
                  isPublic && project.slug
                    ? { kind: data.booking.available ? "book" : "request", slug: project.slug }
                    : undefined
                }
              />
            </div>
          </section>
        )}

        <section id="approvals" className="scroll-mt-28">
          <h2 className="text-xl font-bold">Approvals</h2>
          {approvals.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              The builder has not listed any approvals yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {approvals.map((approval) => (
                <li
                  key={approval.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm"
                >
                  <span className="font-bold">
                    {APPROVAL_LABEL[approval.kind] ?? approval.kind}
                  </span>
                  {approval.number && <span>{approval.number}</span>}
                  {approval.validTill && (
                    <span className="text-slate-500">
                      valid until {formatMonth(approval.validTill)}
                    </span>
                  )}
                  {approval.verified ? (
                    <Badge tone="teal">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      Verified{approval.verifiedAt ? ` on ${formatDay(approval.verifiedAt)}` : ""}
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-500">Not yet verified by RKB</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {project.bankLoans.length > 0 && (
            <p className="mt-3 text-sm text-slate-600">
              Loans available from: {project.bankLoans.join(", ")}
            </p>
          )}
          {approvals.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              &ldquo;Verified&rdquo; means RKB compared the number with the certificate the builder
              uploaded, on the date shown. It is not a guarantee of title. Always check the original
              documents before you pay.
            </p>
          )}
        </section>

        <section id="pricing" className="scroll-mt-28">
          <h2 className="text-xl font-bold">Pricing details</h2>
          {hasPricing ? (
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
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              Ask the builder for the payment plan and charges.
            </p>
          )}
        </section>

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

        {data.progress.length > 0 && (
          <section id="progress" className="scroll-mt-28" data-testid="progress-updates">
            <h2 className="text-xl font-bold">Construction updates</h2>
            <ol className="mt-3 space-y-4 border-l-2 border-slate-200 pl-5">
              {data.progress.map((update) => (
                <li key={update.id} className="relative" data-testid="progress-update">
                  <span
                    className="absolute top-1.5 -left-[1.6rem] size-3 rounded-full bg-teal-600"
                    aria-hidden="true"
                  />
                  <p className="text-xs font-semibold text-slate-500">
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeZone: "Asia/Kolkata",
                    }).format(update.createdAt)}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-800">{update.note}</p>
                  {update.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS
                    <img
                      src={update.photoUrl}
                      alt=""
                      loading="lazy"
                      className="mt-2 max-h-72 rounded-xl object-cover"
                    />
                  )}
                </li>
              ))}
            </ol>
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

        {project.tourUrl && (
          <section>
            <a
              href={project.tourUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="hover:bg-surface inline-block rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold"
            >
              Take the 360° tour (opens in a new tab)
            </a>
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

      <aside id="builder" className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            {builder.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- builder logo, sized by CSS
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
              {isPublic && builder.slug ? (
                <Link
                  href={`/builder/${builder.slug}`}
                  className="block truncate font-bold hover:underline"
                >
                  {builder.companyName}
                </Link>
              ) : (
                <p className="truncate font-bold">{builder.companyName ?? "Builder"}</p>
              )}
              {builder.verified && <VerifiedBadge />}
              {isPublic && builder.slug && builder.rating.average !== null && (
                <Link
                  href={`/builder/${builder.slug}#reviews`}
                  className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 hover:underline"
                  data-testid="builder-rating"
                >
                  <Stars rating={builder.rating.average} size="size-3.5" />
                  {builder.rating.average.toFixed(1)} ({builder.rating.count}{" "}
                  {builder.rating.count === 1 ? "review" : "reviews"})
                </Link>
              )}
            </div>
          </div>
          {builder.yearEstablished && (
            <p className="text-sm text-slate-600">In business since {builder.yearEstablished}</p>
          )}

          {price && <p className="text-lg font-extrabold">{price}</p>}

          <div className="space-y-1 text-sm">
            {project.contactName && <p className="font-semibold">{project.contactName}</p>}
            {/* The builder's own preview and the admin's review show what will be public. */}
            {!isPublic &&
              (project.hideContactNumber ? (
                <p className="text-slate-600">Contact through RKB</p>
              ) : (
                project.contactMobile && (
                  <p className="flex items-center gap-2 text-slate-700">
                    <Phone className="size-4" aria-hidden="true" />
                    {project.contactMobile}
                  </p>
                )
              ))}
            {!isPublic && !project.hideContactNumber && project.whatsapp && (
              <p className="flex items-center gap-2 text-slate-700">
                <MessageCircle className="size-4" aria-hidden="true" />
                WhatsApp {project.whatsapp}
              </p>
            )}
            {project.visitingHours && (
              <p className="text-slate-600">Visiting hours: {project.visitingHours}</p>
            )}
          </div>

          {isPublic ? (
            <div className="grid gap-2">
              <EnquireLink />
              {contact ? (
                <ContactButtons name={project.name} contact={contact} />
              ) : (
                <p className="text-xs text-slate-600">
                  This builder takes enquiries through RKB. Send an enquiry and they will contact
                  you.
                </p>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white opacity-60"
              >
                Send enquiry
              </button>
              <p className="text-xs text-slate-600">
                Buyers will contact you from here once the project is live.
              </p>
            </>
          )}
        </div>
      </aside>

      {isPublic && project.slug && (
        <EnquiryDialog
          slug={project.slug}
          projectId={project.id}
          projectName={project.name}
          companyName={builder.companyName}
          plotNumbers={publicPlots.map((plot) => plot.number).slice(0, 300)}
        />
      )}

      {isPublic && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:hidden"
          data-testid="mobile-contact-bar"
        >
          {contact ? (
            <div className="grid grid-cols-2 gap-2">
              <EnquireLink compact />
              <a
                href={`tel:+91${contact.phone}`}
                data-testid="call-builder"
                data-track="CALL"
                className="flex items-center justify-center gap-2 rounded-lg border border-teal-700 px-3 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50"
              >
                <Phone className="size-4" aria-hidden="true" /> Call
              </a>
            </div>
          ) : (
            <EnquireLink compact />
          )}
        </div>
      )}
    </article>
  );
}
