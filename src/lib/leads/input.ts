import { normalizeMobile } from "@/lib/validation/identity";

// Checks what a buyer typed into the enquiry form. Pure: no database, no clock except the one passed
// in, so every rule can be tested.

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const MESSAGE_MAX = 1000;
export const PLOT_MAX = 40;
/** A site visit can be asked for at most this far ahead. */
export const VISIT_MAX_DAYS = 90;
/** ... and at least this far ahead, so the builder has time to see the request. */
export const VISIT_MIN_MINUTES = 60;

export type EnquiryFields = {
  name: string;
  /** Ten digits, without +91. */
  mobile: string;
  message: string | null;
  preferredPlot: string | null;
  /** The requested site visit, as a moment in time. */
  visitAt: Date | null;
};

export type EnquiryParse =
  | { ok: true; value: EnquiryFields }
  | { ok: false; errors: Record<string, string>; spam?: boolean };

type Raw = Record<string, FormDataEntryValue | string | null | undefined>;

const text = (raw: Raw, key: string) => {
  const value = raw[key];
  return typeof value === "string" ? value : "";
};

/** Letters, digits and ordinary punctuation; no control characters. */
function clean(value: string, keepNewlines: boolean): string {
  const withoutControls = keepNewlines
    ? value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "")
    : value.replace(/[\u0000-\u001f\u007f]/g, " ");
  return keepNewlines ? withoutControls.trim() : withoutControls.replace(/\s+/g, " ").trim();
}

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * A `datetime-local` value ("2026-11-03T10:30") is a wall-clock time with no zone. This product is
 * for India, so it is read as Indian time (UTC+5:30), whatever zone the server runs in.
 */
export function parseIndianDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000);
  // Reject 31 February and the like: the date must read back the same.
  const back = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return date;
}

export function parseEnquiry(raw: Raw, now: Date = new Date()): EnquiryParse {
  // A field real visitors never see. A bot that fills in every field fills this one too.
  if (text(raw, "website").trim() !== "") return { ok: false, errors: {}, spam: true };

  const errors: Record<string, string> = {};

  const name = clean(text(raw, "name"), false);
  if (name.length < NAME_MIN) errors.name = "Please enter your name.";
  else if (name.length > NAME_MAX) errors.name = `Your name can be at most ${NAME_MAX} characters.`;

  const mobile = normalizeMobile(text(raw, "mobile"));
  if (!mobile) errors.mobile = "Enter a valid 10 digit Indian mobile number.";

  const message = clean(text(raw, "message"), true);
  if (message.length > MESSAGE_MAX) {
    errors.message = `Your message can be at most ${MESSAGE_MAX} characters.`;
  }

  const preferredPlot = clean(text(raw, "preferredPlot"), false);
  if (preferredPlot.length > PLOT_MAX) {
    errors.preferredPlot = `The plot can be at most ${PLOT_MAX} characters.`;
  }

  let visitAt: Date | null = null;
  const visitRaw = text(raw, "visitAt").trim();
  if (visitRaw) {
    visitAt = parseIndianDateTime(visitRaw);
    if (!visitAt) errors.visitAt = "Choose a valid date and time for the visit.";
    else if (visitAt.getTime() < now.getTime() + VISIT_MIN_MINUTES * 60_000) {
      errors.visitAt = "Choose a time at least an hour from now.";
    } else if (visitAt.getTime() > now.getTime() + VISIT_MAX_DAYS * 86_400_000) {
      errors.visitAt = `Choose a date within the next ${VISIT_MAX_DAYS} days.`;
    }
  }

  if (text(raw, "consent") !== "on") {
    errors.consent = "Please tick the box to share your details with the builder.";
  }

  if (Object.keys(errors).length > 0 || !mobile) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      mobile,
      message: message || null,
      preferredPlot: preferredPlot || null,
      visitAt,
    },
  };
}
