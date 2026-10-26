import { switchTarget, type Mode } from "@/lib/auth/mode";

/**
 * The button that moves a logged-in person to their other account without logging out: "Switch to
 * builder account" in buyer mode, "Switch to buyer account" in builder mode.
 * which checks they really have that account (a plain GET form: it only changes which account is shown). Nothing for staff, who have a single mode.
 *
 * Plain HTML (no hooks) so it works in server components and client components alike.
 */
export function ModeSwitch({
  mode,
  canBuild,
  className,
}: {
  mode: Mode;
  canBuild: boolean;
  className: string;
}) {
  const target = switchTarget(mode, canBuild);
  if (!target) return null;

  return (
    <form method="get" action="/switch" className="contents">
      <input type="hidden" name="to" value={target.to} />
      <button type="submit" data-testid="mode-switch" data-to={target.to} className={className}>
        {target.label}
      </button>
    </form>
  );
}
