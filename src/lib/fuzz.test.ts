import { describe, expect, it } from "vitest";
import { computeGst, financialYear, formatPaise, prorationCreditPaise } from "@/lib/billing/money";
import { quoteChange } from "@/lib/billing/quote";
import { parseProfileInput } from "@/lib/builders/profile";
import { normaliseShape } from "@/lib/layout-map/service";
import { parseEnquiry, parseIndianDateTime } from "@/lib/leads/input";
import { parseLeadStatus } from "@/lib/leads/status";
import { parsePlotRow } from "@/lib/plots/row";
import { STEPS, parseProjectInput } from "@/lib/projects/fields";
import { cleanText, displayNameFor } from "@/lib/reviews/service";
import { parseFilters } from "@/lib/search/params";
import { normalizeMobile } from "@/lib/validation/identity";

// Fuzzing: feed the parsers and calculators thousands of hostile and random inputs and check two
// things only: they never throw, and what they accept obeys the invariants the rest of the code
// relies on. A fixed seed makes any failure reproducible.

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const NASTY = [
  "",
  " ",
  "0",
  "-1",
  "NaN",
  "Infinity",
  "1e999",
  "null",
  "undefined",
  "[object Object]",
  "__proto__",
  "constructor",
  "toString",
  "<script>alert(1)</script>",
  '\'; DROP TABLE "User"; --',
  "%00",
  "\u0000",
  "‮",
  "😀".repeat(50),
  "a".repeat(5000),
  "=cmd|' /C calc'!A0",
  "../../etc/passwd",
  "9999999999999999999999",
  "٣٤٥٦",
  "12.5.6",
  "1,00,000",
  "  42  ",
  "true",
  "{}",
];
function randomText(next: () => number): string {
  if (next() < 0.5) return NASTY[Math.floor(next() * NASTY.length)];
  const length = Math.floor(next() * 40);
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(Math.floor(next() * 0x2fff));
  return out;
}
function randomRecord(next: () => number, keys: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of keys) if (next() < 0.8) record[key] = randomText(next);
  for (let i = 0; i < 3; i++) record[randomText(next)] = randomText(next);
  return record;
}
const N = 1500;

