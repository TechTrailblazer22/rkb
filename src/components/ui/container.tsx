import type { ReactNode } from "react";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** Section title with the amber accent bar used throughout the proposal. */
export function SectionHeading({
  title,
  subtitle,
  align = "left",
  tone = "light",
}: {
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
}) {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <h2
        className={`text-2xl font-bold tracking-tight sm:text-3xl ${tone === "dark" ? "text-white" : "text-navy-900"}`}
      >
        {title}
      </h2>
      <div className={`mt-3 h-1.5 w-12 rounded-full bg-amber-500 ${centered ? "mx-auto" : ""}`} />
      {subtitle && (
        <p className={`mt-4 text-base ${tone === "dark" ? "text-white/75" : "text-slate-600"}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
