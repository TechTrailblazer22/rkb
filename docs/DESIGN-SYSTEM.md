# Design system

How the site looks and why. The rules here are the ones the code already follows; where the code
and this document disagree, fix one of them.

## Direction

RKB is a property marketplace for an Indian audience that is cautious with money: buyers deciding on
a plot or a flat, and builders who want to look credible. The design therefore leans on **trust and
clarity** rather than decoration.

- **Deep navy** for structure (header, footer, headings) reads as established and serious. It is the
  colour of banks and listed developers, not of start-ups.
- **Teal** is the "go / available / verified" colour: the primary button, the Verified badge, the
  available plots. It is never used for body text on white (contrast; use `teal-700`/`teal-800`).
- **Amber** is the single warm accent: the builder call to action and "booked". It is used sparingly
  so it still draws the eye.
- **Slate blue** (`slate-plot`) means "sold": quiet, because a sold plot is not an opportunity.
- White cards on a very light grey-blue (`surface`) keep long lists calm and scannable.
- Prices are always the largest, boldest text on a card, in the Indian format (lakh and crore).
- Nothing on a public page may look like data it is not. A project without photos says "Photos
  coming soon" and draws nothing that resembles a plot map; availability is drawn only from the
  real plot counts.

## Tokens (`src/app/globals.css`)

| Token | Value | Use |
| --- | --- | --- |
| `navy-900` / `800` / `700` | `#0b2545` / `#0f3157` / `#13315c` | header, footer, headings, dark cards |
| `teal-500` | `#13a89e` | fills and shapes only (3:1 on white) |
| `teal-700` / `800` | `#0b7d75` / `#096660` | text and buttons on white (5:1 and 7:1) |
| `teal-50` | `#e5f6f4` | badge and highlight backgrounds |
| `amber-500` / `700` / `50` | `#f5a300` / `#8a5a00` / `#fff4dc` | accent button, "booked", warnings |
| `slate-plot` | `#3a5778` | "sold" |
| `surface` | `#f3f6fa` | page sections, tiles, empty bars |
| Font | Inter (`--font-sans`) | everything |

Plot status colours live in one place, `plotStatusStyle` in `components/ui/plot-status.tsx`:
available = teal, booked = amber, sold = slate. Chips, the plot table, the availability bar and the
legend all read from it, so they cannot drift apart.

Spacing is Tailwind's 4 px scale. Cards use `rounded-2xl` with a 1 px `slate-200` border; controls
use `rounded-lg`; pills use `rounded-full`. Pages sit in `Container` (max width, 16 px gutter on a
phone).

## Components (`src/components/ui`)

| Component | What it is for |
| --- | --- |
| `buttonClass(variant, size)` | The only definition of buttons: `primary` (teal), `accent` (amber), `secondary` (outlined), `onDark`. Min touch height 40 px. |
| `Badge`, `VerifiedBadge` | Small labels: type, stage, "Approvals verified". Teal text is `teal-800` (4.5:1 on `teal-50`). |
| `AvailabilityBar` | Available / booked / sold as one bar, optionally with a legend. Used on listing cards, the project page and the builder dashboard. Draws nothing for a project with no plots. |
| `MediaPlaceholder` | The honest "no photos yet" picture for a project, by type. |
| `PlotStatusChip`, `PlotLegend` | Status dots and labels. |
| `Field`, `inputClass` | A label, hint, control and error wired together for screen readers; required fields get a red star. |
| `Container`, `SectionHeading` | Page width and section titles. |
| `ProgressRing`, `Faq`, `Logo`, `PlotGridArt` | Specific uses. `PlotGridArt` is decorative only (the home page's "Example layout"). |

Composite components built from these: `ListingCard` (the project card), `FiltersForm` (collapsible
filter groups), `ProjectView` (shared by the buyer's page, the builder's preview and the admin's
review), `PlotTable` (status chips, search, show more), `BuilderDashboardView`.

## Rules the code follows

**Layout and responsiveness**

- Mobile first. Cards are one column on a phone, two on a tablet, three on a desktop. Filters fold
  into a button on a phone and a sticky sidebar from `lg`.
- Nothing may scroll the page sideways. Wide tables scroll inside their own box. The sort links
  scroll along one line on a phone instead of wrapping into several rows.
- A project card has a fixed structure (image, type, name, place, price, availability, approvals,
  builder) so a row of cards lines up. Names clamp to two lines.

**Accessibility (aimed at WCAG 2.2 AA)**

- Every control is a real `button`, `a`, `input` or `select` with a visible label or `aria-label`.
- Focus is always visible (an amber ring on controls and cards). The whole card is one link, so a
  screen reader announces the project name once.
- Text on white uses `teal-700` or darker; small text on tinted backgrounds uses `teal-800`;
  secondary text is `slate-600` or darker.
- Status is never colour alone: chips and bars always carry words ("Available", "20 booked").
- Filter groups are `details` with a real `fieldset` and `legend` inside.
- `prefers-reduced-motion` turns off the one animation (the hero's flipping plots).

**States**

- Empty: a sentence and a next step ("Add your first project", "No projects match: Clear all
  filters"). Never a blank box.
- Loading: pages render on the server, so there is no spinner on content. Forms show "Submitting..."
  and disable their button. (A route-level loading skeleton on the search page was tried and removed:
  it made missing cities answer 200 instead of 404 and pushed the page title out of the `<head>`.)
- Errors: stated next to the field, with what to do. Consequential actions (archive, take offline)
  ask for confirmation.

**Honesty**

- Public numbers come from the database at the moment of the request (or from a cache that is
  refreshed when the data changes). The only invented content on the site is the labelled sample
  cards shown before any real project exists, and the "Example layout" picture on the home page.

## Per-audience separation

A logged-in buyer sees no builder elements and a logged-in builder sees no buyer elements (see
`docs/LOGIN-ROLES.md`). In markup this is `data-for="builder"` or `data-for="buyer"` on the element.

## Checked

Lighthouse (mobile settings, production build) accessibility, SEO and best-practices scores are
recorded in `docs/PHASES.md`; repeat them after changing a page's structure.
