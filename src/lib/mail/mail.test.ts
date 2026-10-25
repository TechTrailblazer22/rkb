import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseMailDriver, sendMail } from "@/lib/mail";
import {
  builderApprovedMail,
  builderChangesRequestedMail,
  builderRejectedMail,
  builderSubmittedMail,
  adminNewSubmissionMail,
  escapeHtml,
} from "@/lib/mail/templates";

describe("chooseMailDriver", () => {
  it("honours an explicit choice", () => {
    expect(chooseMailDriver({ MAIL_DRIVER: "file", NODE_ENV: "production" })).toBe("file");
    expect(chooseMailDriver({ MAIL_DRIVER: "none" })).toBe("none");
  });

  it("uses Resend when a key is present", () => {
    expect(chooseMailDriver({ RESEND_API_KEY: "re_123", NODE_ENV: "production" })).toBe("resend");
  });

  it("uses the dev outbox outside production, and sends nothing in production without a key", () => {
    expect(chooseMailDriver({ NODE_ENV: "development" })).toBe("file");
    expect(chooseMailDriver({ NODE_ENV: "production" })).toBe("none");
  });
});

describe("templates", () => {
  it("escapes HTML in anything a user can influence", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
    const mail = builderChangesRequestedMail({
      companyName: "<b>Evil</b> Ltd",
      note: '<img src=x onerror="alert(1)">',
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>Evil");
    expect(mail.html).toContain("&lt;img");
    // the plain text version is not HTML, so it keeps the raw text
    expect(mail.text).toContain("<img");
  });

  it("includes the reviewer's note and a portal link", () => {
    const mail = builderChangesRequestedMail({
      companyName: "Anand Realty",
      note: "PAN is blurry.",
    });
    expect(mail.text).toContain("PAN is blurry.");
    expect(mail.text).toContain("/portal");
    expect(mail.html).toContain("PAN is blurry.");
  });

  it("copes with a missing company name", () => {
    expect(builderSubmittedMail({ companyName: null }).text).toContain("your company");
    expect(builderApprovedMail({ companyName: "  " }).text).toContain("your company");
  });

  it("keeps the whole message in both rejection formats", () => {
    const mail = builderRejectedMail({ companyName: "X Ltd", note: "Documents did not match." });
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Documents did not match.");
      expect(body).toContain("reply to this email");
    }
  });

  it("links admins straight to the application", () => {
    const mail = adminNewSubmissionMail({
      companyName: "Anand Realty",
      ownerEmail: "a@x.com",
      builderId: "abc123",
    });
    expect(mail.text).toContain("/admin/builders/abc123");
    expect(mail.subject).toContain("Anand Realty");
  });
});

describe("sendMail (dev outbox)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "rkb-mail-"));
    vi.stubEnv("MAIL_DRIVER", "file");
    vi.stubEnv("MAIL_OUTBOX_DIR", dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("appends one JSON line per message", async () => {
    await sendMail({ to: "a@x.com", subject: "One", text: "t1", html: "<p>1</p>" });
    await sendMail({ to: ["b@x.com", "c@x.com"], subject: "Two", text: "t2", html: "<p>2</p>" });
    const lines = (await readFile(path.join(dir, "mail-outbox.jsonl"), "utf8")).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).subject)).toEqual(["One", "Two"]);
    expect(JSON.parse(lines[1]).to).toEqual(["b@x.com", "c@x.com"]);
  });

  it("does nothing when there are no recipients", async () => {
    await sendMail({ to: [], subject: "Nobody", text: "", html: "" });
    await expect(readFile(path.join(dir, "mail-outbox.jsonl"), "utf8")).rejects.toThrow();
  });

  it("never throws, even when the driver fails", async () => {
    // A folder cannot be created inside a regular file, so writing the outbox must fail.
    const blocker = path.join(dir, "not-a-folder");
    await writeFile(blocker, "x");
    vi.stubEnv("MAIL_OUTBOX_DIR", path.join(blocker, "sub"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendMail({ to: "a@x.com", subject: "x", text: "x", html: "x" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
