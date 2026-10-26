import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, MapPin } from "lucide-react";
import { ShortlistProvider } from "@/components/public/shortlist";
import { ListingCard } from "@/components/search/listing-card";
import { VerifiedBadge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { getDb } from "@/lib/db";
import { searchListings } from "@/lib/search/cards";
import { EMPTY_FILTERS } from "@/lib/search/params";
import { loadPublicBuilder } from "@/lib/search/public";
import { jsonLd } from "@/lib/seo/json-ld";
import { getSiteUrl } from "@/lib/site";

export const revalidate = 120;

// Nothing is built ahead of time (so the build never needs the database). Each page is built the
// first time someone asks for it, then served from the cache until it is refreshed.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: PageProps<"/builder/[slug]">): Promise<Metadata> {
  const builder = await loadPublicBuilder((await params).slug);
  if (!builder) return { title: "Builder not found", robots: { index: false } };
  const title = `${builder.companyName}, verified builder`;
  const description = builder.about
    ? builder.about.slice(0, 160)
    : `Projects by ${builder.companyName}${builder.city ? ` in ${builder.city}` : ""}, with live plot availability.`;
  return {
    title,
    description,
    alternates: { canonical: `/builder/${builder.slug}` },
    openGraph: {
      title,
      description,
      url: `/builder/${builder.slug}`,
      images: builder.coverUrl ? [{ url: builder.coverUrl }] : undefined,
    },
  };
}

export default async function BuilderPage({ params }: PageProps<"/builder/[slug]">) {
  const builder = await loadPublicBuilder((await params).slug);
  if (!builder) notFound();

  const { cards, total } = await searchListings(getDb(), EMPTY_FILTERS, {
    builderId: builder.id,
    limit: 24,
  });
  const base = getSiteUrl().origin;
  const structured = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: builder.companyName,
    url: `${base}/builder/${builder.slug}`,
    logo: builder.logoUrl ?? undefined,
    description: builder.about ?? undefined,
    foundingDate: builder.yearEstablished ? String(builder.yearEstablished) : undefined,
    sameAs: builder.website ? [builder.website] : undefined,
  };
  const stats: [string, number | null][] = [
    ["In business since", builder.yearEstablished],
    ["Projects completed", builder.projectsCompleted],
    ["Projects ongoing", builder.projectsOngoing],
  ];

  return (
    <Container className="py-8 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>
      </nav>

      <header className="mt-4 flex flex-wrap items-center gap-5">
        {builder.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- builder logo, sized by CSS
          <img src={builder.logoUrl} alt="" className="size-20 rounded-2xl object-cover" />
        ) : (
          <span
            className="bg-navy-900 flex size-20 items-center justify-center rounded-2xl text-2xl font-bold text-amber-500"
            aria-hidden="true"
          >
            {builder.companyName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight">{builder.companyName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
            <VerifiedBadge />
            {builder.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" aria-hidden="true" />
                {[builder.city, builder.state].filter(Boolean).join(", ")}
              </span>
            )}
            {builder.website && (
              <a
                href={builder.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-1 font-semibold text-teal-700 underline"
              >
                <Globe className="size-4" aria-hidden="true" />
                Website
              </a>
            )}
          </div>
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats
          .filter(([, value]) => value !== null)
          .map(([name, value]) => (
            <div key={name} className="bg-surface rounded-xl px-4 py-3">
              <dt className="text-xs text-slate-600">{name}</dt>
              <dd className="font-bold">{value}</dd>
            </div>
          ))}
        <div className="bg-surface rounded-xl px-4 py-3">
          <dt className="text-xs text-slate-600">Live projects on RKB</dt>
          <dd className="font-bold">{total}</dd>
        </div>
      </dl>

      {builder.about && (
        <section className="mt-8 max-w-3xl">
          <h2 className="text-xl font-bold">About {builder.companyName}</h2>
          <p className="mt-3 leading-relaxed whitespace-pre-line text-slate-700">{builder.about}</p>
        </section>
      )}

      {builder.serviceCities.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold">Cities served</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {builder.serviceCities.map((city) => (
              <li key={city} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm">
                {city}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10" aria-labelledby="builder-projects">
        <h2 id="builder-projects" className="text-xl font-bold">
          Projects by {builder.companyName}
        </h2>
        {cards.length === 0 ? (
          <p className="mt-3 text-slate-600">No live projects right now.</p>
        ) : (
          <ShortlistProvider>
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <li key={card.id}>
                  <ListingCard card={card} priority={index < 2} />
                </li>
              ))}
            </ul>
          </ShortlistProvider>
        )}
      </section>
    </Container>
  );
}
