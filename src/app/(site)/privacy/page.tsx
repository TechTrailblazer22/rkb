import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <section>
        <h2>1. Who is responsible</h2>
        <p>
          [Company legal name], [registered address] (&quot;we&quot;) decides why and how your
          personal data is used on RKB Platform. This notice is written to align with the Digital
          Personal Data Protection Act, 2023 (DPDP Act).
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <ul>
          <li>
            <strong>Account details:</strong> name, email address and, where you provide it, mobile
            number. Sign-in is handled by our identity provider, Auth0.
          </li>
          <li>
            <strong>Builders:</strong> business and verification details such as company name, PAN,
            GSTIN, RERA and other approvals, address, and supporting documents.
          </li>
          <li>
            <strong>Enquiries:</strong> your name, contact details and message when you contact a
            builder.
          </li>
          <li>
            <strong>Technical data:</strong> basic logs needed to keep the service secure and
            working.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Why we use it</h2>
        <ul>
          <li>To create and secure your account and provide the service.</li>
          <li>To verify builders and projects, so buyers can trust the listings.</li>
          <li>To pass your enquiry to the builder you chose to contact.</li>
          <li>To send you service messages, such as verification and lead alerts.</li>
        </ul>
      </section>

      <section>
        <h2>4. Who sees your data</h2>
        <ul>
          <li>
            <strong>Builders</strong> receive the details in the enquiries sent to them. We share
            them only when you choose to enquire, and you consent to this when you accept our terms.
          </li>
          <li>
            <strong>Service providers</strong> process data for us under contract: hosting,
            database, identity and sign-in, file storage and email delivery. [List providers and
            locations before launch.]
          </li>
          <li>We do not sell your personal data.</li>
        </ul>
      </section>

      <section>
        <h2>5. Builder verification documents</h2>
        <p>
          Documents you upload for verification are stored privately. Only you and authorised RKB
          reviewers can see them. We do not store full Aadhaar numbers.
        </p>
      </section>

      <section>
        <h2>6. How long we keep it</h2>
        <p>
          We keep data while your account is active and for as long as the law or a legitimate
          business need requires afterwards. [State retention periods before launch.]
        </p>
      </section>

      <section>
        <h2>7. Your rights</h2>
        <p>
          Under the DPDP Act you can ask to access your data, correct it, have it erased, withdraw
          consent, and nominate someone to exercise your rights. To do so, or to raise a complaint,
          contact our grievance officer: [name], [email], [address]. If you are not satisfied you
          may approach the Data Protection Board of India.
        </p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          Data is encrypted in transit, access is restricted by role, and we keep backups. No system
          is perfectly secure, so please use a strong, unique password.
        </p>
      </section>
    </LegalPage>
  );
}
