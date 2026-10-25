import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Disclaimer" };

export default function DisclaimerPage() {
  return (
    <LegalPage title="Disclaimer">
      <section>
        <h2>A listing and booking facilitation service</h2>
        <p>
          RKB Platform is a listing and booking facilitation service. Builders are responsible for
          the accuracy of their information and approvals. This site is not legal advice.
        </p>
      </section>

      <section>
        <h2>Information comes from builders</h2>
        <p>
          Project details, prices, plot availability, photographs and approvals are provided by the
          builders. We review documents as part of verification, but we cannot guarantee that every
          detail is complete, current or error-free. Always confirm details with the builder and
          check the original approvals, for example on the relevant state RERA website, before you
          pay any money.
        </p>
      </section>

      <section>
        <h2>What &quot;Verified&quot; means</h2>
        <p>
          A Verified Builder badge means we checked the identity and business documents the builder
          submitted, on the date shown. A RERA-verified project means we confirmed the registration
          number against the builder&apos;s documents. Neither is an endorsement, a guarantee of
          title, or a promise about delivery or quality.
        </p>
      </section>

      <section>
        <h2>Sample listings</h2>
        <p>
          Some projects you see while the platform is launching are labelled &quot;Sample
          listing&quot;. They are invented examples to show how a listing looks. They are not real
          projects and cannot be booked.
        </p>
      </section>

      <section>
        <h2>Payments</h2>
        <p>
          Where online payment is available, it covers the token amount only. The balance and the
          sale follow the sale agreement and the registration process required by law. Take
          independent legal advice before you commit.
        </p>
      </section>
    </LegalPage>
  );
}
