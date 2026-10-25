import type { DocumentKind } from "@/generated/prisma/enums";

export type DocumentSpec = {
  kind: DocumentKind;
  label: string;
  help: string;
  required: boolean;
};

// "Builder verification" from the proposal: PAN and GST check, business and identity proof,
// office address check. RERA and bank proof are optional for now: not every builder holds a
// builder-level RERA registration, and bank details are only needed when token payments start.
export const DOCUMENT_SPECS: DocumentSpec[] = [
  {
    kind: "PAN",
    label: "PAN card (business)",
    help: "PAN of the company, firm or proprietor, matching the PAN you entered.",
    required: true,
  },
  {
    kind: "GST",
    label: "GST registration certificate",
    help: "The GST certificate showing your GSTIN and registered address.",
    required: true,
  },
  {
    kind: "BUSINESS_PROOF",
    label: "Business proof",
    help: "Certificate of incorporation, partnership deed, LLP agreement or Udyam registration.",
    required: true,
  },
  {
    kind: "IDENTITY_PROOF",
    label: "Identity proof of the signatory",
    help: "Passport, voter ID or driving licence. If you send an Aadhaar card, mask all but the last 4 digits.",
    required: true,
  },
  {
    kind: "ADDRESS_PROOF",
    label: "Office address proof",
    help: "Recent utility bill, rent agreement or property tax receipt for your office.",
    required: true,
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

export function documentLabel(kind: DocumentKind): string {
  return DOCUMENT_SPECS.find((d) => d.kind === kind)?.label ?? kind;
}
