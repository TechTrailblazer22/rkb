import Link from "next/link";
import { Heart, Search } from "lucide-react";
import { ListingCard } from "@/components/search/listing-card";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listingsByIds } from "@/lib/search/cards";
import { listShortlistIds } from "@/lib/shortlist/service";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser({ returnTo: "/account", roles: ["BUYER"] });
  const db = getDb();
  const savedIds = await listShortlistIds(db, user.id);
  // Projects that have since gone offline are skipped here but stay saved.
  const latest = await listingsByIds(db, savedIds.slice(0, 6));
  const shown = latest.slice(0, 3);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Welcome, {user.name ?? user.email}</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <Search className="size-6 text-teal-700" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">Find your plot</h2>
          <p className="mt-1 text-sm text-slate-600">
            Search verified projects by city, budget and size, and see which plots are available.
          </p>
          <Link href="/projects" className={`${buttonClass("primary")} mt-4`}>
            Browse projects
          </Link>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <Heart className="size-6 text-teal-700" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">Saved projects</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="saved-count">
            {savedIds.length === 0
              ? "You have not saved any projects yet. Tap the heart on a project to keep it here."
              : `You have saved ${savedIds.length} ${savedIds.length === 1 ? "project" : "projects"}.`}
          </p>
          <Link href="/account/shortlist" className={`${buttonClass("secondary")} mt-4`}>
            See saved projects
          </Link>
        </section>
      </div>

      {shown.length > 0 && (
        <section aria-labelledby="latest-saved">
          <h2 id="latest-saved" className="text-lg font-bold">
            Recently saved
          </h2>
          <ul className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((card) => (
              <li key={card.id}>
                <ListingCard card={card} titleAs="h3" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Your account</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Account type</dt>
            <dd className="font-medium">Buyer</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-slate-600">
          Enquiries and bookings will appear here as they are released.
        </p>
      </section>
    </div>
  );
}
