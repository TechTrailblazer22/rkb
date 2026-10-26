// Demo data for local development and demos: one builder in every status, so every screen of
// the portal and the admin console has something to show.
//
//   npm run db:seed -- --yes
//
// It only ever writes records whose emails end in @seed.example, and running it twice is safe.
// The seeded documents are database rows only (no real files), so opening them gives a 404.
// The verified demo builder also gets a few LIVE projects with plots, so the public marketplace
// (/projects, /project/<slug>, /builder/<slug>) has something to show. They have no photos.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { BuilderStatus, DocumentKind } from "../src/generated/prisma/enums";
import { plotSortKey } from "../src/lib/plots/sort";
import { completeGstin } from "../src/lib/validation/identity";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data when NODE_ENV=production.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(
    "This adds demo builders to the database in DATABASE_URL. Re-run with --yes to confirm.",
  );
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
console.log(`Seeding ${new URL(connectionString).hostname} ...`);

type Demo = {
  key: string;
  status: BuilderStatus;
  company: string;
  pan: string;
  city: string;
  state: string;
  plan: "STARTER" | "GROWTH" | "PREMIER";
  documents: boolean;
  reviewNote?: string;
};

const DEMOS: Demo[] = [
  {
    key: "draft",
    status: "DRAFT",
    company: "Seed Draft Homes",
    pan: "AABCD1111A",
    city: "Madurai",
    state: "Tamil Nadu",
    plan: "STARTER",
    documents: false,
  },
  {
    key: "submitted",
    status: "SUBMITTED",
    company: "Seed Submitted Estates",
    pan: "AABCS2222B",
    city: "Coimbatore",
    state: "Tamil Nadu",
    plan: "GROWTH",
    documents: true,
  },
  {
    key: "changes",
    status: "CHANGES_REQUESTED",
    company: "Seed Changes Constructions",
    pan: "AABCC3333C",
    city: "Chennai",
    state: "Tamil Nadu",
    plan: "GROWTH",
    documents: true,
    reviewNote:
      "The GST certificate does not show your office address. Please upload the full certificate.",
  },
  {
    key: "verified",
    status: "VERIFIED",
    company: "Seed Verified Builders",
    pan: "AABCV4444D",
    city: "Hosur",
    state: "Tamil Nadu",
    plan: "PREMIER",
    documents: true,
  },
  {
    key: "rejected",
    status: "REJECTED",
    company: "Seed Rejected Realty",
    pan: "AABCR5555E",
    city: "Salem",
    state: "Tamil Nadu",
    plan: "STARTER",
    documents: true,
    reviewNote: "We could not match the documents to the company details.",
  },
  {
    key: "suspended",
    status: "SUSPENDED",
    company: "Seed Suspended Developers",
    pan: "AABCP6666F",
    city: "Trichy",
    state: "Tamil Nadu",
    plan: "STARTER",
    documents: true,
    reviewNote: "Suspended while a complaint is investigated.",
  },
];

const KINDS: DocumentKind[] = ["PAN", "GST", "BUSINESS_PROOF", "IDENTITY_PROOF", "ADDRESS_PROOF"];

