import { LayoutMapEditor } from "@/components/project/layout-map-editor";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { getDb } from "@/lib/db";
import { layoutImageUrl } from "@/lib/layout-map/service";
import { requireProjectContext } from "@/lib/projects/context";

export const metadata = { title: "Layout map" };

export default async function LayoutMapPage({
  params,
}: PageProps<"/portal/projects/[id]/layout-map">) {
  const { id } = await params;
  const ctx = await requireProjectContext(id, `/portal/projects/${id}/layout-map`);
  const db = getDb();

  if (!ctx.entitlements.layoutMap) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Layout map</h3>
        <p className="text-sm text-slate-600">
          Draw each plot on your layout plan so buyers can tap a plot and see its size, price and
          whether it is available.
        </p>
        <UpgradeNotice
          feature="The interactive layout map"
          plan="GROWTH"
          lapsed={!ctx.entitlements.active}
        />
      </div>
    );
  }

  const [plots, shapes, imageUrl] = await Promise.all([
    db.plot.findMany({
      where: { projectId: id },
      orderBy: { sortKey: "asc" },
      take: 1000,
      select: { id: true, number: true, status: true, sizeSqft: true },
    }),
    db.layoutShape.findMany({
      where: { projectId: id },
      select: { plotId: true, x: true, y: true, w: true, h: true },
    }),
    layoutImageUrl(db, id),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">Layout map</h3>
        <p className="mt-1 text-sm text-slate-600">
          Pick a plot, drag on the map to draw it, and repeat. Buyers see the map on your project
          page, coloured by whether each plot is available, booked or sold, and can tap a plot for
          its details.{" "}
          {imageUrl
            ? "Your layout plan is the background."
            : "Upload your layout plan as an image (JPG, PNG or WebP) in the Photos and media step to draw over it. A PDF cannot be drawn over."}
        </p>
      </div>
      {plots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Add your plots first (the Layout step). Then come back to place them on the map.
        </p>
      ) : (
        <LayoutMapEditor
          projectId={id}
          plots={plots}
          imageUrl={imageUrl}
          initial={Object.fromEntries(
            shapes.map((s) => [s.plotId, { x: s.x, y: s.y, w: s.w, h: s.h }]),
          )}
        />
      )}
    </div>
  );
}
