import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectView, priceText } from "@/components/project/project-view";
import { RecentlyViewed, TrackView } from "@/components/public/recently-viewed";
import { ShareButton } from "@/components/public/share-button";
import { ShortlistHeart, ShortlistProvider } from "@/components/public/shortlist";
import { ListingCard } from "@/components/search/listing-card";
import { Container } from "@/components/ui/container";
import { PROJECT_TYPES } from "@/lib/projects/fields";
import { loadPublicProject } from "@/lib/search/public";
import { jsonLd } from "@/lib/seo/json-ld";
import { getSiteUrl } from "@/lib/site";

// Rebuilt at most every two minutes, and straight away when the builder or admin changes the
// project (see lib/projects/revalidate.ts).
export const revalidate = 120;

// Nothing is built ahead of time (so the build never needs the database). Each page is built the
// first time someone asks for it, then served from the cache until it is refreshed.
export function generateStaticParams() {
  return [];
}

const typeName = (value: string) => PROJECT_TYPES.find((t) => t.value === value)?.label ?? value;

export async function generateMetadata({
  params,
}: PageProps<"/project/[slug]">): Promise<Metadata> {
  const data = await loadPublicProject((await params).slug);
  if (!data) return { title: "Project not found", robots: { index: false } };

  const { project } = data;
  const place = [project.locality, project.city].filter(Boolean).join(", ");
  const price = priceText(data.priceFrom, data.priceTo);
  const title = `${project.name}${place ? `, ${place}` : ""}`;
  const description = [
    `${typeName(project.type)} by ${data.builder.companyName}`,
    price,
    data.plotCounts.total > 0
      ? `${data.plotCounts.AVAILABLE} of ${data.plotCounts.total} plots available`
      : null,
  ]
    .filter(Boolean)
    .join(". ");
  const cover = data.photos.find((p) => p.isCover) ?? data.photos[0];
  const path = `/project/${project.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title,
      description,
      url: path,
      images: cover ? [{ url: cover.url, alt: project.name }] : undefined,
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title, description },
  };
}

export default async function ProjectPage({ params }: PageProps<"/project/[slug]">) {
  const { slug } = await params;
  const data = await loadPublicProject(slug);
  if (!data) notFound();

  const { project, builder } = data;
  const base = getSiteUrl().origin;
  const place = [project.locality, project.city].filter(Boolean).join(", ");
  const price = priceText(data.priceFrom, data.priceTo);
  const cover = data.photos.find((p) => p.isCover) ?? data.photos[0];
  const url = `${base}/project/${slug}`;

  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: base },
          { "@type": "ListItem", position: 2, name: "Projects", item: `${base}/projects` },
          ...(project.city
            ? [
                {
                  "@type": "ListItem",
                  position: 3,
                  name: project.city,
                  item: `${base}/projects/${encodeURIComponent(project.city.toLowerCase().replace(/\s+/g, "-"))}`,
                },
              ]
            : []),
          { "@type": "ListItem", position: project.city ? 4 : 3, name: project.name, item: url },
        ],
      },
      {
        "@type": "Product",
        name: project.name,
        url,
        description: project.description ?? undefined,
        image: cover ? [cover.url] : undefined,
        brand: { "@type": "Organization", name: builder.companyName },
        offers:
          data.priceFrom !== null
            ? {
                "@type": "AggregateOffer",
                priceCurrency: "INR",
                lowPrice: data.priceFrom,
                highPrice: data.priceTo ?? data.priceFrom,
                availability:
                  data.plotCounts.AVAILABLE > 0
                    ? "https://schema.org/InStock"
                    : "https://schema.org/SoldOut",
              }
            : undefined,
      },
    ],
  };

  return (
    <Container className="py-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>
        {project.city && (
          <>
            <span aria-hidden="true"> / </span>
            <Link
              href={`/projects/${project.city
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, "-")}`}
              className="hover:underline"
            >
              {project.city}
            </Link>
          </>
        )}
      </nav>

      <TrackView
        entry={{
          slug,
          name: project.name,
          place: place || typeName(project.type),
          price: price ?? "Price on request",
        }}
      />

      <ShortlistProvider>
        <ProjectView
          data={data}
          mode="public"
          actions={
            <>
              <ShortlistHeart projectId={project.id} name={project.name} variant="button" />
              <ShareButton
                title={project.name}
                text={`${project.name}${place ? `, ${place}` : ""} on RKB Platform`}
              />
            </>
          }
        />

        {data.similar.length > 0 && (
          <section className="mt-12" aria-labelledby="similar-heading">
            <h2 id="similar-heading" className="text-xl font-bold">
              Similar projects in {project.city}
            </h2>
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.similar.map((card) => (
                <li key={card.id}>
                  <ListingCard card={card} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </ShortlistProvider>

      <div className="mt-12">
        <RecentlyViewed exclude={slug} />
      </div>
    </Container>
  );
}
