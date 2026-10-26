import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Check, Search } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { loginHref, parseIntent, type LoginIntent } from "@/lib/auth/intent";

export const metadata: Metadata = {
  title: "Log in or sign up",
  description: "Log in to RKB Platform as a buyer or as a builder.",
  // A sign-in page is not something to find through a search engine.
  robots: { index: false, follow: true },
};

const DOORS: {
  intent: LoginIntent;
  title: string;
  who: string;
  icon: typeof Search;
  points: string[];
  login: string;
  signup: string;
}[] = [
  {
    intent: "buyer",
    title: "I'm a buyer",
    who: "Looking for a plot, farm house or home",
    icon: Search,
    points: [
      "Search verified projects by city, budget and size",
      "See which plots are still available, live",
      "Save projects and come back to them",
    ],
    login: "Log in as a buyer",
    signup: "Create a buyer account",
  },
  {
    intent: "builder",
    title: "I'm a builder",
    who: "Selling projects as a builder or developer",
    icon: Building2,
    points: [
      "List your projects with live plot availability",
      "Get the Verified badge after we check your company",
      "No commission on your sales",
    ],
    login: "Log in as a builder",
    signup: "Create a builder account",
  },
];

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // ?role=builder highlights that card, for links that already know which door is meant.
  const preferred = parseIntent((await searchParams).role);

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Log in or create an account
        </h1>
        <p className="mt-3 text-lg text-slate-600">
          Choose how you want to use RKB right now. Buyers and builders each get their own pages.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
        {DOORS.map((door) => (
          <section
            key={door.intent}
            aria-labelledby={`door-${door.intent}`}
            data-door={door.intent}
            className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm sm:p-8 ${
              preferred === door.intent
                ? "border-teal-500 ring-2 ring-teal-500/30"
                : "border-slate-200"
            }`}
          >
            <span className="bg-navy-900 flex size-12 items-center justify-center rounded-xl text-amber-500">
              <door.icon className="size-6" aria-hidden="true" />
            </span>
            <h2 id={`door-${door.intent}`} className="mt-4 text-2xl font-extrabold">
              {door.title}
            </h2>
            <p className="mt-1 text-slate-600">{door.who}</p>

            <ul className="mt-5 space-y-2.5 text-sm">
              {door.points.map((point) => (
                <li key={point} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>

            {/* plain <a> links: /auth/login belongs to the Auth0 SDK, not to Next's router */}
            <div className="mt-auto pt-8">
              <a
                href={loginHref(door.intent)}
                className={`${buttonClass(door.intent === "builder" ? "accent" : "primary", "lg")} w-full`}
              >
                {door.login}
              </a>
              <p className="mt-4 text-center text-sm text-slate-600">
                New here?{" "}
                <a
                  href={loginHref(door.intent, { signup: true })}
                  className="font-semibold text-teal-700 underline"
                >
                  {door.signup}
                </a>
              </p>
            </div>
          </section>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-600">
        You can use the same email for both. Once you are logged in, a button at the top of every
        page switches between your buyer account and your builder account without logging you out.
        If you are on the team that runs RKB, either option takes you to the admin console.{" "}
        <Link href="/for-builders" className="font-semibold text-teal-700 underline">
          How listing works for builders
        </Link>
      </p>
    </Container>
  );
}
