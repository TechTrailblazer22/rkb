const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Exact rupees with Indian digit grouping: 1234567 -> "₹12,34,567". */
export function formatRupees(amount: number): string {
  return `₹${inr.format(Math.round(amount))}`;
}

/** Property-style short prices: 4500000 -> "₹45 L", 12000000 -> "₹1.2 Cr". */
export function formatRupeesCompact(amount: number): string {
  if (amount >= 1e7) return `₹${trim(amount / 1e7)} Cr`;
  if (amount >= 1e5) return `₹${trim(amount / 1e5)} L`;
  return formatRupees(amount);
}
