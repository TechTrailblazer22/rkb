import { getSiteUrl } from "@/lib/site";

export type MailContent = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function url(path: string): string {
  return new URL(path, getSiteUrl()).toString();
}

// One simple, safe wrapper. Everything that came from a user goes through escapeHtml first.
function layout(options: {
  heading: string;
  paragraphs: string[];
  note?: string;
  button?: { label: string; href: string };
}): string {
  const body = options.paragraphs
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`)
    .join("");
  const note = options.note
    ? `<blockquote style="margin:0 0 18px;padding:12px 16px;background:#f3f6fa;border-left:4px solid #f5a300;white-space:pre-wrap">${escapeHtml(options.note)}</blockquote>`
    : "";
  const button = options.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(options.button.href)}" style="background:#0b7d75;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(options.button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#0b2545">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#0b2545;color:#ffffff;padding:16px 24px;border-radius:12px 12px 0 0;font-weight:700"><span style="background:#13a89e;padding:3px 9px;border-radius:6px">RKB</span> Platform</div>
<div style="background:#ffffff;padding:24px;border-radius:0 0 12px 12px">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(options.heading)}</h1>${body}${note}${button}
<p style="margin:24px 0 0;font-size:12px;color:#64748b">RKB Platform is a listing and booking facilitation service.</p>
</div></div></body></html>`;
}

function plain(lines: (string | undefined)[]): string {
  return lines.filter((line): line is string => line !== undefined).join("\n\n");
}

const company = (name: string | null) => name?.trim() || "your company";

export function builderSubmittedMail(input: { companyName: string | null }): MailContent {
  const name = company(input.companyName);
  const portal = url("/portal");
  return {
    subject: "We received your RKB application",
    text: plain([
      `Thank you. We received the verification application for ${name}.`,
      "Our team will review your details and documents and email you the result. This usually takes a few working days.",
      `You can follow the status here: ${portal}`,
    ]),
    html: layout({
      heading: "We received your application",
      paragraphs: [
        `Thank you. We received the verification application for ${name}.`,
        "Our team will review your details and documents and email you the result. This usually takes a few working days.",
      ],
      button: { label: "View status", href: portal },
    }),
  };
}

export function adminNewSubmissionMail(input: {
  companyName: string | null;
  ownerEmail: string;
  builderId: string;
}): MailContent {
  const name = company(input.companyName);
  const link = url(`/admin/builders/${input.builderId}`);
  return {
    subject: `New builder to verify: ${name}`,
    text: plain([`${name} (${input.ownerEmail}) submitted an application for verification.`, link]),
    html: layout({
      heading: "New builder to verify",
      paragraphs: [`${name} (${input.ownerEmail}) submitted an application for verification.`],
      button: { label: "Review application", href: link },
    }),
  };
}

export function builderChangesRequestedMail(input: {
  companyName: string | null;
  note: string;
}): MailContent {
  const name = company(input.companyName);
  const portal = url("/portal");
  return {
    subject: "Action needed on your RKB application",
    text: plain([
      `We reviewed the application for ${name} and need a few changes before we can verify it.`,
      `Reviewer's note:\n${input.note}`,
      `Update your details and submit again: ${portal}`,
    ]),
    html: layout({
      heading: "A few changes are needed",
      paragraphs: [
        `We reviewed the application for ${name} and need a few changes before we can verify it.`,
        "Reviewer's note:",
      ],
      note: input.note,
      button: { label: "Update my application", href: portal },
    }),
  };
}

export function builderApprovedMail(input: { companyName: string | null }): MailContent {
  const name = company(input.companyName);
  const portal = url("/portal");
  return {
    subject: "You are now a Verified Builder on RKB",
    text: plain([
      `Good news. ${name} is now a Verified Builder on RKB Platform.`,
      `Sign in to continue: ${portal}`,
    ]),
    html: layout({
      heading: "You're verified",
      paragraphs: [`Good news. ${name} is now a Verified Builder on RKB Platform.`],
      button: { label: "Go to my portal", href: portal },
    }),
  };
}

export function builderRejectedMail(input: {
  companyName: string | null;
  note: string;
}): MailContent {
  const name = company(input.companyName);
  return {
    subject: "Update on your RKB application",
    text: plain([
      `We are unable to verify ${name} at this time.`,
      `Reviewer's note:\n${input.note}`,
      "If you believe this is a mistake, reply to this email.",
    ]),
    html: layout({
      heading: "We could not verify your application",
      paragraphs: [
        `We are unable to verify ${name} at this time. If you believe this is a mistake, reply to this email.`,
        "Reviewer's note:",
      ],
      note: input.note,
    }),
  };
}
