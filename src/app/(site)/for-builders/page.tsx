import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, X as XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { Faq, type FaqItem } from "@/components/ui/faq";
import { PlotGridArt } from "@/components/ui/plot-grid-art";
import { PlotLegend } from "@/components/ui/plot-status";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";

export const metadata: Metadata = {
  title: "For builders and developers",
  description:
    "List your projects, show live plot availability and receive verified buyer leads. A simple monthly plan with zero commission on your sales.",
};

const TODAY = [
  "Costly ads with no way to measure results",
  "Leads scattered across calls, WhatsApp and brokers",
  "Plot availability tracked on paper or Excel",
  "Buyers doubt new or unknown projects",
  "Commission lost to middlemen",
];

const WITH_RKB = [
  "Professional online project page, live in days",
  "Every enquiry in one dashboard, with instant alerts",
  "Live plot inventory: Available, Booked or Sold",
  "Verified Builder badge builds buyer trust",
  "Zero commission, direct customer relationship",
];

const STEPS = [
  { title: "Register", text: "Sign up with your business details" },
  { title: "Get verified", text: "Upload RERA and approvals" },
  { title: "List projects", text: "Add layout, plots and photos" },
  { title: "Get buyers", text: "Leads and enquiries arrive daily" },
];

const FEATURES: { title: string; points: string[]; soon?: boolean }[] = [
  {
    title: "Project showcase",
    points: ["Photos, videos, brochure", "Layout plan and map pin", "Approvals on display"],
  },
  {
    title: "Live plot inventory",
    points: ["Plot-wise size, facing, price", "Available / Booked / Sold", "Bulk upload via Excel"],
  },
  {
    title: "Lead dashboard",
    points: ["All enquiries in one place", "SMS, email, WhatsApp alerts", "Follow-up reminders"],
  },
  {
    title: "Online booking",
    points: ["Buyers reserve with a token", "Auto plot reservation", "Instant booking receipt"],
    soon: true,
  },
  {
    title: "Analytics",
    points: ["Views, enquiries, site visits", "Conversion funnel", "Monthly performance report"],
  },
  {
    title: "Reputation",
    points: ["Verified Builder badge", "Ratings and reviews", "Builder profile page"],
  },
];

const DEVELOPERS = [
  "Plotting developers",
  "Farm house promoters",
  "Residential projects",
  "Commercial projects",
  "Mixed-use developers",
  "Pre-launch and ready-to-move",
];

const PROFILE_GROUPS = [
  { title: "Basics", text: "City, locality, map pin, promoter, project type" },
  { title: "Size and layout", text: "Acres, number of plots, open area, layout plan, phases" },
  { title: "Plots and units", text: "Sizes, built-up area, facing, corner plots" },
  { title: "Legal and approvals", text: "RERA, TNCP, municipal, land use, title, bank loans" },
  {
    title: "Timeline and status",
    text: "Start and completion dates, % complete, pre-launch or ready",
  },
  { title: "Pricing", text: "Budget, price per sq ft, token amount, payment plan, offers" },
  { title: "Amenities", text: "Park, gym, pool, mandir, road width, water, security" },
  { title: "Media", text: "Photo gallery, videos, brochure, progress updates" },
  { title: "Contact and proof", text: "Site address, phone, WhatsApp, ratings and reviews" },
];

const BOOKING_FLOW = [
  "Buyer picks a plot",
  "Pays token online",
  "Plot auto-reserved",
  "Agreement signed",
  "Sale deed registered",
];

const TRUST = [
  {
    title: "Builder verification",
    points: ["PAN and GST check", "Business and identity proof", "Office address check"],
  },
  {
    title: "Project verification",
    points: ["RERA number verified", "Approvals reviewed", "Expired approvals paused"],
  },
  {
    title: "Data and privacy",
    points: [
      "Encrypted, backed-up data",
      "Your leads belong to you",
      "Aligned with the DPDP Act 2023",
    ],
  },
];

const FAQ: FaqItem[] = [
  {
    question: "Do you take a commission on plots I sell?",
    answer: "No. You pay only the monthly subscription.",
  },
  {
    question: "Who owns the leads and customer data?",
    answer: "You do. Leads come to you directly with full contact details.",
  },
  {
    question: "Can you help me create my first listing?",
    answer: "Yes. Our team sets up your first project at no extra cost.",
  },
  {
    question: "Is the full plot price paid online?",
    answer:
      "No. Online payment is for the token only. The balance is paid directly to you under the sale agreement.",
  },
];

