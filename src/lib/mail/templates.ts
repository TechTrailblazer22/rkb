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

// ---------- projects ----------

const projectName = (name: string | null) => name?.trim() || "your project";

export function projectSubmittedAdminMail(input: {
  projectName: string;
  companyName: string | null;
  projectId: string;
}): MailContent {
  const link = url(`/admin/projects/${input.projectId}`);
  const who = company(input.companyName);
  return {
    subject: `New project to review: ${input.projectName}`,
    text: plain([`${who} submitted the project "${input.projectName}" for review.`, link]),
    html: layout({
      heading: "New project to review",
      paragraphs: [`${who} submitted the project "${input.projectName}" for review.`],
      button: { label: "Review project", href: link },
    }),
  };
}

export function projectApprovedMail(input: {
  projectName: string | null;
  projectId: string;
}): MailContent {
  const name = projectName(input.projectName);
  const link = url(`/portal/projects/${input.projectId}/review`);
  return {
    subject: `${name} is approved`,
    text: plain([`Good news. "${name}" has been approved and is now live on RKB Platform.`, link]),
    html: layout({
      heading: "Your project is approved",
      paragraphs: [`Good news. "${name}" has been approved and is now live on RKB Platform.`],
      button: { label: "View my project", href: link },
    }),
  };
}

export function projectChangesRequestedMail(input: {
  projectName: string | null;
  projectId: string;
  note: string;
}): MailContent {
  const name = projectName(input.projectName);
  const link = url(`/portal/projects/${input.projectId}/review`);
  return {
    subject: `Changes needed on ${name}`,
    text: plain([
      `We reviewed "${name}" and need a few changes before it can go live.`,
      `Reviewer's note:
${input.note}`,
      `Update it and submit again: ${link}`,
    ]),
    html: layout({
      heading: "A few changes are needed",
      paragraphs: [
        `We reviewed "${name}" and need a few changes before it can go live.`,
        "Reviewer's note:",
      ],
      note: input.note,
      button: { label: "Update my project", href: link },
    }),
  };
}

