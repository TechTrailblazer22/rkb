import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/billing/invoice-view";
import { PrintButton } from "@/components/billing/print-button";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";

export const metadata = { title: "Invoice", robots: { index: false } };

export default async function InvoicePage({ params }: PageProps<"/portal/billing/invoices/[id]">) {
  const { id } = await params;
  const ctx = await requireBuilderContext(`/portal/billing/invoices/${id}`, { ownerOnly: true });
  // The company comes from the login, so another company's invoice id is simply not found.
  const invoice = await getDb().invoice.findFirst({ where: { id, builderId: ctx.builder.id } });
  if (!invoice) notFound();

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/portal/billing" className="text-sm font-semibold text-teal-700 underline">
          Back to billing
        </Link>
        <PrintButton />
      </div>
      <InvoiceView invoice={invoice} />
    </div>
  );
}
