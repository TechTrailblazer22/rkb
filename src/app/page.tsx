import { buttonClass } from "@/components/ui/button";

// Placeholder home page. Replaced by the real marketing home in Phase 2.
// Kept free of session lookups so it stays static and fast; the links below work for
// both logged-in and logged-out visitors (Auth0 skips the form if a session exists).
export default function Home() {
  return (
    <div className="bg-navy-900 flex flex-1 flex-col text-white">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <span className="rounded-lg bg-teal-500 px-2.5 py-1 text-sm font-bold">RKB</span>
        <nav className="flex items-center gap-3">
          {/* plain <a>: Auth0 routes need a full navigation, not client-side routing */}
          <a href="/auth/login" className={buttonClass("secondary")}>
            Log in
          </a>
          <a
            href="/auth/login?screen_hint=signup&returnTo=%2Fstart-listing"
            className={buttonClass("accent")}
          >
            List your project
          </a>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <h1 className="max-w-xl text-4xl leading-tight font-bold sm:text-5xl">
          Your projects, in every buyer&apos;s pocket.
        </h1>
        <div className="mt-6 h-1.5 w-16 rounded-full bg-amber-500" />
        <p className="mt-6 max-w-md text-lg text-white/75">
          The RKB builder platform is under construction. Builders can already create an account.
        </p>
      </main>
    </div>
  );
}
