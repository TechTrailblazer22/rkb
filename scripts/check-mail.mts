// Sends one test email through the configured mail driver, to prove Resend works.
//
//   npm run mail:check -- you@example.com
//
// With Resend's sandbox sender (no verified domain) the address must be the one you signed up
// to Resend with; anything else is rejected by Resend.
import "dotenv/config";
import { chooseMailDriver, sendMail } from "../src/lib/mail";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Usage: npm run mail:check -- you@example.com");
  process.exit(1);
}

const driver = chooseMailDriver(process.env);
console.log(`Mail driver: ${driver}`);
if (driver !== "resend") {
  console.log(
    driver === "file"
      ? "No RESEND_API_KEY set: the email is written to .data/mail-outbox.jsonl instead of being sent."
      : "No mail driver is configured, so nothing will be sent.",
  );
}

await sendMail({
  to,
  subject: "RKB Platform test email",
  text: "If you can read this, email sending works.",
  html: "<p>If you can read this, <strong>email sending works</strong>.</p>",
});
console.log("Done. sendMail never throws: if you saw an error above, sending failed.");
