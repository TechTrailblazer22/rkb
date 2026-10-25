import { getDb } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { formatRupeesCompact } from "@/lib/format";
import { previewPlotRows } from "@/lib/plots/import";
import { readPlotFile, UnreadableFileError } from "@/lib/plots/read-file";
import { addPlots } from "@/lib/plots/service";
import { findOwnedProject } from "@/lib/projects/context";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/sniff";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

/**
 * Bulk plot import from an Excel or CSV file, in two steps that use the same code:
 *   mode=preview: read the file and report every row, saving nothing
 *   mode=confirm: read the same file again from scratch and save the good rows
 * Confirm re-reads the file instead of trusting a list of rows sent back by the browser, so
 * what is saved is always exactly what the server itself validated.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/builder/projects/[id]/plots/import">,
) {
  const auth = await getApiUser();
  if (auth.status === "unauthenticated") return json({ error: "Please log in." }, 401);
  if (auth.status !== "ok") return json({ error: "Please finish signing in first." }, 403);
  const { user } = auth;

  const { id: projectId } = await context.params;
  const owned = await findOwnedProject(user, projectId);
  if (!owned) return json({ error: "Project not found." }, 404);
  if (owned.mode === "locked")
    return json({ error: "Plots can't be changed in the project's current state." }, 409);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024)
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read. Please try again." }, 400);
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  if (!(file instanceof File) || file.size === 0)
    return json({ error: "Choose a file to import." }, 400);
  if (file.size > MAX_UPLOAD_BYTES)
    return json({ error: "That file is too large. The limit is 5 MB." }, 413);
  if (mode !== "preview" && mode !== "confirm") return json({ error: "Unknown mode." }, 400);

  let table: unknown[][];
  try {
    table = await readPlotFile(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof UnreadableFileError) return json({ error: error.message }, 415);
    throw error;
  }

  const db = getDb();
  const existing = await db.plot.findMany({ where: { projectId }, select: { number: true } });
  const preview = previewPlotRows(
    table,
    existing.map((p) => p.number),
  );
  if (preview.fatal) return json({ error: preview.fatal }, 422);

  if (mode === "preview") {
    return json({
      ok: true,
      okCount: preview.okCount,
      errorCount: preview.errorCount,
      ignoredColumns: preview.ignoredColumns,
      rows: preview.rows.map((row) => ({
        line: row.line,
        number: row.number,
        errors: row.errors,
        summary: row.value
          ? [
              `${row.value.sizeSqft.toLocaleString("en-IN")} sq ft`,
              row.value.facing?.replace("_", "-").toLowerCase(),
              row.value.price ? formatRupeesCompact(row.value.price) : null,
              row.value.status.toLowerCase(),
            ]
              .filter(Boolean)
              .join(", ")
          : null,
      })),
    });
  }

  const skipErrors = form.get("skipErrors") === "1";
  if (preview.errorCount > 0 && !skipErrors) {
    return json(
      { error: "Some rows have problems. Fix the file, or choose to import only the valid rows." },
      422,
    );
  }
  const plots = preview.rows.flatMap((row) => (row.value ? [row.value] : []));
  if (plots.length === 0) return json({ error: "There are no valid rows to import." }, 422);

  const result = await addPlots(db, { projectId, actorId: user.id, plots, via: "import" });
  if (!result.ok) return json({ error: result.message }, 409);
  return json({ ok: true, created: result.created, skipped: preview.errorCount });
}
