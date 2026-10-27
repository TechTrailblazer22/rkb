import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { ProjectStatus } from "@/generated/prisma/enums";
import {
  ENQUIRY_DAILY_LIMIT,
  addBuilderNote,
  createEnquiry,
  getLeadForBuilder,
  leadSummary,
  leadsForExport,
  listBuyerEnquiries,
  listLeads,
  markLeadSeen,
  setFollowUp,
  setLeadStatus,
  setVisitStatus,
} from "@/lib/leads/service";

// Runs against a real, throwaway Postgres with the migrations applied (see docs/TESTING.md):
//   TEST_DATABASE_URL=postgresql://... npm test
const url = process.env.TEST_DATABASE_URL;

const FIELDS = {
  name: "Asha Kumar",
  mobile: "9876543210",
  message: "Is A-12 free?",
  preferredPlot: "A-12",
  visitAt: null,
};
const NOW = new Date("2026-11-01T06:00:00.000Z");

describe.skipIf(!url)("enquiries and leads (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderA: string;
  let builderB: string;
  let ownerA: { id: string; name: string | null };
  let projectA: string;
  let projectB: string;
  let buyer: { id: string; email: string; name: string | null };
  let counter = 0;

  async function user(email: string, name: string | null = null) {
    return db.user.create({ data: { auth0Sub: `auth0|${email}`, email, name } });
  }
  async function project(builderId: string, name: string, status: ProjectStatus = "LIVE") {
    return db.project.create({
      data: {
        builderId,
        name,
        type: "PLOTTED",
        status,
        slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${++counter}`,
      },
    });
  }
  const enquire = (over: Partial<Parameters<typeof createEnquiry>[1]> = {}) =>
    createEnquiry(db, {
      buyer,
      projectId: projectA,
      fields: FIELDS,
      termsVersion: "v1",
      now: NOW,
      ...over,
    });

  beforeEach(async () => {
    await db.lead.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    counter = 0;
    builderA = (
      await db.builder.create({
        data: { companyName: "Anand Realty", status: "VERIFIED", slug: "anand" },
      })
    ).id;
    builderB = (
      await db.builder.create({
        data: { companyName: "Other Builders", status: "VERIFIED", slug: "other" },
      })
    ).id;
    const owner = await user("owner-a@test.example", "Owner A");
    ownerA = { id: owner.id, name: owner.name };
    await db.builderMember.create({
      data: { builderId: builderA, userId: owner.id, role: "OWNER" },
    });
    projectA = (await project(builderA, "Green Valley")).id;
    projectB = (await project(builderB, "Lake View")).id;
    const b = await user("buyer@test.example", "Asha");
    buyer = { id: b.id, email: b.email, name: b.name };
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  describe("createEnquiry", () => {
    it("stores the enquiry, the consent and the company, unverified mobile and all", async () => {
      const result = await enquire();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.repeat).toBe(false);
      expect(result.recipients).toEqual(["owner-a@test.example"]);
      expect(result.lead).toMatchObject({
        builderId: builderA,
        projectId: projectA,
        buyerId: buyer.id,
        status: "NEW",
        mobile: "9876543210",
        email: "buyer@test.example",
        mobileVerified: false,
        consentTermsVersion: "v1",
        message: "Is A-12 free?",
        preferredPlot: "A-12",
      });
      expect(result.lead.consentAt.toISOString()).toBe(NOW.toISOString());
    });

    it("remembers the buyer's mobile, and their name when they had none", async () => {
      await db.user.update({ where: { id: buyer.id }, data: { name: null } });
      await enquire({ buyer: { ...buyer, name: null } });
      expect(await db.user.findUnique({ where: { id: buyer.id } })).toMatchObject({
        mobile: "9876543210",
        name: "Asha Kumar",
      });
    });

    it("records a requested site visit", async () => {
      const visitAt = new Date("2026-11-03T05:00:00.000Z");
      const result = await enquire({ fields: { ...FIELDS, visitAt } });
      expect(result.ok).toBe(true);
      const visits = await db.siteVisit.findMany();
      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({ status: "REQUESTED" });
      expect(visits[0].scheduledAt.toISOString()).toBe(visitAt.toISOString());
    });

    it.each<ProjectStatus>(["DRAFT", "PAUSED", "SUBMITTED", "ARCHIVED", "CHANGES_REQUESTED"])(
      "refuses a project that is %s, as if it did not exist",
      async (status) => {
        const hidden = await project(builderA, `Hidden ${status}`, status);
        const result = await enquire({ projectId: hidden.id });
        expect(result).toMatchObject({ ok: false, code: "not_found" });
        expect(await db.lead.count()).toBe(0);
      },
    );

    it("refuses a live project whose builder is not verified", async () => {
      await db.builder.update({ where: { id: builderA }, data: { status: "SUSPENDED" } });
      expect(await enquire()).toMatchObject({ ok: false, code: "not_found" });
    });

    it("refuses an unknown project id", async () => {
      expect(await enquire({ projectId: "nope" })).toMatchObject({ ok: false, code: "not_found" });
    });

    it("will not let a builder enquire about their own company's project", async () => {
      const result = await enquire({ buyer: { ...ownerA, email: "owner-a@test.example" } });
      expect(result).toMatchObject({ ok: false, code: "own_project" });
    });

    it("adds a second message to the open enquiry instead of making a duplicate", async () => {
      await enquire();
      const again = await enquire({
        fields: { ...FIELDS, message: "Also, what is the price?" },
        now: new Date(NOW.getTime() + 60_000),
      });
      expect(again.ok && again.repeat).toBe(true);
      expect(await db.lead.count()).toBe(1);
      const lead = await db.lead.findFirstOrThrow({ include: { notes: true } });
      expect(lead.notes).toHaveLength(1);
      expect(lead.notes[0]).toMatchObject({ kind: "BUYER", text: "Also, what is the price?" });
      expect(lead.lastBuyerMessageAt.getTime()).toBe(NOW.getTime() + 60_000);
    });

    it("marks a repeated enquiry as unseen again, so it floats up the inbox", async () => {
      const first = await enquire();
      if (!first.ok) throw new Error("setup");
      await markLeadSeen(db, builderA, first.lead.id);
      expect(
        (await db.lead.findUniqueOrThrow({ where: { id: first.lead.id } })).seenAt,
      ).not.toBeNull();
      await enquire({ now: new Date(NOW.getTime() + 60_000) });
      expect((await db.lead.findUniqueOrThrow({ where: { id: first.lead.id } })).seenAt).toBeNull();
    });

    it("starts a fresh enquiry once the earlier one is closed", async () => {
      const first = await enquire();
      if (!first.ok) throw new Error("setup");
      await db.lead.update({ where: { id: first.lead.id }, data: { status: "LOST" } });
      const next = await enquire({ now: new Date(NOW.getTime() + 60_000) });
      expect(next.ok && next.repeat).toBe(false);
      expect(await db.lead.count()).toBe(2);
    });

    it("keeps enquiries on different projects separate", async () => {
      await enquire();
      await enquire({ projectId: projectB });
      expect(await db.lead.count()).toBe(2);
      expect(
        (await db.lead.findMany({ select: { builderId: true } })).map((l) => l.builderId).sort(),
      ).toEqual([builderA, builderB].sort());
    });

    it(`allows ${ENQUIRY_DAILY_LIMIT} enquiries and messages in a day, then asks the buyer to wait`, async () => {
      const projects = [projectA, projectB];
      for (let i = 0; i < ENQUIRY_DAILY_LIMIT; i++) {
        const extra = await project(i % 2 ? builderA : builderB, `Extra ${i}`);
        expect(
          (await enquire({ projectId: extra.id, now: new Date(NOW.getTime() + i * 1000) })).ok,
        ).toBe(true);
      }
      expect(projects).toHaveLength(2);
      const blocked = await enquire({ now: new Date(NOW.getTime() + 10_000) });
      expect(blocked).toMatchObject({ ok: false, code: "rate_limited" });
      // a day later it works again
      expect((await enquire({ now: new Date(NOW.getTime() + 25 * 3_600_000) })).ok).toBe(true);
    });

    it("counts follow-up messages towards the limit too", async () => {
      await enquire();
      for (let i = 1; i < ENQUIRY_DAILY_LIMIT; i++) {
        expect((await enquire({ now: new Date(NOW.getTime() + i * 1000) })).ok).toBe(true);
      }
      expect(await enquire({ now: new Date(NOW.getTime() + 9000) })).toMatchObject({
        ok: false,
        code: "rate_limited",
      });
    });

    it("limits each buyer separately", async () => {
      const other = await user("other@test.example");
      for (let i = 0; i < ENQUIRY_DAILY_LIMIT; i++) {
        const extra = await project(builderA, `Spam ${i}`);
        await enquire({ projectId: extra.id });
      }
      const result = await enquire({ buyer: { id: other.id, email: other.email, name: null } });
      expect(result.ok).toBe(true);
    });
  });

  describe("the builder's inbox", () => {
    async function seed() {
      const second = await user("buyer2@test.example", "Ravi");
      await enquire();
      await enquire({
        buyer: { id: second.id, email: second.email, name: "Ravi" },
        fields: {
          ...FIELDS,
          name: "Ravi Shankar",
          mobile: "9123456780",
          message: null,
          preferredPlot: null,
        },
        now: new Date(NOW.getTime() + 1000),
      });
      await enquire({ projectId: projectB });
    }

    it("shows a builder their own leads only, newest message first", async () => {
      await seed();
      const { rows, total } = await listLeads(db, builderA);
      expect(total).toBe(2);
      expect(rows.map((r) => r.name)).toEqual(["Ravi Shankar", "Asha Kumar"]);
      expect((await listLeads(db, builderB)).total).toBe(1);
    });

    it("filters by status, project and search words", async () => {
      await seed();
      const ravi = (await listLeads(db, builderA, { q: "ravi" })).rows;
      expect(ravi.map((r) => r.name)).toEqual(["Ravi Shankar"]);
      expect((await listLeads(db, builderA, { q: "9123456780" })).total).toBe(1);
      expect((await listLeads(db, builderA, { q: "91234" })).total).toBe(1);
      expect((await listLeads(db, builderA, { projectId: projectA })).total).toBe(2);
      expect((await listLeads(db, builderA, { projectId: projectB })).total).toBe(0);
      expect((await listLeads(db, builderA, { status: "BOOKED" })).total).toBe(0);
      expect((await listLeads(db, builderA, { q: "green valley" })).total).toBe(2);
    });

    it("never returns another company's lead by id", async () => {
      await seed();
      const theirs = await db.lead.findFirstOrThrow({ where: { builderId: builderB } });
      expect(await getLeadForBuilder(db, builderA, theirs.id)).toBeNull();
      expect(
        await setLeadStatus(db, {
          builderId: builderA,
          leadId: theirs.id,
          status: "BOOKED",
          actor: ownerA,
        }),
      ).toBe(false);
      expect(
        await addBuilderNote(db, {
          builderId: builderA,
          leadId: theirs.id,
          text: "hi",
          actor: ownerA,
        }),
      ).toBe(false);
      expect(
        await setFollowUp(db, { builderId: builderA, leadId: theirs.id, followUpAt: NOW }),
      ).toBe(false);
      expect((await db.lead.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("NEW");
    });

    it("moves a lead along the pipeline and keeps a timeline of it", async () => {
      await seed();
      const lead = await db.lead.findFirstOrThrow({
        where: { builderId: builderA, name: "Asha Kumar" },
      });
      expect(
        await setLeadStatus(db, {
          builderId: builderA,
          leadId: lead.id,
          status: "CONTACTED",
          actor: ownerA,
        }),
      ).toBe(true);
      expect(
        await setLeadStatus(db, {
          builderId: builderA,
          leadId: lead.id,
          status: "CONTACTED",
          actor: ownerA,
        }),
      ).toBe(true);
      expect(
        await addBuilderNote(db, {
          builderId: builderA,
          leadId: lead.id,
          text: "  Called, will visit Sunday  ",
          actor: ownerA,
        }),
      ).toBe(true);
      expect(
        await addBuilderNote(db, {
          builderId: builderA,
          leadId: lead.id,
          text: "   ",
          actor: ownerA,
        }),
      ).toBe(false);
      const full = await getLeadForBuilder(db, builderA, lead.id);
      expect(full?.status).toBe("CONTACTED");
      expect(full?.notes.map((n) => [n.kind, n.text])).toEqual([
        ["SYSTEM", "Status changed from New to Contacted."],
        ["BUILDER", "Called, will visit Sunday"],
      ]);
    });

    it("resets the reminder whenever the follow-up date changes", async () => {
      await seed();
      const lead = await db.lead.findFirstOrThrow({ where: { builderId: builderA } });
      await db.lead.update({
        where: { id: lead.id },
        data: { followUpAt: NOW, reminderSentAt: NOW },
      });
      const later = new Date(NOW.getTime() + 86_400_000);
      await setFollowUp(db, { builderId: builderA, leadId: lead.id, followUpAt: later });
      expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
        reminderSentAt: null,
        followUpAt: later,
      });
      await setFollowUp(db, { builderId: builderA, leadId: lead.id, followUpAt: null });
      expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).followUpAt).toBeNull();
    });

    it("confirms a site visit, only for the lead's own company", async () => {
      await enquire({ fields: { ...FIELDS, visitAt: new Date("2026-11-03T05:00:00.000Z") } });
      const lead = await db.lead.findFirstOrThrow({ include: { visits: true } });
      const visitId = lead.visits[0].id;
      expect(
        await setVisitStatus(db, {
          builderId: builderB,
          leadId: lead.id,
          visitId,
          status: "CONFIRMED",
        }),
      ).toBe(false);
      expect(
        await setVisitStatus(db, {
          builderId: builderA,
          leadId: lead.id,
          visitId,
          status: "CONFIRMED",
        }),
      ).toBe(true);
      expect((await db.siteVisit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe(
        "CONFIRMED",
      );
    });

    it("counts what needs attention", async () => {
      await seed();
      const lead = await db.lead.findFirstOrThrow({ where: { builderId: builderA } });
      await setFollowUp(db, {
        builderId: builderA,
        leadId: lead.id,
        followUpAt: new Date(NOW.getTime() - 1000),
      });
      expect(await leadSummary(db, builderA, NOW)).toEqual({ new: 2, followUpsDue: 1, unseen: 2 });
      await setLeadStatus(db, {
        builderId: builderA,
        leadId: lead.id,
        status: "LOST",
        actor: ownerA,
      });
      expect((await leadSummary(db, builderA, NOW)).followUpsDue).toBe(0);
      expect((await listLeads(db, builderA, { due: true }, NOW)).total).toBe(0);
    });

    it("lists due follow-ups only for leads still being worked on", async () => {
      await seed();
      const lead = await db.lead.findFirstOrThrow({
        where: { builderId: builderA, name: "Asha Kumar" },
      });
      await setFollowUp(db, {
        builderId: builderA,
        leadId: lead.id,
        followUpAt: new Date(NOW.getTime() - 1000),
      });
      expect((await listLeads(db, builderA, { due: true }, NOW)).rows.map((r) => r.name)).toEqual([
        "Asha Kumar",
      ]);
    });

    it("exports the filtered leads with the project name", async () => {
      await seed();
      const rows = await leadsForExport(db, builderA);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ projectName: "Green Valley", mobileVerified: false });
      expect(await leadsForExport(db, builderA, { q: "ravi" })).toHaveLength(1);
      expect(await leadsForExport(db, builderB)).toHaveLength(1);
    });
  });

  describe("the buyer's enquiries", () => {
    it("lists only the buyer's own, with the builder's words hidden behind a status", async () => {
      await enquire();
      await enquire({ projectId: projectB });
      const other = await user("other@test.example");
      await enquire({ buyer: { id: other.id, email: other.email, name: null } });
      const mine = await listBuyerEnquiries(db, buyer.id);
      expect(mine).toHaveLength(2);
      expect(mine.every((m) => m.status === "NEW")).toBe(true);
      expect(JSON.stringify(mine)).not.toContain("notes");
      expect(await listBuyerEnquiries(db, other.id)).toHaveLength(1);
    });

    it("only offers a project link while the project is still public", async () => {
      await enquire();
      expect((await listBuyerEnquiries(db, buyer.id))[0].project.isPublic).toBe(true);
      await db.project.update({ where: { id: projectA }, data: { status: "PAUSED" } });
      expect((await listBuyerEnquiries(db, buyer.id))[0].project.isPublic).toBe(false);
    });

    it("shows the next site visit that is still on", async () => {
      await enquire({ fields: { ...FIELDS, visitAt: new Date("2026-11-03T05:00:00.000Z") } });
      const lead = await db.lead.findFirstOrThrow({ include: { visits: true } });
      expect((await listBuyerEnquiries(db, buyer.id))[0].nextVisit?.status).toBe("REQUESTED");
      await setVisitStatus(db, {
        builderId: builderA,
        leadId: lead.id,
        visitId: lead.visits[0].id,
        status: "CANCELLED",
      });
      expect((await listBuyerEnquiries(db, buyer.id))[0].nextVisit).toBeNull();
    });
  });
});
