import { DocumentCard } from "@/components/portal/document-card";
import { requireBuilderContext } from "@/lib/builders/context";
import { DOCUMENT_SPECS } from "@/lib/builders/documents";

export const metadata = { title: "Verification documents" };

export default async function DocumentsPage() {
  const { documents, mode } = await requireBuilderContext("/portal/documents", {
    ownerOnly: true,
  });
  const byKind = new Map(documents.map((document) => [document.kind, document]));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Verification documents</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload clear photos or scans. They are stored privately and only you and our verification
          team can open them. Never upload a full Aadhaar number; mask all but the last four digits.
        </p>
      </div>

      {mode === "locked" && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
          Your documents can&apos;t be changed right now.
        </p>
      )}
      {mode === "presentation" && (
        <p className="rounded-xl bg-teal-50 p-4 text-sm text-teal-700">
          Your documents are verified and locked. Contact support if one needs replacing.
        </p>
      )}

      <ul className="space-y-4">
        {DOCUMENT_SPECS.map((spec) => {
          const document = byKind.get(spec.kind);
          return (
            <DocumentCard
              key={spec.kind}
              kind={spec.kind}
              label={spec.label}
              help={spec.help}
              required={spec.required}
              canEdit={mode === "full"}
              document={
                document
                  ? {
                      id: document.id,
                      originalName: document.originalName,
                      sizeBytes: document.sizeBytes,
                      status: document.status,
                      reviewNote: document.reviewNote,
                    }
                  : null
              }
            />
          );
        })}
      </ul>
    </div>
  );
}
