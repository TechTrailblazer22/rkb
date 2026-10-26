import Link from "next/link";
import { BadgeCheck, MapPin } from "lucide-react";
import { ShortlistHeart } from "@/components/public/shortlist";
import { Badge } from "@/components/ui/badge";
import { AvailabilityBar } from "@/components/ui/availability-bar";
import { MediaPlaceholder } from "@/components/ui/media-placeholder";
import { formatRupees, formatRupeesCompact } from "@/lib/format";
import type { ListingCardData } from "@/lib/search/cards";
import type { SampleProject } from "@/lib/sample-projects";

function initials(name: string | null): string {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** The invented examples shown before real projects exist. Always labelled as samples. */
const SAMPLE_TYPES: Record<SampleProject["type"], { key: string; label: string }> = {
  Plotted: { key: "PLOTTED", label: "Plotted layout" },
  "Farm house": { key: "FARM_HOUSE", label: "Farm house" },
  Residential: { key: "RESIDENTIAL", label: "Residential" },
  Commercial: { key: "COMMERCIAL", label: "Commercial" },
};

export function sampleToCard(sample: SampleProject): ListingCardData {
  return {
    id: `sample-${sample.slug}`,
    slug: null,
    name: sample.name,
    typeKey: SAMPLE_TYPES[sample.type].key,
    typeLabel: SAMPLE_TYPES[sample.type].label,
    stageLabel: sample.stage,
    city: sample.city,
    locality: sample.locality,
    priceFrom: sample.priceFrom,
    priceTo: sample.priceTo,
    pricePerSqft: sample.pricePerSqft,
    sizeFrom: null,
    sizeTo: null,
    availablePlots: sample.availablePlots,
    // Samples do not say which of the rest are booked and which sold: split them evenly.
    bookedPlots: Math.ceil((sample.totalPlots - sample.availablePlots) / 2),
    soldPlots: Math.floor((sample.totalPlots - sample.availablePlots) / 2),
    totalPlots: sample.totalPlots,
    approvals: sample.approvals.slice(0, 3).map((label) => ({ label, verified: false })),
    builder: { name: sample.builder.name, slug: null, logoUrl: null },
    coverUrl: null,
    sample: true,
  };
}

export function ListingCard({
  card,
  priority = false,
  titleAs: Title = "h3",
}: {
  card: ListingCardData;
  priority?: boolean;
  /** h2 where the cards follow the page's h1 directly, h3 where a section heading comes first. */
  titleAs?: "h2" | "h3";
}) {
  const href = card.slug ? `/project/${card.slug}` : "/projects";
  const place = [card.locality, card.city].filter(Boolean).join(", ");
  const price =
    card.priceFrom !== null
      ? `${formatRupeesCompact(card.priceFrom)}${card.priceTo !== null && card.priceTo !== card.priceFrom ? ` to ${formatRupeesCompact(card.priceTo)}` : ""}`
      : "Price on request";
  const sizes =
    card.sizeFrom !== null && card.sizeTo !== null
      ? card.sizeFrom === card.sizeTo
        ? `${card.sizeFrom.toLocaleString("en-IN")} sq ft`
        : `${card.sizeFrom.toLocaleString("en-IN")} to ${card.sizeTo.toLocaleString("en-IN")} sq ft`
      : null;

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-amber-500 hover:shadow-lg"
      data-testid="listing-card"
      data-slug={card.slug ?? ""}
    >
      <div className="bg-navy-900 relative aspect-[16/10] overflow-hidden">
        {card.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- builder photo, sized by CSS
          <img
            src={card.coverUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <MediaPlaceholder type={card.typeKey} />
        )}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {card.sample && <Badge tone="amber">Sample listing</Badge>}
            <Badge tone="navy">{card.stageLabel}</Badge>
          </div>
          {!card.sample && <ShortlistHeart projectId={card.id} name={card.name} />}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-semibold tracking-wide text-teal-700 uppercase">
          {card.typeLabel}
        </p>
        <Title className="text-navy-900 mt-1 line-clamp-2 text-lg leading-snug font-bold">
          {/* the whole card is clickable through this link */}
          <Link
            href={href}
            className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
          >
            {card.name}
          </Link>
        </Title>
        {place && (
          <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            {place}
          </p>
        )}

        <div className="mt-4">
          <p className="text-navy-900 text-xl font-bold">{price}</p>
          <p className="text-sm text-slate-600">
            {[card.pricePerSqft ? `${formatRupees(card.pricePerSqft)} per sq ft` : null, sizes]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="mt-4">
          {card.totalPlots > 0 ? (
            <>
              <p className="text-sm font-semibold">
                {card.availablePlots} of {card.totalPlots} plots available
              </p>
              <AvailabilityBar
                available={card.availablePlots}
                booked={card.bookedPlots}
                sold={card.soldPlots}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-slate-600">
                {card.bookedPlots} booked · {card.soldPlots} sold
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-600">Plot availability not listed yet</p>
          )}
        </div>

        {card.approvals.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {card.approvals.map((approval) => (
              <li key={approval.label}>
                <Badge tone={approval.verified ? "teal" : "neutral"}>
                  {approval.verified && <BadgeCheck className="size-3.5" aria-hidden="true" />}
                  {approval.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center gap-3 border-t border-slate-100 pt-4">
          {card.builder.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- builder logo, sized by CSS
            <img
              src={card.builder.logoUrl}
              alt=""
              loading="lazy"
              className="size-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="bg-navy-900 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-amber-500"
              aria-hidden="true"
            >
              {initials(card.builder.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {card.builder.slug && card.builder.name ? (
              <Link
                href={`/builder/${card.builder.slug}`}
                className="relative z-10 block truncate text-sm font-semibold hover:underline"
              >
                {card.builder.name}
              </Link>
            ) : (
              <p className="truncate text-sm font-semibold">
                {card.builder.name ?? "Verified builder"}
              </p>
            )}
            {!card.sample && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> Verified builder
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