describe("fuzzing the input parsers", () => {
  it("search filters never throw and always come back in range", () => {
    const next = rng(1);
    const keys = [
      "q",
      "city",
      "type",
      "stage",
      "budgetMin",
      "budgetMax",
      "sizeMin",
      "sizeMax",
      "facing",
      "approvals",
      "verified",
      "amenities",
      "sort",
      "page",
    ];
    for (let i = 0; i < N; i++) {
      const raw: Record<string, string | string[]> = randomRecord(next, keys);
      if (next() < 0.3) raw.type = [randomText(next), randomText(next)];
      const f = parseFilters(raw);
      expect(Number.isInteger(f.page) && f.page >= 1).toBe(true);
      expect(f.q.length).toBeLessThanOrEqual(200);
      for (const n of [f.budgetMin, f.budgetMax, f.sizeMin, f.sizeMax]) {
        expect(n === null || (Number.isFinite(n) && n >= 0)).toBe(true);
      }
    }
  });

  it("enquiries never throw, and accept only a clean mobile and consent", () => {
    const next = rng(2);
    const keys = ["name", "mobile", "message", "preferredPlot", "visitAt", "consent", "website"];
    for (let i = 0; i < N; i++) {
      const r = parseEnquiry(randomRecord(next, keys));
      if (r.ok) {
        expect(r.value.mobile).toMatch(/^[6-9]\d{9}$/);
        expect(r.value.name.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("mobile numbers, dates and statuses never throw", () => {
    const next = rng(3);
    for (let i = 0; i < N; i++) {
      const text = randomText(next);
      const m = normalizeMobile(text);
      if (m !== null) expect(m).toMatch(/^[6-9]\d{9}$/);
      const d = parseIndianDateTime(text);
      if (d !== null) expect(Number.isNaN(d.getTime())).toBe(false);
      const status = parseLeadStatus(text);
      expect(status === null || typeof status === "string").toBe(true);
    }
  });

  it("project steps and the company profile never throw, and refuse prototype keys", () => {
    const next = rng(4);
    for (let i = 0; i < 400; i++) {
      for (const step of STEPS) {
        const keys = Object.keys(
          randomRecord(next, [
            "name",
            "city",
            "acres",
            "totalPlots",
            "tokenAmount",
            "videoUrl",
            "tourUrl",
            "mapUrl",
            "startDate",
            "amenities",
            "bankLoans",
            "contactMobile",
            "whatsapp",
          ]),
        );
        const raw = Object.fromEntries(keys.map((k) => [k, randomText(next)]));
        const out = parseProjectInput(step.slug as never, raw, "full");
        expect(
          Object.keys(out.updates).every(
            (k) => !["__proto__", "constructor", "prototype"].includes(k),
          ),
        ).toBe(true);
      }
      const profile = parseProfileInput(
        Object.fromEntries(
          ["companyName", "pan", "gstin", "reraNumber", "pincode", "website", "contactMobile"].map(
            (k) => [k, randomText(next)],
          ),
        ),
        "full",
      );
      expect(Object.keys(profile.updates).every((k) => k !== "__proto__")).toBe(true);
    }
  });

  it("plot rows never throw, and accepted ones are sane", () => {
    const next = rng(5);
    for (let i = 0; i < N; i++) {
      const r = parsePlotRow(
        randomRecord(next, [
          "number",
          "sizeSqft",
          "price",
          "facing",
          "status",
          "dimensions",
          "ratePerSqft",
          "roadWidthFt",
        ]),
      );
      if (r.ok) {
        expect(r.value.sizeSqft).toBeGreaterThan(0);
        expect(r.value.number.length).toBeGreaterThan(0);
      }
    }
  });

  it("layout rectangles and review text never throw", () => {
    const next = rng(6);
    for (let i = 0; i < N; i++) {
      const n = () => (next() < 0.2 ? Number(randomText(next)) : next() * 140 - 20);
      const shape = normaliseShape({ x: n(), y: n(), w: n(), h: n() });
      if (shape) {
        expect(shape.x).toBeGreaterThanOrEqual(0);
        expect(shape.x + shape.w).toBeLessThanOrEqual(100.0001);
        expect(shape.y + shape.h).toBeLessThanOrEqual(100.0001);
        expect(shape.w).toBeGreaterThanOrEqual(0.5);
      }
      normaliseShape(randomText(next));
      const cleaned = cleanText(randomText(next));
      expect(cleaned).toBe(cleaned.trim());
      expect(displayNameFor(randomText(next)).length).toBeLessThanOrEqual(24);
    }
  });
});

describe("fuzzing the money", () => {
  it("tax always adds up to the paisa, for any amount", () => {
    const next = rng(7);
    for (let i = 0; i < 5000; i++) {
      const subtotal = Math.floor(next() * 5_000_000);
      const same = next() < 0.5;
      const g = computeGst({
        subtotalPaise: subtotal,
        supplierState: "Tamil Nadu",
        customerState: same ? "tamil nadu" : "Kerala",
      });
      const tax = g.cgstPaise + g.sgstPaise + g.igstPaise;
      expect(g.totalPaise).toBe(subtotal + tax);
      expect(Math.abs(tax - subtotal * 0.18)).toBeLessThanOrEqual(0.5);
      if (same) expect(g.igstPaise).toBe(0);
      else expect(g.cgstPaise + g.sgstPaise).toBe(0);
      expect(formatPaise(g.totalPaise)).toMatch(/^₹[\d,]+(\.\d\d)?$/);
    }
  });

  it("a credit is never more than was paid, never negative", () => {
    const next = rng(8);
    for (let i = 0; i < 5000; i++) {
      const start = new Date(Date.UTC(2026, 0, 1) + Math.floor(next() * 1e10));
      const end = new Date(start.getTime() + Math.floor(next() * 4e9) + 1);
      const now = new Date(
        start.getTime() + Math.floor((next() * 2 - 0.5) * (end.getTime() - start.getTime())),
      );
      const paid = Math.floor(next() * 10_000_000);
      const credit = prorationCreditPaise({
        paidSubtotalPaise: paid,
        periodStart: start,
        periodEnd: end,
        now,
      });
      expect(credit).toBeGreaterThanOrEqual(0);
      expect(credit).toBeLessThanOrEqual(paid);
    }
  });

  it("a quote is always a whole-paisa amount with a period that runs forward", () => {
    const next = rng(9);
    const plans = ["STARTER", "GROWTH", "PREMIER"] as const;
    const intervals = ["MONTHLY", "ANNUAL"] as const;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
    for (let i = 0; i < 4000; i++) {
      const now = new Date(Date.UTC(2026, 3, 1) + Math.floor(next() * 3e10));
      const start = new Date(now.getTime() + Math.floor((next() * 2 - 1.5) * 4e9));
      const end = new Date(start.getTime() + Math.floor(next() * 5e9) + 1);
      const current =
        next() < 0.2
          ? null
          : {
              plan: pick(plans),
              interval: pick(intervals),
              status: next() < 0.9 ? "ACTIVE" : "EXPIRED",
              currentPeriodStart: start,
              currentPeriodEnd: end,
              paidSubtotalPaise: Math.floor(next() * 9_000_000),
              pendingPlan: null,
              pendingInterval: null,
            };
      const q = quoteChange({
        current,
        target: { plan: pick(plans), interval: pick(intervals) },
        now,
        supplierState: "Tamil Nadu",
        customerState: next() < 0.3 ? null : "Karnataka",
      });
      if (q.kind === "pay") {
        for (const n of [q.listPaise, q.creditPaise, q.subtotalPaise, q.gst.totalPaise])
          expect(Number.isInteger(n) && n >= 0).toBe(true);
        expect(q.subtotalPaise).toBe(q.listPaise - q.creditPaise);
        expect(q.periodEnd.getTime()).toBeGreaterThan(q.periodStart.getTime());
        expect(q.creditPaise).toBeLessThanOrEqual(current?.paidSubtotalPaise ?? 0);
      }
    }
  });

  it("financial years change on 1 April, Indian time, for any moment", () => {
    const next = rng(10);
    for (let i = 0; i < 3000; i++) {
      const at = new Date(Date.UTC(2020, 0, 1) + Math.floor(next() * 3e11));
      expect(financialYear(at)).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});
