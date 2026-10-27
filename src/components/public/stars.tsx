import { Star } from "lucide-react";

/** A star rating that reads correctly aloud ("4 out of 5") and never relies on colour alone. */
export function Stars({ rating, size = "size-4" }: { rating: number; size?: string }) {
  const rounded = Math.round(rating);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`${size} ${n <= rounded ? "fill-amber-500 text-amber-500" : "text-slate-300"}`}
        />
      ))}
    </span>
  );
}
