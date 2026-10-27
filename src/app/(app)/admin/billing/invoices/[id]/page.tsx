import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/components/billing/invoice-view";
import { PrintButton } from "@/components/billing/print-button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const metadata = { title: "Invoice", robots: { index: false } };

export default async function AdminInvoicePage({
  params,
}: PageProps<"/admin/billing/invoices/[id]">) {
  await requireUser({ returnTo: "/admin/billing", roles: ["ADMIN"] });
  const { id } = await params;
  const invoice = await getDb().invoice.findUnique({ where: { id } });
  if (!invoice) notFound();

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/billing" className="text-sm font-semibold text-teal-700 underline">
          Back to billing
        </Link>
        <PrintButton />
      </div>
      <InvoiceView invoice={invoice} />
    </div>
  );
}