export function projectPausedMail(input: {
  projectName: string | null;
  projectId: string;
  note: string;
}): MailContent {
  const name = projectName(input.projectName);
  const link = url(`/portal/projects/${input.projectId}/review`);
  return {
    subject: `${name} has been paused`,
    text: plain([
      `"${name}" has been taken offline for now.`,
      `Reason:
${input.note}`,
      link,
    ]),
    html: layout({
      heading: "Your project has been paused",
      paragraphs: [`"${name}" has been taken offline for now.`, "Reason:"],
      note: input.note,
      button: { label: "View my project", href: link },
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Enquiries and reminders (Phase 6)

const IST_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const istDate = (date: Date) => IST_FORMAT.format(date);

/** A WhatsApp chat with the buyer, with a first line already typed. Opens on one tap on a phone. */
export function whatsappLink(mobile: string, text: string): string {
  return `https://wa.me/91${mobile.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(text)}`;
}

export function newLeadMail(input: {
  leadId: string;
  projectName: string;
  companyName: string | null;
  buyerName: string;
  mobile: string;
  email: string;
  message: string | null;
  preferredPlot: string | null;
  visitAt: Date | null;
  /** The buyer wrote again on an enquiry that was already open. */
  repeat: boolean;
}): MailContent {
  const link = url(`/portal/leads/${input.leadId}`);
  const chat = whatsappLink(
    input.mobile,
    `Hello ${input.buyerName}, this is ${company(input.companyName)} about ${input.projectName}. Thank you for your enquiry.`,
  );
  const lines = [
    `Name: ${input.buyerName}`,
    `Mobile: ${input.mobile} (not verified yet)`,
    `Email: ${input.email}`,
    input.preferredPlot ? `Plot: ${input.preferredPlot}` : undefined,
    input.visitAt ? `Wants to visit: ${istDate(input.visitAt)}` : undefined,
  ].filter((line): line is string => line !== undefined);
  const heading = input.repeat ? "Another message from a buyer" : "New enquiry";
  return {
    subject: `${input.repeat ? "New message" : "New enquiry"} for ${input.projectName} from ${input.buyerName}`,
    text: plain([
      `${heading} about "${input.projectName}".`,
      lines.join("\n"),
      input.message ? `Message:\n${input.message}` : "No message was written.",
      `Reply on WhatsApp: ${chat}`,
      `Open the lead: ${link}`,
    ]),
    html: layout({
      heading,
      paragraphs: [`About "${input.projectName}".`, ...lines],
      note: input.message ?? "No message was written.",
      button: { label: "Open the lead", href: link },
    }).replace(
      "</div></div></body></html>",
      `<p style="margin:0 0 8px"><a href="${escapeHtml(chat)}" style="color:#0b7d75;font-weight:600">Reply on WhatsApp</a></p></div></div></body></html>`,
    ),
  };
}

export function enquirySentMail(input: {
  projectName: string;
  companyName: string | null;
}): MailContent {
  const link = url("/account/enquiries");
  const builder = company(input.companyName);
  return {
    subject: `Your enquiry about ${input.projectName} was sent`,
    text: plain([
      `We have sent your enquiry about "${input.projectName}" to ${builder}.`,
      "They will contact you on the mobile number you gave. You can follow it here:",
      link,
    ]),
    html: layout({
      heading: "Your enquiry was sent",
      paragraphs: [
        `We have sent your enquiry about "${input.projectName}" to ${builder}.`,
        "They will contact you on the mobile number you gave.",
      ],
      button: { label: "My enquiries", href: link },
    }),
  };
}

export function followUpDueMail(input: {
  companyName: string | null;
  leads: { id: string; name: string; projectName: string }[];
}): MailContent {
  const link = url("/portal/leads?due=1");
  const lines = input.leads.map((lead) => `${lead.name} (${lead.projectName})`);
  const count = input.leads.length;
  return {
    subject: `${count} ${count === 1 ? "follow-up is" : "follow-ups are"} due`,
    text: plain([`These enquiries are due for a follow-up today:`, lines.join("\n"), link]),
    html: layout({
      heading: "Follow-ups due",
      paragraphs: [`These enquiries are due for a follow-up today:`, ...lines],
      button: { label: "Open my leads", href: link },
    }),
  };
}

export function dailyDigestMail(input: {
  companyName: string | null;
  newLeads: number;
  stillNew: number;
  followUpsDue: number;
}): MailContent {
  const link = url("/portal/leads");
  const lines = [
    `${input.newLeads} new ${input.newLeads === 1 ? "enquiry" : "enquiries"} since the last summary.`,
    `${input.stillNew} ${input.stillNew === 1 ? "enquiry has" : "enquiries have"} not been contacted yet.`,
    `${input.followUpsDue} ${input.followUpsDue === 1 ? "follow-up is" : "follow-ups are"} due.`,
  ];
  return {
    subject: `Your enquiries today: ${input.newLeads} new`,
    text: plain([...lines, link]),
    html: layout({
      heading: "Your enquiries today",
      paragraphs: lines,
      button: { label: "Open my leads", href: link },
    }),
  };
}

export function approvalExpiringMail(input: {
  projectName: string | null;
  projectId: string;
  kind: string;
  daysLeft: number;
}): MailContent {
  const name = projectName(input.projectName);
  const link = url(`/portal/projects/${input.projectId}/review`);
  const when =
    input.daysLeft <= 0
      ? "at the end of today"
      : input.daysLeft === 1
        ? "tomorrow"
        : `in ${input.daysLeft} days`;
  return {
    subject: `The ${input.kind} approval for ${name} expires ${when}`,
    text: plain([
      `The ${input.kind} approval listed for "${name}" expires ${when}.`,
      "When it expires the project is taken offline until the approval is renewed and checked again.",
      link,
    ]),
    html: layout({
      heading: "An approval is about to expire",
      paragraphs: [
        `The ${input.kind} approval listed for "${name}" expires ${when}.`,
        "When it expires the project is taken offline until the approval is renewed and checked again.",
      ],
      button: { label: "Open the project", href: link },
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Plans and billing (Phases 7 and 8)

export function planEndingMail(input: {
  companyName: string | null;
  plan: string;
  daysLeft: number;
  endsOn: Date;
  willNotRenew: boolean;
}): MailContent {
  const link = url("/portal/billing");
  const plan = input.plan.charAt(0) + input.plan.slice(1).toLowerCase();
  const when = input.daysLeft <= 1 ? "tomorrow" : `in ${input.daysLeft} days`;
  const lines = [
    `The ${plan} plan for ${company(input.companyName)} ends ${when} (${istDate(input.endsOn)}).`,
    input.willNotRenew
      ? "You chose not to renew, so the extras go away when it ends. Your projects stay live. You can change your mind any time before then."
      : "Renew before then to keep the extras (more projects, video, the full lead dashboard, analytics, featured days). If the plan ends your projects stay live and nothing is deleted.",
  ];
  return {
    subject: `Your ${plan} plan ends ${when}`,
    text: plain([...lines, link]),
    html: layout({
      heading: "Your plan is about to end",
      paragraphs: lines,
      button: { label: "Renew my plan", href: link },
    }),
  };
}

export function paymentReceiptMail(input: {
  companyName: string | null;
  plan: string;
  invoiceNumber: string;
  totalText: string;
  paidUntil: Date;
  invoiceId: string;
}): MailContent {
  const link = url(`/portal/billing/invoices/${input.invoiceId}`);
  const plan = input.plan.charAt(0) + input.plan.slice(1).toLowerCase();
  const lines = [
    `We received ${input.totalText} for the ${plan} plan of ${company(input.companyName)}. Thank you.`,
    `Your plan is paid until ${istDate(input.paidUntil)}. The tax invoice is ${input.invoiceNumber}; you can view and print it from your billing page.`,
  ];
  return {
    subject: `Payment received: invoice ${input.invoiceNumber}`,
    text: plain([...lines, link]),
    html: layout({
      heading: "Payment received",
      paragraphs: lines,
      button: { label: "View the invoice", href: link },
    }),
  };
}

export function planLapsedMail(input: { companyName: string | null; plan: string }): MailContent {
  const link = url("/portal/billing");
  const plan = input.plan.charAt(0) + input.plan.slice(1).toLowerCase();
  const lines = [
    `The ${plan} plan for ${company(input.companyName)} has ended.`,
    "Your live projects stay live, and nothing was deleted. What the plan added (extra projects, video, the full lead dashboard, analytics, featured days) is switched off until you renew.",
  ];
  return {
    subject: "Your plan has ended",
    text: plain([...lines, link]),
    html: layout({
      heading: "Your plan has ended",
      paragraphs: lines,
      button: { label: "Renew my plan", href: link },
    }),
  };
}

export function teamInviteMail(input: {
  companyName: string | null;
  invitedBy: string;
  role: string;
  token: string;
}): MailContent {
  const link = url(`/join/${input.token}`);
  const lines = [
    `${input.invitedBy} has invited you to join ${company(input.companyName)} on RKB Platform as ${input.role}.`,
    "The link works for 7 days and only for this email address. Log in or create an account with this email, then accept.",
  ];
  return {
    subject: `Join ${company(input.companyName)} on RKB Platform`,
    text: plain([...lines, link]),
    html: layout({
      heading: "You are invited to a team",
      paragraphs: lines,
      button: { label: "Accept the invitation", href: link },
    }),
  };
}

export function performanceMail(input: {
  companyName: string | null;
  monthLabel: string;
  views: number;
  enquiries: number;
  contacts: number;
  saved: number;
  topProject: { name: string; views: number } | null;
}): MailContent {
  const link = url("/portal/analytics");
  const n = (value: number) => value.toLocaleString("en-IN");
  const lines = [
    `Here is how ${company(input.companyName)} did on RKB Platform in ${input.monthLabel}.`,
    `Page views: ${n(input.views)}. Enquiries: ${n(input.enquiries)}. Taps on Call or WhatsApp: ${n(input.contacts)}. Times a project was saved: ${n(input.saved)}.`,
    input.topProject && input.topProject.views > 0
      ? `Most viewed project: ${input.topProject.name} (${n(input.topProject.views)} views).`
      : "No project had any views this month.",
    "Counts only: no visitor is identified.",
  ];
  return {
    subject: `Your ${input.monthLabel} performance on RKB Platform`,
    text: plain([...lines, link]),
    html: layout({
      heading: `Your ${input.monthLabel} performance`,
      paragraphs: lines,
      button: { label: "See the full analytics", href: link },
    }),
  };
}

export function progressUpdateMail(input: {
  projectName: string;
  companyName: string | null;
  note: string;
  slug: string;
}): MailContent {
  const link = url(`/project/${input.slug}#progress`);
  const lines = [
    `${company(input.companyName)} posted an update on ${input.projectName}, a project you saved on RKB Platform:`,
    input.note,
    "You get this because you saved the project. Remove it from your saved projects to stop these emails. We send at most one a day for a project.",
  ];
  return {
    subject: `New update on ${input.projectName}`,
    text: plain([...lines, link]),
    html: layout({
      heading: `An update on ${input.projectName}`,
      paragraphs: lines,
      button: { label: "See the update", href: link },
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Online token booking (Phase 10)

export function bookingPaidBuyerMail(input: {
  projectName: string;
  companyName: string | null;
  plotNumber: string;
  tokenText: string;
  bookingId: string;
}): MailContent {
  const link = url(`/account/bookings/${input.bookingId}`);
  const lines = [
    `Your token of ${input.tokenText} for plot ${input.plotNumber} at ${input.projectName} was received, and the plot is booked in your name on RKB Platform.`,
    `${company(input.companyName)} has been told and will contact you to complete the next steps. The token is an advance paid to the builder; keep this email as your receipt.`,
  ];
  return {
    subject: `Plot ${input.plotNumber} booked at ${input.projectName}`,
    text: plain([...lines, link]),
    html: layout({
      heading: "Your plot is booked",
      paragraphs: lines,
      button: { label: "View the booking", href: link },
    }),
  };
}

export function bookingPaidBuilderMail(input: {
  projectName: string;
  plotNumber: string;
  tokenText: string;
  buyerName: string;
  buyerMobile: string;
}): MailContent {
  const link = url("/portal/bookings");
  const lines = [
    `${input.buyerName} (${input.buyerMobile}) booked plot ${input.plotNumber} at ${input.projectName} online and paid a token of ${input.tokenText}.`,
    "The plot now shows as Booked. Please contact the buyer to complete the next steps.",
  ];
  return {
    subject: `Online booking: plot ${input.plotNumber} at ${input.projectName}`,
    text: plain([...lines, link]),
    html: layout({
      heading: "A plot was booked online",
      paragraphs: lines,
      button: { label: "See your bookings", href: link },
    }),
  };
}

export function bookingRefundDueMail(input: {
  projectName: string;
  plotNumber: string;
  tokenText: string;
  reason: string | null;
}): MailContent {
  const link = url("/admin/billing");
  const lines = [
    `A token payment of ${input.tokenText} for plot ${input.plotNumber} at ${input.projectName} cannot be kept and must be refunded.`,
    input.reason ?? "The booking could not be completed.",
  ];
  return {
    subject: `Refund needed: plot ${input.plotNumber} at ${input.projectName}`,
    text: plain([...lines, link]),
    html: layout({
      heading: "A token must be refunded",
      paragraphs: lines,
      button: { label: "Open billing", href: link },
    }),
  };
}

export function bookingRefundedMail(input: {
  projectName: string;
  plotNumber: string;
  tokenText: string;
  note: string;
}): MailContent {
  const lines = [
    `Your token of ${input.tokenText} for plot ${input.plotNumber} at ${input.projectName} has been refunded to the account you paid from. Banks usually take 5 to 7 working days to show it.`,
    `Reason noted: ${input.note}`,
  ];
  return {
    subject: `Token refunded for plot ${input.plotNumber}`,
    text: plain(lines),
    html: layout({ heading: "Your token was refunded", paragraphs: lines }),
  };
}

export function bookingReconciliationMail(input: { lines: string[] }): MailContent {
  const link = url("/admin/billing");
  return {
    subject: "Bookings and payments need a look",
    text: plain([...input.lines, link]),
    html: layout({
      heading: "Bookings and payments need a look",
      paragraphs: input.lines,
      button: { label: "Open billing", href: link },
    }),
  };
}
