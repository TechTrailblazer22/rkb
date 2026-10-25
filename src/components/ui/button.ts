// Class helper for buttons and button-styled links, so server components need no wrapper.
type Variant = "primary" | "secondary" | "accent" | "onDark";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-700/90",
  secondary: "border border-navy-900/20 bg-white text-navy-900 hover:bg-navy-900/5",
  accent: "bg-amber-500 text-navy-900 hover:brightness-95",
  onDark: "border border-white/30 text-white hover:bg-white/10",
};

const sizes: Record<Size, string> = {
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}
