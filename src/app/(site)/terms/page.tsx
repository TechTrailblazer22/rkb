import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <section>
        <h2>1. Who we are</h2>
        <p>
          RKB Platform (&quot;we&quot;, &quot;us&quot;) is operated by [Company legal name],
          [registered address]. We run an online marketplace where builders and developers list
          real-estate projects and buyers discover them and contact builders.
        </p>
      </section>

      <section>
        <h2>2. What we do, and what we do not</h2>
        <p>
          We provide listing, enquiry and booking facilitation tools. We are not the seller,
          developer or agent of any project, and we are not a party to any sale between a buyer and
          a builder. Any sale is governed by the agreement between those two parties and by
          applicable law.
        </p>
      </section>

      <section>
        <h2>3. Accounts</h2>
        <ul>
          <li>You must give accurate information and keep your login secure.</li>
          <li>You need a verified email address to use your account.</li>
          <li>We may suspend an account that breaks these terms or the law.</li>
        </ul>
      </section>

      <section>
        <h2>4. Builders</h2>
        <ul>
          <li>
            You are responsible for the accuracy of your project information, prices, plot status
            and approvals, and for keeping them up to date.
          </li>
          <li>
            You must hold the approvals you display (for example RERA, TNCP, municipal) and tell us
            promptly if one expires or is withdrawn. We may pause a listing whose approval has
            expired.
          </li>
          <li>
            Our &quot;Verified Builder&quot; badge means we checked the documents you submitted on
            the date shown. It is not a guarantee of quality, delivery or legal title.
          </li>
          <li>
            Subscription fees, billing and cancellation follow the plan you choose. We take no
            commission on your sales. Leads and customer details you receive through the platform
            belong to you, and you must handle them in line with the Digital Personal Data
            Protection Act, 2023.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Buyers</h2>
        <ul>
          <li>
            Information on a project page comes from the builder. Check approvals, title and terms
            yourself, and with professional advice, before paying any money.
          </li>
          <li>
            When you send an enquiry, your name and contact details are shared with the builder you
            contact, so they can respond.
          </li>
          <li>
            Where online token payment is offered, it covers the token amount only. The balance and
            the sale itself follow the sale agreement and the registration process required by law.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>
          Do not post false or misleading content, impersonate anyone, scrape or overload the
          service, or use it for anything unlawful.
        </p>
      </section>

      <section>
        <h2>7. Liability</h2>
        <p>
          [To be completed with legal counsel: limitation of liability, indemnity, governing law,
          jurisdiction and dispute resolution.]
        </p>
      </section>

      <section>
        <h2>8. Changes and contact</h2>
        <p>
          We may update these terms. When we make a material change we will ask you to accept the
          new version. Questions: [contact email].
        </p>
      </section>
    </LegalPage>
  );
}
