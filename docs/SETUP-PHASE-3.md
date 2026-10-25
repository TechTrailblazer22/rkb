# Phase 3 setup: file storage and email

Builder onboarding stores uploaded documents and sends status emails. Both work locally with **no
accounts** (files go to `.data/storage`, emails are written to `.data/mail-outbox.jsonl`), so you
can use the whole feature in development right now. On Render you need two free accounts.

First apply the new database migration: `npm run db:migrate`.

## 1. Cloudinary (file storage)

Render's disk is erased on every restart, so uploaded files must live elsewhere.

1. Sign up at cloudinary.com (the free plan needs no card).
2. Dashboard > **Settings > API Keys** (or the "Programmable Media" dashboard). Copy the
   **API environment variable**. It looks like `cloudinary://123456:abcDEF@your-cloud-name`.
   It contains a secret: put it only in `.env` and Render, never in chat or git.
3. **Settings > Security**: switch on **"PDF and ZIP files delivery"**. New accounts block this by
   default, and without it PDFs upload but cannot be downloaded.
4. Put it in `.env` as `CLOUDINARY_URL="cloudinary://..."`.
5. Prove it works, from the project folder:
   ```bash
   npm run storage:check
   ```
   Every line should say PASS. The check also confirms that a private document is **not**
   reachable by an ordinary public URL.
6. On Render add `CLOUDINARY_URL` under Environment.

How privacy works: verification documents are stored with Cloudinary's "authenticated" type, so
they have no public address at all. The app hands out a link that expires after 5 minutes, and
only to the builder's own team and to admins. Logos and covers are public by design.

## 2. Resend (email)

1. Sign up at resend.com (free tier: 3,000 emails a month).
2. **API Keys > Create API Key**. Put it in `.env` as `RESEND_API_KEY="re_..."`.
3. Test it with the address you signed up to Resend with:
   ```bash
   npm run mail:check -- you@example.com
   ```
4. **Important limit.** Without a verified domain, Resend only delivers from its sandbox sender
   (`onboarding@resend.dev`) and only to **your own Resend login email**. That is enough to test
   the admin notification. To email builders you need your own domain: Resend > **Domains**, add
   it, add the DNS records Resend shows, then set `MAIL_FROM="RKB Platform <noreply@yourdomain.com>"`.
5. On Render add `RESEND_API_KEY` and `MAIL_FROM`.

Emails are best-effort. If Resend is down or not configured, builders can still submit and admins
can still decide; the failure is logged and nothing breaks.

## 3. Try the flow by hand

1. Log in as a normal user, open **List your project**, create the builder account.
2. **Company profile**: fill it in. Watch "All changes saved". Try a wrong PAN to see the message.
3. **Documents**: upload the five required files. Try uploading a `.txt` renamed to `.pdf`; it is refused.
4. **Plan**, then **Review and submit**.
5. Log in as an admin (an email in `ADMIN_EMAILS`) and open **Admin > Open the queue**.
6. Open the application. Send a document back with a note, approve the others, request changes.
   Then, as the builder, fix it and submit again. Then approve as the admin.

Want a populated admin list to look at? `npm run db:seed -- --yes` adds six demo builders, one
in every status. Their documents are placeholders with no real files.

## 4. Choices worth knowing about

- **Bank details** are not collected yet. Only an optional cancelled-cheque upload is accepted.
  Account numbers are needed only once online token payments start (Phase 10), and are better
  entered at the payment provider than stored here.
- **Required documents:** PAN, GST certificate, business proof, signatory identity proof and
  office address proof. RERA (builder level) and the cancelled cheque are optional.
- **Verified builders** can edit how the company is presented (about, website, logo, cover,
  contact, cities) but not its legal identity (name, PAN, GSTIN, address, documents).
- **GSTIN is checked for format and checksum**, and must contain the PAN entered. This catches
  typos. It does not prove the number is real: the reviewer compares it to the uploaded certificate.
- **Plan choice** records interest only. No payment is taken until Phase 8.
