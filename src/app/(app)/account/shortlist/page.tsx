import Link from "next/link";
import { Heart } from "lucide-react";
import { ShortlistProvider } from "@/components/public/shortlist";
import { ListingCard } from "@/components/search/listing-card";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listingsByIds } from "@/lib/search/cards";
import { listShortlistIds } from "@/lib/shortlist/service";

export const metadata = { title: "Saved projects", robots: { index: false } };

export default async function ShortlistPage() {
  const user = await requireUser({ returnTo: "/account/shortlist" });
  const db = getDb();
  // Projects that have since gone offline are left out here but stay saved, so they come back
  // if the builder puts them live again.
  const cards = await listingsByIds(db, await listShortlistIds(db, user.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Saved projects</h1>
        <p className="mt-1 text-sm text-slate-600">
          Projects you have saved with the heart button, newest first.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Heart className="mx-auto size-10 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">Nothing saved yet</h2>
          <p className="mt-1 text-sm text-slate-600">Tap the heart on a project to keep it here.</p>
          <Link href="/projects" className={`${buttonClass("primary")} mt-5`}>
            Browse projects
          </Link>
        </div>
      ) : (
        <ShortlistProvider>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="shortlist-list">
            {cards.map((card) => (
              <li key={card.id}>
                <ListingCard card={card} titleAs="h2" />
              </li>
            ))}
          </ul>
        </ShortlistProvider>
      )}
    </div>
  );
}
