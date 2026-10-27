import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  isBot,
  parseBrowserEvent,
  parseSource,
  recordStat,
  statsForBuilder,
  statsToCsv,
} from "@/lib/analytics/stats";
import { previousMonth, sendMonthlyReports } from "@/lib/jobs/performance";
import type { MailMessage } from "@/lib/mail";
import { setShortlisted } from "@/lib/shortlist/service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const DAY = 86_400_000;

describe("small helpers", () => {
  it("counts a real browser and ignores crawlers and scripts", () => {
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126 Safari/537.36")).toBe(
      false,
    );
    for (const ua of [
      "Googlebot/2.1",
      "bingbot",
      "Lighthouse",
      "curl/8.0",
      "python-requests/2",
      "HeadlessChrome",
      "WhatsApp/2",
      null,
      "",
    ]) {
      expect(isBot(ua), String(ua)).toBe(true);
    }
  });
  it("only lets the browser report views and contact taps", () => {
    expect(parseBrowserEvent("VIEW")).toBe("VIEW");
    expect(parseBrowserEvent("CALL")).toBe("CALL");
    expect(parseBrowserEvent("WHATSAPP")).toBe("WHATSAPP");
    for (const bad of ["ENQUIRY", "VISIT", "SHORTLIST", "view", "", undefined, 1]) {
      expect(parseBrowserEvent(bad)).toBeNull();
    }
  });
  it("knows only its own traffic sources", () => {
    expect(parseSource("search")).toBe("search");
    expect(parseSource("<script>")).toBe("direct");
    expect(parseSource(undefined)).toBe("direct");
  });
  it("names the month before today", () => {
    expect(previousMonth(new Date("2026-11-10T06:00:00Z"))).toMatchObject({
      key: "2026-10",
      days: 31,
    });
    expect(previousMonth(new Date("2027-03-02T06:00:00Z"))).toMatchObject({
      key: "2027-02",
      days: 28,
    });
    expect(previousMonth(new Date("2027-01-01T00:30:00+05:30"))).toMatchObject({
      key: "2026-12",
      days: 31,
    });
  });
});

