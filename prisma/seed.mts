// Demo data for local development and demos: one builder in every status, so every screen of
// the portal and the admin console has something to show.
//
//   npm run db:seed -- --yes
//
// It only ever writes records whose emails end in @seed.example, and running it twice is safe.
// The seeded documents are database rows only (no real files), so opening them gives a 404.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { BuilderStatus, DocumentKind } from "../src/generated/prisma/enums";
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

await db.$disconnect();
console.log("Done. Log in as an admin to see them in /admin/builders.");