for (const demo of DEMOS) {
  const email = `${demo.key}@seed.example`;
  const user = await db.user.upsert({
    where: { auth0Sub: `seed|${demo.key}` },
    update: {},
    create: {
      auth0Sub: `seed|${demo.key}`,
      email,
      name: `${demo.key[0].toUpperCase()}${demo.key.slice(1)} Owner`,
      role: "BUILDER_OWNER",
      termsVersion: "seed",
      termsAcceptedAt: new Date(),
    },
  });

  const existing = await db.builder.findFirst({
    where: { members: { some: { userId: user.id } } },
  });
  if (existing) {
    console.log(`  kept     ${demo.company}`);
    continue;
  }

  const now = new Date();
  const slugBase = demo.company.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const builder = await db.builder.create({
    data: {
      status: demo.status,
      companyName: demo.company,
      type: "PRIVATE_LIMITED",
      yearEstablished: 2012,
      projectsCompleted: 6,
      projectsOngoing: 2,
      about: `${demo.company} is demo data created by the seed script.`,
      contactPerson: "Demo Contact",
      contactMobile: "9876543210",
      addressLine: "1 Demo Street",
      city: demo.city,
      state: demo.state,
      pincode: "600001",
      serviceCities: [demo.city],
      pan: demo.pan,
      gstin: completeGstin(`33${demo.pan}1Z`),
      interestedPlan: demo.plan,
      submittedAt: demo.status === "DRAFT" ? null : now,
      reviewedAt: ["VERIFIED", "REJECTED", "SUSPENDED", "CHANGES_REQUESTED"].includes(demo.status)
        ? now
        : null,
      verifiedAt: demo.status === "VERIFIED" || demo.status === "SUSPENDED" ? now : null,
      slug: demo.status === "VERIFIED" ? slugBase : null,
      reviewNote: demo.reviewNote ?? null,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  if (demo.documents) {
    await db.builderDocument.createMany({
      data: KINDS.map((kind) => ({
        builderId: builder.id,
        kind,
        storageKey: `seed/${demo.key}-${kind.toLowerCase()}.pdf`,
        originalName: `${kind.toLowerCase()}-demo.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 48_000,
        status: demo.status === "VERIFIED" ? ("APPROVED" as const) : ("PENDING" as const),
        uploadedById: user.id,
      })),
    });
  }
  console.log(`  created  ${demo.company} (${demo.status})`);
}

// ---------------------------------------------------------------------------------------
// LIVE demo projects for the public marketplace

type DemoProject = {
  slug: string;
  name: string;
  type: "PLOTTED" | "FARM_HOUSE" | "RESIDENTIAL" | "COMMERCIAL";
  stage: "PRE_LAUNCH" | "UNDER_CONSTRUCTION" | "READY_TO_MOVE";
  city: string;
  locality: string;
  pricePerSqft: number;
  sizes: number[];
  plots: number;
  /** Share of plots that are booked, then sold. */
  booked: number;
  sold: number;
  amenities: string[];
  approvals: ("RERA" | "TNCP")[];
};

const LIVE_PROJECTS: DemoProject[] = [
  {
    slug: "seed-green-valley-enclave",
    name: "Green Valley Enclave",
    type: "PLOTTED",
    stage: "READY_TO_MOVE",
    city: "Hosur",
    locality: "Bagalur Road",
    pricePerSqft: 1850,
    sizes: [1000, 1200, 1500, 1800],
    plots: 40,
    booked: 0.2,
    sold: 0.3,
    amenities: ["park", "tar_road", "street_lights", "compound_wall"],
    approvals: ["RERA", "TNCP"],
  },
  {
    slug: "seed-lakeview-farm-retreat",
    name: "Lakeview Farm Retreat",
    type: "FARM_HOUSE",
    stage: "UNDER_CONSTRUCTION",
    city: "Hosur",
    locality: "Denkanikottai",
    pricePerSqft: 950,
    sizes: [4400, 5400, 8700],
    plots: 18,
    booked: 0.15,
    sold: 0.1,
    amenities: ["garden", "tar_road"],
    approvals: ["TNCP"],
  },
  {
    slug: "seed-skyline-heights",
    name: "Skyline Heights",
    type: "RESIDENTIAL",
    stage: "PRE_LAUNCH",
    city: "Coimbatore",
    locality: "Saravanampatti",
    pricePerSqft: 6200,
    sizes: [950, 1250, 1600],
    plots: 24,
    booked: 0.1,
    sold: 0,
    amenities: ["gym", "swimming_pool", "clubhouse"],
    approvals: ["RERA"],
  },
  {
    slug: "seed-metro-business-park",
    name: "Metro Business Park",
    type: "COMMERCIAL",
    stage: "UNDER_CONSTRUCTION",
    city: "Chennai",
    locality: "Guindy",
    pricePerSqft: 11500,
    sizes: [450, 800, 1500],
    plots: 16,
    booked: 0.25,
    sold: 0.25,
    amenities: ["security", "cctv", "ev_charging"],
    approvals: ["RERA", "TNCP"],
  },
];

const liveBuilder = await db.builder.findFirst({
  where: {
    status: "VERIFIED",
    slug: { not: null },
    members: { some: { user: { auth0Sub: "seed|verified" } } },
  },
});
if (!liveBuilder) {
  console.log("  (no verified demo builder, so no live demo projects)");
} else {
  const verifiedAt = new Date();
  for (const demo of LIVE_PROJECTS) {
    if (await db.project.findUnique({ where: { slug: demo.slug } })) {
      console.log(`  kept     ${demo.name}`);
      continue;
    }
    const prices = demo.sizes.map((size) => size * demo.pricePerSqft);
    const project = await db.project.create({
      data: {
        builderId: liveBuilder.id,
        slug: demo.slug,
        status: "LIVE",
        name: demo.name,
        type: demo.type,
        stage: demo.stage,
        city: demo.city,
        locality: demo.locality,
        description: `${demo.name} is demo data created by the seed script.`,
        totalPlots: demo.plots,
        pricePerSqft: demo.pricePerSqft,
        budgetFrom: Math.min(...prices),
        budgetTo: Math.max(...prices),
        amenities: demo.amenities,
        contactName: "Demo Sales Desk",
        contactMobile: "9876543210",
        whatsapp: "9876543210",
        visitingHours: "10 am to 6 pm, every day",
        submittedAt: verifiedAt,
        reviewedAt: verifiedAt,
        publishedAt: verifiedAt,
        approvals: {
          create: demo.approvals.map((kind) => ({
            kind,
            number: kind === "RERA" ? "TN/29/Layout/0001/2024" : "DTCP 123/2024",
            verified: true,
            verifiedAt,
          })),
        },
      },
    });
    const bookedCount = Math.round(demo.plots * demo.booked);
    const soldCount = Math.round(demo.plots * demo.sold);
    await db.plot.createMany({
      data: Array.from({ length: demo.plots }, (_, i) => {
        const number = `A-${i + 1}`;
        const size = demo.sizes[i % demo.sizes.length];
        return {
          projectId: project.id,
          number,
          sortKey: plotSortKey(number),
          sizeSqft: size,
          facing: (["EAST", "NORTH", "WEST", "SOUTH"] as const)[i % 4],
          isCorner: i % 7 === 0,
          price: size * demo.pricePerSqft,
          ratePerSqft: demo.pricePerSqft,
          status:
            i < soldCount
              ? ("SOLD" as const)
              : i < soldCount + bookedCount
                ? ("BOOKED" as const)
                : ("AVAILABLE" as const),
        };
      }),
    });
    console.log(`  created  ${demo.name} (LIVE, ${demo.plots} plots)`);
  }
}

await db.$disconnect();
console.log(
  "Done. Log in as an admin to see the builders in /admin/builders; the live demo projects are at /projects.",
);
