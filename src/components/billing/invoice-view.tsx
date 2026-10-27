import type { Invoice } from "@/generated/prisma/client";
import type { BillTo, Supplier } from "@/lib/billing/subscriptions";
import { supplierFromEnv } from "@/lib/billing/subscriptions";
import { formatPaise } from "@/lib/billing/money";
import { formatDate } from "@/lib/leads/format";

/** A tax invoice, laid out to print. Everything on it comes from the stored invoice. */
export function InvoiceView({ invoice }: { invoice: Invoice }) {
  const billTo = invoice.billTo as unknown as BillTo;
  // Invoices made before the supplier was stored fall back to today's configuration.
  const supplier = (invoice.supplier as unknown as Supplier | null) ?? supplierFromEnv();
  const place = [billTo.address, billTo.city, billTo.state, billTo.pincode]
    .filter(Boolean)
    .join(", ");
  const interval = invoice.interval === "ANNUAL" ? "year" : "month";
  const taxLines: [string, number][] =
    invoice.igstPaise > 0
      ? [["IGST 18%", invoice.igstPaise]]
      : [
          ["CGST 9%", invoice.cgstPaise],
          ["SGST 9%", invoice.sgstPaise],
        ];

  return (
    <article
      className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-sm sm:p-10 print:border-0 print:p-0"
      data-testid="invoice"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tax invoice</h1>
          <p className="mt-1 text-slate-600">
            Invoice no.{" "}
            <span className="font-semibold text-slate-900" data-testid="invoice-number">
              {invoice.number}
            </span>
          </p>
          <p className="text-slate-600">Date: {formatDate(invoice.issuedAt)}</p>
          {invoice.status !== "PAID" && (
            <p className="mt-2 inline-block rounded bg-red-50 px-2 py-1 text-xs font-bold tracking-wide text-red-700 uppercase">
              {invoice.status === "REFUNDED" ? "Refunded" : "Void"}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-bold">{supplier.name}</p>
          {supplier.address && <p className="max-w-60 text-slate-600">{supplier.address}</p>}
          <p className="text-slate-600">State: {supplier.state}</p>
          {supplier.gstin ? (
            <p className="text-slate-600">GSTIN: {supplier.gstin}</p>
          ) : (
            <p className="text-slate-500 italic">GSTIN not set</p>
          )}
        </div>
      </header>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Billed to</h2>
          <p className="mt-1 font-semibold">{billTo.name}</p>
          {place && <p className="text-slate-600">{place}</p>}
          {billTo.gstin && <p className="text-slate-600">GSTIN: {billTo.gstin}</p>}
        </div>
        <div>
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Paid by</h2>
          <p className="mt-1 capitalize">
            {invoice.paymentMethod === "comp" ? "Complimentary" : invoice.paymentMethod}
          </p>
          {invoice.paymentReference && (
            <p className="break-all text-slate-600">Reference: {invoice.paymentReference}</p>
          )}
        </div>
      </section>

      <table className="mt-8 w-full text-left">
        <thead>
          <tr className="border-b border-slate-300 text-xs tracking-wide text-slate-500 uppercase">
            <th scope="col" className="py-2 pr-2">
              Description
            </th>
            <th scope="col" className="px-2 py-2">
              SAC
            </th>
            <th scope="col" className="py-2 pl-2 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100 align-top">
            <td className="py-3 pr-2">
              {invoice.description}
              <span className="block text-xs text-slate-500">
                For one {interval}: {formatDate(invoice.periodStart)} to{" "}
                {formatDate(invoice.periodEnd)}
              </span>
            </td>
            <td className="px-2 py-3">{invoice.sac}</td>
            <td className="py-3 pl-2 text-right">{formatPaise(invoice.subtotalPaise)}</td>
          </tr>
        </tbody>
        <tfoot>
          {taxLines.map(([label, amount]) => (
            <tr key={label}>
              <td colSpan={2} className="py-1.5 pr-2 text-right text-slate-600">
                {label}
              </td>
              <td className="py-1.5 pl-2 text-right">{formatPaise(amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 text-base font-bold">
            <td colSpan={2} className="py-2 pr-2 text-right">
              Total
            </td>
            <td className="py-2 pl-2 text-right" data-testid="invoice-total">
              {formatPaise(invoice.totalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-8 text-xs text-slate-500">
        This is a computer-generated invoice and needs no signature. Amounts are in Indian rupees.
      </p>
    </article>
  );
}