function Bullets({ points, tone = "teal" }: { points: string[]; tone?: "teal" | "red" }) {
  const Icon = tone === "teal" ? Check : XIcon;
  const colour = tone === "teal" ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-600";
  return (
    <ul className="space-y-3">
      {points.map((point) => (
        <li key={point} className="flex items-start gap-3 text-sm sm:text-base">
          <span
            className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${colour}`}
          >
            <Icon className="size-3.5" aria-hidden="true" strokeWidth={3} />
          </span>
          {point}
        </li>
      ))}
    </ul>
  );
}

export default function ForBuildersPage() {
  return (
    <>
      <section className="bg-navy-900 relative overflow-hidden text-white">
        <div
          className="bg-navy-700 pointer-events-none absolute -top-40 -right-40 size-[34rem] rounded-full"
          aria-hidden="true"
        />
        <Container className="relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <p className="text-xs font-bold tracking-wider text-teal-500 uppercase">
              Builder &amp; developer platform
            </p>
            <h1 className="mt-4 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
              Your projects,
              <br />
              in every buyer&apos;s pocket.
            </h1>
            <div className="mt-6 h-1.5 w-16 rounded-full bg-amber-500" />
            <p className="mt-6 max-w-xl text-lg text-white/80">
              A subscription-based digital showroom where builders list projects, receive verified
              buyer leads and, soon, take plot bookings online.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={LIST_PROJECT_HREF} className={buttonClass("accent", "lg")}>
                List your project
                <ArrowRight className="size-5" aria-hidden="true" />
              </a>
              <Link href="/pricing" className={buttonClass("onDark", "lg")}>
                See plans and pricing
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
            <p className="text-xs font-bold tracking-wider text-white/70 uppercase">
              Live plot availability
            </p>
            <PlotGridArt live className="mt-4" />
            <div className="mt-4">
              <PlotLegend tone="dark" />
            </div>
          </div>
        </Container>
        <Container className="relative pb-12">
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              ["0%", "commission on your sales"],
              ["Monthly", "simple subscription plans"],
              ["100%", "your leads, your customers"],
            ].map(([value, label]) => (
              <div
                key={value}
                className="bg-navy-700 rounded-xl border-l-4 border-amber-500 px-5 py-4"
              >
                <dt className="text-2xl font-extrabold">{value}</dt>
                <dd className="text-sm text-white/70">{label}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading title="Why builders need a platform like this" />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl bg-red-50 p-6 sm:p-8">
              <h3 className="text-xs font-bold tracking-wider text-red-600 uppercase">Today</h3>
              <div className="mt-5">
                <Bullets points={TODAY} tone="red" />
              </div>
            </div>
            <div className="rounded-2xl bg-teal-50 p-6 sm:p-8">
              <h3 className="text-xs font-bold tracking-wider text-teal-700 uppercase">
                With RKB Platform
              </h3>
              <div className="mt-5">
                <Bullets points={WITH_RKB} />
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <SectionHeading title="How it works" />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="bg-navy-900 rounded-2xl p-6 text-center text-white">
                <span className="text-3xl font-extrabold text-amber-500">{index + 1}</span>
                <h3 className="mt-1 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-white/75">{step.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading title="What you get" />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <div
                key={feature.title}
                className={`bg-surface rounded-2xl border-l-4 p-6 ${index % 3 === 1 ? "border-amber-500" : "border-teal-500"}`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">{feature.title}</h3>
                  {feature.soon && <Badge tone="amber">Coming soon</Badge>}
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  {feature.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-500"
                        aria-hidden="true"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <SectionHeading title="Built for every kind of developer" />
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEVELOPERS.map((name) => (
              <li
                key={name}
                className="text-navy-900 rounded-xl bg-teal-50 px-5 py-4 text-center text-sm font-bold"
              >
                {name}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading
            title="A complete project profile"
            subtitle="Everything buyers look for, in one place. Buyers decide faster when the details are clear. You fill this in yourself, step by step, and can save and come back at any time."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {PROFILE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <h3 className="font-bold">{group.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{group.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Online booking, the safe way
            </h2>
            <Badge tone="amber">Coming soon</Badge>
          </div>
          <div className="mt-3 h-1.5 w-12 rounded-full bg-amber-500" />
          <p className="mt-4 max-w-2xl text-slate-600">
            Online payment covers the token amount. The sale itself follows the normal legal
            process.
          </p>
          <ol className="mt-8 grid gap-3 md:grid-cols-5">
            {BOOKING_FLOW.map((step, index) => (
              <li
                key={step}
                className="bg-navy-900 relative rounded-xl px-4 py-5 text-center text-sm font-bold text-white"
              >
                <span className="mb-1 block text-xs text-amber-500">Step {index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-5 max-w-3xl text-sm text-slate-600">
            The token goes directly to your bank account through an RBI-regulated payment partner.
            Balance payments are made directly between buyer and builder through banking channels.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading title="Trust and compliance" />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {TRUST.map((group) => (
              <div
                key={group.title}
                className="bg-surface rounded-2xl border-l-4 border-teal-500 p-6"
              >
                <h3 className="text-lg font-bold">{group.title}</h3>
                <div className="mt-4">
                  <Bullets points={group.points} />
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container className="max-w-3xl">
          <SectionHeading title="Common questions" align="center" />
          <div className="mt-10">
            <Faq items={FAQ} />
          </div>
        </Container>
      </section>

      <section className="bg-navy-900 py-16 text-white">
        <Container className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to list your first project?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/80">
            Create your builder account, share your project details and documents, and go live after
            verification.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={LIST_PROJECT_HREF} className={buttonClass("accent", "lg")}>
              Create your builder account
            </a>
            <Link href="/pricing" className={buttonClass("onDark", "lg")}>
              See pricing
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}