describe.skipIf(!url)("analytics (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    const owner = await db.user.create({
      data: { auth0Sub: "auth0|o", email: "owner@test.example" },
    });
    builderId = (
      await db.builder.create({
        data: { companyName: "Anand Realty", status: "VERIFIED", slug: "anand" },
      })
    ).id;
    await db.builderMember.create({ data: { builderId, userId: owner.id, role: "OWNER" } });
    projectId = (
      await db.project.create({
        data: { builderId, name: "Green Valley", slug: "gv", type: "PLOTTED", status: "LIVE" },
      })
    ).id;
    const other = await db.builder.create({
      data: { companyName: "Other", status: "VERIFIED", slug: "other" },
    });
    otherProjectId = (
      await db.project.create({
        data: {
          builderId: other.id,
          name: "Elsewhere",
          slug: "el",
          type: "PLOTTED",
          status: "LIVE",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("counts every event, even when hundreds arrive at once", async () => {
    await Promise.all(
      Array.from({ length: 60 }, () =>
        recordStat(db, { projectId, event: "VIEW", source: "search", now: NOW }),
      ),
    );
    await recordStat(db, { projectId, event: "VIEW", source: "home", now: NOW });
    const rows = await db.projectDailyStat.findMany({ where: { projectId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "search")?.count).toBe(60);
  });

  it("keeps days apart, by Indian time", async () => {
    await recordStat(db, { projectId, event: "VIEW", now: new Date("2026-11-10T20:00:00Z") }); // already 11 Nov in India
    await recordStat(db, { projectId, event: "VIEW", now: new Date("2026-11-10T10:00:00Z") });
    const days = (
      await db.projectDailyStat.findMany({ where: { projectId }, orderBy: { day: "asc" } })
    ).map((r) => r.day.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("adds up totals, the daily series, projects, sources and the funnel for one company only", async () => {
    await recordStat(db, { projectId, event: "VIEW", source: "search", now: NOW });
    await recordStat(db, { projectId, event: "VIEW", source: "search", now: NOW });
    await recordStat(db, {
      projectId,
      event: "VIEW",
      source: "direct",
      now: new Date(NOW.getTime() - 2 * DAY),
    });
    await recordStat(db, { projectId, event: "ENQUIRY", now: NOW });
    await recordStat(db, { projectId, event: "VISIT", now: NOW });
    await recordStat(db, { projectId, event: "CALL", now: NOW });
    await recordStat(db, { projectId, event: "VIEW", now: new Date(NOW.getTime() - 40 * DAY) }); // outside 30 days
    for (let i = 0; i < 9; i++)
      await recordStat(db, { projectId: otherProjectId, event: "VIEW", now: NOW });

    const stats = await statsForBuilder(db, builderId, { now: NOW });
    expect(stats.totals).toMatchObject({ VIEW: 3, ENQUIRY: 1, VISIT: 1, CALL: 1 });
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1)).toEqual({ day: "2026-11-10", views: 2, enquiries: 1 });
    expect(stats.daily.find((d) => d.day === "2026-11-08")?.views).toBe(1);
    expect(stats.perProject).toEqual([expect.objectContaining({ name: "Green Valley" })]);
    expect(stats.perProject[0].totals.VIEW).toBe(3);
    expect(stats.sources).toEqual([
      { source: "direct", label: "Direct or shared link", views: 1 },
      { source: "search", label: "Search results", views: 2 },
    ]);
    expect(stats.funnel).toMatchObject({ views: 3, enquiries: 1, visits: 1 });
  });

  it("counts booked leads in the funnel", async () => {
    const buyer = await db.user.create({ data: { auth0Sub: "auth0|b", email: "b@test.example" } });
    await db.lead.create({
      data: {
        projectId,
        builderId,
        buyerId: buyer.id,
        name: "A",
        mobile: "9876543210",
        email: "b@test.example",
        status: "BOOKED",
        consentAt: NOW,
        consentTermsVersion: "v1",
        updatedAt: NOW,
      },
    });
    expect((await statsForBuilder(db, builderId, { now: NOW })).funnel.booked).toBe(1);
  });

  it("counts a saved project once per person", async () => {
    const buyer = await db.user.create({ data: { auth0Sub: "auth0|b", email: "b@test.example" } });
    for (let i = 0; i < 3; i++)
      await setShortlisted(db, { userId: buyer.id, projectId, saved: true });
    await setShortlisted(db, { userId: buyer.id, projectId, saved: false });
    await setShortlisted(db, { userId: buyer.id, projectId, saved: true });
    const total = (
      await db.projectDailyStat.aggregate({
        where: { projectId, event: "SHORTLIST" },
        _sum: { count: true },
      })
    )._sum.count;
    expect(total).toBe(2); // saved, removed, saved again: two saves, never a repeat press
  });

  it("exports a CSV in which nothing a company typed can run as a formula", async () => {
    await db.project.update({
      where: { id: projectId },
      data: { name: '=HYPERLINK("http://evil")' },
    });
    await recordStat(db, { projectId, event: "VIEW", source: "search", now: NOW });
    const csv = await statsToCsv(db, builderId, { now: NOW });
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("Date,Project,Event,Source,Count");
    expect(row.startsWith("2026-11-10,\"'=HYPERLINK(")).toBe(true);
    expect(row.endsWith(",view,search,1")).toBe(true);
    expect(csv).not.toContain("Elsewhere");
  });

  describe("the monthly performance email", () => {
    const plan = (plan: "STARTER" | "GROWTH", end = new Date(NOW.getTime() + 20 * DAY)) =>
      db.subscription.upsert({
        where: { builderId },
        create: {
          builderId,
          plan,
          interval: "MONTHLY",
          source: "COMP",
          currentPeriodStart: new Date(NOW.getTime() - 10 * DAY),
          currentPeriodEnd: end,
        },
        update: { plan, currentPeriodEnd: end },
      });
    let sent: MailMessage[];
    const send = async (m: MailMessage) => {
      sent.push(m);
    };
    beforeEach(() => {
      sent = [];
    });

    it("sends last month's numbers once to a company whose plan has analytics", async () => {
      await plan("GROWTH");
      await recordStat(db, { projectId, event: "VIEW", now: new Date("2026-10-15T06:00:00Z") });
      await recordStat(db, { projectId, event: "VIEW", now: new Date("2026-10-16T06:00:00Z") });
      await recordStat(db, { projectId, event: "ENQUIRY", now: new Date("2026-10-16T06:00:00Z") });
      await recordStat(db, { projectId, event: "VIEW", now: new Date("2026-11-02T06:00:00Z") }); // this month: not counted
      expect(await sendMonthlyReports(db, NOW, send)).toEqual({ reported: 1 });
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toContain("October 2026");
      expect(sent[0].text).toContain("Page views: 2");
      expect(sent[0].text).toContain("Enquiries: 1");
      expect(sent[0].text).toContain("Green Valley (2 views)");
      expect(sent[0].to).toEqual(["owner@test.example"]);
    });

    it("sends once however often it runs, even at the same moment", async () => {
      await plan("GROWTH");
      await Promise.all([
        sendMonthlyReports(db, NOW, send),
        sendMonthlyReports(db, NOW, send),
        sendMonthlyReports(db, NOW, send),
      ]);
      await sendMonthlyReports(db, new Date(NOW.getTime() + DAY), send);
      expect(sent).toHaveLength(1);
      // next month it is sent again
      await sendMonthlyReports(db, new Date("2026-12-03T06:00:00Z"), send);
      expect(sent).toHaveLength(2);
      expect(sent[1].subject).toContain("November 2026");
    });

    it("does not send to a company without analytics, without a plan, or past its grace", async () => {
      await plan("STARTER");
      expect(await sendMonthlyReports(db, NOW, send)).toEqual({ reported: 0 });
      await plan("GROWTH", new Date(NOW.getTime() - 5 * DAY));
      expect(await sendMonthlyReports(db, NOW, send)).toEqual({ reported: 0 });
      await db.subscription.delete({ where: { builderId } });
      expect(await sendMonthlyReports(db, NOW, send)).toEqual({ reported: 0 });
      expect(sent).toHaveLength(0);
    });
  });
});
