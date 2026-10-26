import type { DocumentKind } from "@/generated/prisma/enums";

export type DocumentSpec = {
  kind: DocumentKind;
  label: string;
  help: string;
  required: boolean;
};

// "Builder verification" from the proposal: PAN and GST check, business and identity proof,
// office address check. Nothing is mandatory: a builder can submit with any of these missing and
// the reviewer decides. Set `required: true` on a document to make it a condition of submitting
// and of approval again.
export const DOCUMENT_SPECS: DocumentSpec[] = [
  {
    kind: "PAN",
    label: "PAN card (business)",
    help: "PAN of the company, firm or proprietor, matching the PAN you entered.",
    required: false,
  },
  {
    kind: "GST",
    label: "GST registration certificate",
    help: "The GST certificate showing your GSTIN and registered address.",
    required: false,
  },
  {
    kind: "BUSINESS_PROOF",
    label: "Business proof",
    help: "Certificate of incorporation, partnership deed, LLP agreement or Udyam registration.",
    required: false,
  },
  {
    kind: "IDENTITY_PROOF",
    label: "Identity proof of the signatory",
    help: "Passport, voter ID or driving licence. If you send an Aadhaar card, mask all but the last 4 digits.",
    required: false,
  },
  {
    kind: "ADDRESS_PROOF",
    label: "Office address proof",
    help: "Recent utility bill, rent agreement or property tax receipt for your office.",
    required: false,
  },
  {
    kind: "RERA",
    label: "RERA registration (builder level)",
    help: "Optional. Project-level RERA approvals are added with each project.",
    required: false,
  },
  {
    kind: "BANK_PROOF",
    label: "Cancelled cheque",
    help: "Optional for now. Needed later to receive online token payments directly in your account.",
    required: false,
  },
];

export const REQUIRED_DOCUMENT_KINDS: DocumentKind[] = DOCUMENT_SPECS.filter((d) => d.required).map(
  (d) => d.kind,
);

/**
 * Documents that still stand between a builder and approval. Nothing has to be uploaded, but a
 * document that was uploaded must be checked and approved first: the Verified badge should never
 * sit on top of a file nobody has looked at, or one that was sent back.
 */
export function unapprovedForVerification(
  documents: { kind: DocumentKind; status: string }[],
): DocumentKind[] {
  const approved = new Set(documents.filter((d) => d.status === "APPROVED").map((d) => d.kind));
  const needed = new Set<DocumentKind>(REQUIRED_DOCUMENT_KINDS);
  for (const document of documents) needed.add(document.kind);
  return [...needed].filter((kind) => !approved.has(kind));
}

export function documentLabel(kind: DocumentKind): string {
  return DOCUMENT_SPECS.find((d) => d.kind === kind)?.label ?? kind;
}
