import Link from "next/link";
import {
  Home as HomeIcon,
  LandPlot,
  LayoutGrid,
  MessageCircle,
  ShieldCheck,
  Store,
  Trees,
} from "lucide-react";
import { SearchCard } from "@/components/home/search-card";
import { RecentlyViewed } from "@/components/public/recently-viewed";
import { ShortlistProvider } from "@/components/public/shortlist";
import { ListingCard, sampleToCard } from "@/components/search/listing-card";
import { buttonClass } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { PlotLegend } from "@/components/ui/plot-status";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";
import { getDb } from "@/lib/db";
import { sampleProjects } from "@/lib/sample-projects";
import { searchListings, type ListingCardData } from "@/lib/search/cards";
import { EMPTY_FILTERS } from "@/lib/search/params";
import { listCities, type CityEntry } from "@/lib/search/public";

// Rebuilt every five minutes, and straight away when a project goes live or changes.
export const revalidate = 300;

const TRUST = [
  {
    icon: ShieldCheck,
    title: "Verified builders",
    text: "PAN, GST and business checks before a builder earns the Verified badge.",
  },
  {
    icon: LayoutGrid,
    title: "Live plot status",
    text: "See which plots are Available, Booked or Sold, kept up to date by the builder.",
  },
  {
    icon: MessageCircle,
    title: "Direct contact",
    text: "Your enquiry goes straight to the builder. No middlemen in between.",
  },
];

const PROPERTY_TYPES = [
  { icon: LandPlot, label: "Plots", text: "Approved layouts and residential plots", type: "plots" },
  {
    icon: Trees,
    label: "Farm houses",
    text: "Weekend farms and farmland plots",
    type: "farm-houses",
  },
  {
    icon: HomeIcon,
    label: "Residential",
    text: "Apartments, villas and houses",
    type: "residential",
  },
  { icon: Store, label: "Commercial", text: "Shops, offices and mixed-use", type: "commercial" },
];

const BUYER_STEPS = [
  { title: "Search", text: "Filter by city, budget, plot size and approvals." },
  { title: "Compare", text: "Check approvals, pricing and live plot availability." },
  { title: "Enquire", text: "Contact the builder directly and ask for a site visit." },
  { title: "Book", text: "Reserve your plot with a token once online booking opens." },
];

/** The newest live projects and the cities that have some. Never fails the page: if the database
 *  cannot be reached the home page falls back to labelled sample cards. */
async function loadHomeData(): Promise<{
  cards: ListingCardData[];
  cities: CityEntry[];
  real: boolean;
}> {
  try {
    const [{ cards }, cities] = await Promise.all([
      searchListings(getDb(), EMPTY_FILTERS, { limit: 6 }),
      listCities(),
    ]);
    if (cards.length > 0) return { cards, cities: cities.slice(0, 8), real: true };
  } catch (error) {
    console.error("home: could not load live projects", error);
  }
  return { cards: sampleProjects.slice(0, 3).map(sampleToCard), cities: [], real: false };
}

export default async function HomePage() {
  const { cards, cities, real } = await loadHomeData();

  return (
    <>
      <section className="bg-navy-900 relative overflow-hidden text-white">
        <div
          className="bg-navy-700 pointer-events-none absolute -top-40 -right-40 size-[34rem] rounded-full"
          aria-hidden="true"
        />
        <div
          className="bg-navy-800 pointer-events-none absolute -top-24 -right-24 size-[22rem] rounded-full"
          aria-hidden="true"
        />
        <Container className="relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-teal-50">
              <ShieldCheck className="size-4 text-amber-500" aria-hidden="true" />
              Verified builders · Live plot availability
            </p>
            <h1 className="mt-5 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
              Find your plot.
              <br />
              See live availability.
            </h1>
            <div className="mt-6 h-1.5 w-16 rounded-full bg-amber-500" />
            <p className="mt-6 max-w-xl text-lg text-white/80">
              Browse projects from verified builders, check approvals and plot availability, and
              contact the builder directly.
            </p>
            <div className="mt-8 max-w-xl">
              <SearchCard />
            </div>
          </div>

          <div className="hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm lg:block">
            <p className="text-xs font-bold tracking-wider text-white/70 uppercase">
              Live plot availability
            </p>
            <PlotGridArt live className="mt-4" />
            <div className="mt-4">
              <PlotLegend tone="dark" />
            </div>
          </div>
        </Container>
      </section>

      <section aria-label="Why RKB" className="border-b border-slate-200 bg-white">
        <Container className="grid gap-6 py-10 md:grid-cols-3">
          {TRUST.map((item) => (
            <div key={item.title} className="flex gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <item.icon className="size-6" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-bold">{item.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{item.text}</p>
              </div>
            </div>
          ))}
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <SectionHeading
            title={real ? "Latest projects" : "Projects you'll find here"}
            subtitle={
              real
                ? "Fresh listings from verified builders, with live plot availability."
                : "These are sample listings that show how a project looks on RKB. Real projects appear here as verified builders go live."
            }
          />

          <ShortlistProvider>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <li key={card.id}>
                  <ListingCard card={card} priority={index < 3} />
                </li>
              ))}
            </ul>
          </ShortlistProvider>

          <div className="mt-8 text-center">
            <Link href="/projects" className={buttonClass("secondary", "lg")}>
              Browse all projects
            </Link>
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading title="Explore by property type" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROPERTY_TYPES.map((item) => (
              <Link
                key={item.type}
                href={`/projects?type=${item.type}`}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-teal-500 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <span className="bg-navy-900 flex size-12 items-center justify-center rounded-xl text-amber-500">
                  <item.icon className="size-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{item.label}</h3>
                <p className="mt-1 text-sm text-slate-600">{item.text}</p>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {cities.length > 0 && (
        <section className="bg-surface pb-4" aria-label="Browse by city">
          <Container>
            <h2 className="text-xl font-bold">Browse by city</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {cities.map((city) => (
                <li key={city.slug}>
                  <Link
                    href={`/projects/${city.slug}`}
                    className="inline-block rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:border-teal-500"
                  >
                    {city.name} <span className="text-slate-500">({city.count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      <section className="py-4">
        <Container>
          <RecentlyViewed />
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <SectionHeading title="How buying works" align="center" />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BUYER_STEPS.map((step, index) => (
              <li key={step.title} className="bg-navy-900 rounded-2xl p-6 text-center text-white">
                <span className="text-3xl font-extrabold text-amber-500">{index + 1}</span>
                <h3 className="mt-1 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-white/75">{step.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="bg-teal-700 py-14 text-white">
        <Container className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              You build the project. We bring the buyers.
            </h2>
            <p className="mt-2 max-w-xl text-white">
              List your project, show live plot availability and receive buyer enquiries directly. A
              simple monthly plan, with no commission on your sales.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={LIST_PROJECT_HREF} className={buttonClass("accent", "lg")}>
              List your project
            </a>
            <Link href="/for-builders" className={buttonClass("onDark", "lg")}>
              How it works
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}
