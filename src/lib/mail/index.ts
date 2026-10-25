import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { MailContent } from "@/lib/mail/templates";

export type MailMessage = MailContent & { to: string | string[] };

export type MailDriverName = "resend" | "file" | "none";

/** Explicit MAIL_DRIVER wins; otherwise Resend if a key is set; a dev outbox outside production. */
export function chooseMailDriver(env: Record<string, string | undefined>): MailDriverName {
  const explicit = env.MAIL_DRIVER;
  if (explicit === "resend" || explicit === "file" || explicit === "none") return explicit;
  if (env.RESEND_API_KEY) return "resend";
  return env.NODE_ENV === "production" ? "none" : "file";
}

// Resend's shared sandbox sender. It only delivers to the email address of your own Resend
// account, so set MAIL_FROM to an address on a domain you have verified before launch.
const DEFAULT_FROM = "RKB Platform <onboarding@resend.dev>";

async function sendWithResend(message: MailMessage): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
}

/** Development and tests: append to .data/mail-outbox.jsonl instead of sending. */
async function writeToOutbox(message: MailMessage): Promise<void> {
  const file = path.join(
    process.env.MAIL_OUTBOX_DIR ?? path.join(process.cwd(), ".data"),
    "mail-outbox.jsonl",
  );
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await appendFile(
    /*turbopackIgnore: true*/ file,
    `${JSON.stringify({ at: new Date().toISOString(), ...message })}\n`,
  );
}

/**
 * Sends a notification. It never throws: a mail outage must not make a builder's
 * "Submit" button fail after their data was already saved. Failures are logged.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  if (recipients.length === 0) return;

  const driver = chooseMailDriver(process.env);
  try {
    if (driver === "resend") await sendWithResend(message);
    else if (driver === "file") await writeToOutbox(message);
    else console.warn(`Email not sent (no mail driver configured): "${message.subject}"`);
  } catch (error) {
    console.error(`Email failed (${driver}): "${message.subject}"`, error);
  }
}
