import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { MailMessage } from "@/lib/mail";
import {
  MAX_PER_DAY,
  deleteProgress,
  listProgress,
  notifyShortlisters,
  postProgress,
} from "@/lib/progress/service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T06:00:00.000Z");
const HOUR = 3_600_000;

describe.skipIf(!url)("construction progress (real Postgres)", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  let builderId: string;
  let projectId: string;
  let sent: MailMessage[];
  const send = async (message: MailMessage) => {
    sent.push(message);
  };

  beforeEach(async () => {
    sent = [];
    await db.auditLog.deleteMany();
    await db.project.deleteMany();
    await db.builder.deleteMany();
    await db.user.deleteMany();
    builderId = (
      await db.builder.create({
        data: { companyName: "Anand Realty", status: "VERIFIED", slug: "anand" },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { builderId, name: "Green Valley", slug: "gv", type: "PLOTTED", status: "LIVE" },
      })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const post = (over: Record<string, unknown> = {}) =>
    postProgress(db, {
      projectId,
      builderId,
      actorId: "u",
      note: "Roads laid in phase one.",
      now: NOW,
      ...over,
    } as Parameters<typeof postProgress>[1]);
  const saver = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const user = await db.user.create({
        data: { auth0Sub: `auth0|s${i}`, email: `s${i}@test.example` },
      });
      await db.shortlist.create({ data: { userId: user.id, projectId } });
    }
  };

  describe("posting", () => {
    it("adds a dated note to a live project", async () => {
      const result = await post({ photoKey: "builders/x/public/projects/p/progress-1.jpg" });
      expect(result.ok && result.update).toMatchObject({
        note: "Roads laid in phase one.",
        createdAt: NOW,
      });
      expect(await db.auditLog.count({ where: { action: "progress.posted" } })).toBe(1);
      const listed = await listProgress(db, projectId);
      expect(listed.map((u) => u.note)).toEqual(["Roads laid in phase one."]);
    });

    it("refuses a note that is too short or too long", async () => {
      expect(await post({ note: "ok" })).toMatchObject({ ok: false, code: "invalid" });
      expect(await post({ note: "x".repeat(501) })).toMatchObject({ ok: false, code: "invalid" });
      expect(await post({ note: "   \n  " })).toMatchObject({ ok: false, code: "invalid" });
      expect(await db.progressUpdate.count()).toBe(0);
    });

    it("is only for a live project of the company", async () => {
      await db.project.update({ where: { id: projectId }, data: { status: "PAUSED" } });
      expect(await post()).toMatchObject({ ok: false, code: "not_found" });
      await db.project.update({ where: { id: projectId }, data: { status: "LIVE" } });
      const other = await db.builder.create({ data: { companyName: "Other", status: "VERIFIED" } });
      expect(await post({ builderId: other.id })).toMatchObject({ ok: false, code: "not_found" });
    });

    it("limits a project to a handful of updates a day", async () => {
      for (let i = 0; i < MAX_PER_DAY; i++) expect((await post()).ok).toBe(true);
      expect(await post()).toMatchObject({ ok: false, code: "too_many" });
      expect((await post({ now: new Date(NOW.getTime() + 25 * HOUR) })).ok).toBe(true);
    });

    it("stores markup as text, untouched", async () => {
      const result = await post({ note: "<img src=x onerror=alert(1)> done" });
      expect(result.ok && result.update.note).toBe("<img src=x onerror=alert(1)> done");
    });

    it("lists the newest first, at most the number asked for", async () => {
      for (let i = 0; i < 4; i++)
        await post({ note: `Update number ${i}`, now: new Date(NOW.getTime() + i * 26 * HOUR) });
      expect((await listProgress(db, projectId, 2)).map((u) => u.note)).toEqual([
        "Update number 3",
        "Update number 2",
      ]);
    });
  });

  describe("deleting", () => {
    it("removes the company's own update and says which photo to remove", async () => {
      const result = await post({ photoKey: "k.jpg" });
      if (!result.ok) throw new Error("setup");
      expect(
        await deleteProgress(db, { updateId: result.update.id, builderId, actorId: "u" }),
      ).toEqual({ ok: true, photoKey: "k.jpg" });
      expect(await db.progressUpdate.count()).toBe(0);
    });
    it("cannot delete another company's update", async () => {
      const result = await post();
      if (!result.ok) throw new Error("setup");
      const other = await db.builder.create({ data: { companyName: "Other", status: "VERIFIED" } });
      expect(
        await deleteProgress(db, { updateId: result.update.id, builderId: other.id, actorId: "u" }),
      ).toEqual({ ok: false, photoKey: null });
      expect(await db.progressUpdate.count()).toBe(1);
    });
  });

  describe("telling the people who saved the project", () => {
    it("emails each of them, separately, once", async () => {
      await saver(3);
      const result = await post();
      if (!result.ok) throw new Error("setup");
      expect(await notifyShortlisters(db, result.update.id, send, NOW)).toEqual({ emailed: 3 });
      expect(sent).toHaveLength(3);
      for (const message of sent) expect(Array.isArray(message.to)).toBe(false);
      expect(sent.map((m) => m.to).sort()).toEqual([
        "s0@test.example",
        "s1@test.example",
        "s2@test.example",
      ]);
      expect(sent[0].subject).toContain("Green Valley");
      expect(sent[0].text).toContain("Roads laid in phase one.");
      expect(sent[0].text).toContain("/project/gv#progress");
      expect(
        (await db.progressUpdate.findUniqueOrThrow({ where: { id: result.update.id } }))
          .notifiedCount,
      ).toBe(3);
    });

    it("sends nothing the second time, or when run twice at once", async () => {
      await saver(2);
      const result = await post();
      if (!result.ok) throw new Error("setup");
      await Promise.all([
        notifyShortlisters(db, result.update.id, send, NOW),
        notifyShortlisters(db, result.update.id, send, NOW),
        notifyShortlisters(db, result.update.id, send, NOW),
      ]);
      await notifyShortlisters(db, result.update.id, send, NOW);
      expect(sent).toHaveLength(2);
    });

    it("sends at most one email a day for a project, however many updates", async () => {
      await saver(2);
      const first = await post();
      const second = await post({
        note: "Street lights fitted today.",
        now: new Date(NOW.getTime() + HOUR),
      });
      if (!first.ok || !second.ok) throw new Error("setup");
      await notifyShortlisters(db, first.update.id, send, NOW);
      expect(
        await notifyShortlisters(db, second.update.id, send, new Date(NOW.getTime() + HOUR)),
      ).toEqual({ emailed: 0 });
      expect(sent).toHaveLength(2);
      const third = await post({
        note: "Next day: park landscaped.",
        now: new Date(NOW.getTime() + 26 * HOUR),
      });
      if (!third.ok) throw new Error("setup");
      expect(
        await notifyShortlisters(db, third.update.id, send, new Date(NOW.getTime() + 26 * HOUR)),
      ).toEqual({ emailed: 2 });
    });

    it("emails nobody when nobody saved the project", async () => {
      const result = await post();
      if (!result.ok) throw new Error("setup");
      expect(await notifyShortlisters(db, result.update.id, send, NOW)).toEqual({ emailed: 0 });
      expect(sent).toHaveLength(0);
    });

    it("keeps going when one email fails", async () => {
      await saver(3);
      const result = await post();
      if (!result.ok) throw new Error("setup");
      let calls = 0;
      const flaky = async (message: MailMessage) => {
        calls++;
        if (calls === 2) throw new Error("bounced");
        sent.push(message);
      };
      expect(await notifyShortlisters(db, result.update.id, flaky, NOW)).toEqual({ emailed: 2 });
      expect(sent).toHaveLength(2);
    });

    it("stops at the cap on the number of people", async () => {
      await saver(205);
      const result = await post();
      if (!result.ok) throw new Error("setup");
      expect((await notifyShortlisters(db, result.update.id, send, NOW)).emailed).toBe(200);
    });
  });
});
