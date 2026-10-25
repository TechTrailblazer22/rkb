import Link from "next/link";

export function Logo({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="RKB Platform home">
      <span className="rounded-lg bg-teal-500 px-2.5 py-1 text-base leading-none font-extrabold text-white">
        RKB
      </span>
      <span
        className={`text-sm font-semibold ${tone === "dark" ? "text-white/80" : "text-navy-900/80"}`}
      >
        Platform
      </span>
    </Link>
  );
}
