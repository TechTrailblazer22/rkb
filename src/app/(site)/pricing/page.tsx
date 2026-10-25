import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { buttonClass } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/container";
import { Faq, type FaqItem } from "@/components/ui/faq";
import { LIST_PROJECT_HREF } from "@/components/site/nav-links";
import { GST_PERCENT, comparison, plans, type Cell } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple monthly plans for builders and developers. No commission on your sales. Pay for 10 months, get 12 on the annual plan.",
};

const NOTES = [
  {
    title: "Annual plan",
    text: "Pay for 10 months, get 12.",
  },
  {
    title: "Founding builder offer",
    text: "An introductory discount for early builders in each city.",
  },
  {
    title: "Cancel any time",
    text: "Your listings stay live until the paid month ends.",
  },
];

const FAQ: FaqItem[] = [
  {
    question: "Do you take a commission on plots I sell?",
    answer: "No. You pay only the monthly subscription.",
  },
  {
    question: "Who owns the leads and customer data?",
    answer: "You do. Leads come to you directly with full contact details.",
  },
  {
    question: "Can you help me create my first listing?",
    answer: "Yes. Our team sets up your first project at no extra cost.",
  },
  {
    question: "Is the full plot price paid online?",
    answer:
      "No. Online payment is for the token only. The balance is paid directly to you under the sale agreement.",
  },
  {
    question: "Are the prices final?",
    answer:
      "These are proposed launch prices and may change before launch. Plans, prices and features are indicative and open for discussion.",
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto size-5 text-teal-700" aria-hidden="true" strokeWidth={3} />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus className="mx-auto size-5 text-slate-300" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span>{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      <section className="bg-navy-900 py-14 text-center text-white sm:py-16">
        <Container>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Simple monthly plans
          </h1>
          <div className="mx-auto mt-5 h-1.5 w-16 rounded-full bg-amber-500" />
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/80">
            Proposed launch pricing in INR, excluding {GST_PERCENT}% GST. No commission on sales.
          </p>
        </Container>
      </section>

      <section className="py-14">
        <Container>
          <PricingPlans />

          <ul className="mt-14 grid gap-4 rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-6 md:grid-cols-3">
            {NOTES.map((note) => (
              <li key={note.title}>
                <p className="font-bold">{note.title}</p>
                <p className="mt-1 text-sm text-slate-700">{note.text}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="bg-surface py-16">
        <Container>
          <SectionHeading title="Compare plans" />
          <div className="mt-10 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Feature comparison of Starter, Growth and Premier plans
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th scope="col" className="px-5 py-4 font-semibold">
                    Feature
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.code}
                      scope="col"
                      className={`px-5 py-4 text-center font-bold ${plan.highlighted ? "bg-amber-50" : ""}`}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.label} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="px-5 py-3.5 text-left font-medium">
                      {row.label}
                    </th>
                    {row.values.map((value, index) => (
                      <td
                        key={plans[index].code}
                        className={`px-5 py-3.5 text-center ${plans[index].highlighted ? "bg-amber-50/60" : ""}`}
                      >
                        <CellValue value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Plans, prices and features are indicative and open for discussion.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-3xl">
          <SectionHeading title="Common questions" align="center" />
          <div className="mt-10">
            <Faq items={FAQ} />
          </div>
        </Container>
      </section>

      <section className="bg-navy-900 py-14 text-center text-white">
        <Container>
          <h2 className="text-3xl font-extrabold tracking-tight">
            Ready to list your first project?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-white/80">
            Create your builder account and fill in your details at your own pace. Our team helps
            you set up your first project at no extra cost.
          </p>
          <a href={LIST_PROJECT_HREF} className={`${buttonClass("accent", "lg")} mt-8`}>
            Create your builder account
          </a>
        </Container>
      </section>
    </>
  );
}
