// Minimal button styles for Phase 1. Phase 2 replaces this with the full design system.
type Variant = "primary" | "secondary" | "accent";

const base =
  "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2";

const variants: Record<Variant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-500",
  secondary: "border border-navy-900/20 bg-white text-navy-900 hover:bg-navy-900/5",
  accent: "bg-amber-500 text-navy-900 hover:brightness-95",
};

export function buttonClass(variant: Variant = "primary"): string {
  return `${base} ${variants[variant]}`;
}
