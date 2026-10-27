"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button";

// Shown when a page fails while it is being built or run. It never shows the error itself (that could
// leak details); the digest lets us find it in the server log.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center"
    >
      <p className="text-sm font-semibold tracking-wide text-red-700 uppercase">
        Something went wrong
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">We could not show this page</h1>
      <p className="mt-3 text-slate-600">
        It was our fault, not yours, and nothing you did has been lost. Please try again. If it
        keeps happening, tell us{error.digest ? ` and quote ${error.digest}` : ""}.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClass("primary", "lg")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary", "lg")}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
