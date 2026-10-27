import type { BillingInterval, PlanCode } from "@/generated/prisma/enums";
import { GST_PERCENT, annualPrice, plans } from "@/lib/plans";

// Money is always whole paise (integers) from here on: floating point rupees would eventually lose
// a paisa on an invoice. Pure functions, no database, so every rule is tested.

export const PAISE_PER_RUPEE = 100;

export function formatPaise(paise: number): string {
  const rupees = paise / PAISE_PER_RUPEE;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The plan's price before GST, in paise, for a month or for a year (ten months' price). */
export function planSubtotalPaise(plan: PlanCode, interval: BillingInterval): number {
  const monthly = plans.find((p) => p.code === plan)?.priceMonthly;
  if (monthly === undefined) throw new Error(`Unknown plan ${plan}`);
  return (interval === "ANNUAL" ? annualPrice(monthly) : monthly) * PAISE_PER_RUPEE;
}

export type Gst = { cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number };

const normalize = (state: string | null | undefined) =>
  (state ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * GST on a taxable amount. Within the supplier's own state the tax is split into CGST and SGST
 * (half each, the odd paisa going to SGST so the parts always add up); to another state it is
 * IGST. When the customer's state is not known the supplier's state is assumed.
 */
export function computeGst(input: {
  subtotalPaise: number;
  supplierState: string;
  customerState: string | null | undefined;
  ratePercent?: number;
}): Gst {
  const rate = input.ratePercent ?? GST_PERCENT;
  const tax = Math.round((input.subtotalPaise * rate) / 100);
  const customer = normalize(input.customerState);
  const sameState = !customer || customer === normalize(input.supplierState);
  if (sameState) {
    const cgst = Math.floor(tax / 2);
    return {
      cgstPaise: cgst,
      sgstPaise: tax - cgst,
      igstPaise: 0,
      totalPaise: input.subtotalPaise + tax,
    };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise: input.subtotalPaise + tax };
}

/** A number of calendar months after a start date, never running past the end of a short month. */
export function addMonths(start: Date, months: number): Date {
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
    ),
  );
}

/** One billing period after a start date: a calendar month, or a calendar year. */
export function addInterval(start: Date, interval: BillingInterval, count = 1): Date {
  return addMonths(start, (interval === "ANNUAL" ? 12 : 1) * count);
}

/**
 * The credit for the unused part of a paid period, in paise (before GST): what was paid, times the
 * share of the period still to run, rounded down so a customer is never credited more than paid.
 */
export function prorationCreditPaise(input: {
  paidSubtotalPaise: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): number {
  const total = input.periodEnd.getTime() - input.periodStart.getTime();
  const left = input.periodEnd.getTime() - input.now.getTime();
  if (total <= 0 || left <= 0) return 0;
  if (left >= total) return input.paidSubtotalPaise;
  return Math.floor((input.paidSubtotalPaise * left) / total);
}

/** "2026-27": the Indian financial year (April to March) a date falls in, by Indian time. */
export function financialYear(date: Date): string {
  const india = new Date(date.getTime() + (5 * 60 + 30) * 60_000);
  const year = india.getUTCFullYear();
  const startYear = india.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function formatInvoiceNumber(fy: string, sequence: number): string {
  return `RKB/${fy}/${String(sequence).padStart(4, "0")}`;
}
