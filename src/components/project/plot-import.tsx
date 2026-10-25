"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

type PreviewRow = { line: number; number: string; errors: string[]; summary: string | null };
type Preview = {
  okCount: number;
  errorCount: number;
  ignoredColumns: string[];
  rows: PreviewRow[];
};

/**
 * Import plots from Excel or CSV. The file is checked first and every row is reported, with
 * nothing saved. Only after the builder confirms are the good rows added, all together.
 */
export function PlotImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"checking" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const endpoint = `/api/builder/projects/${projectId}/plots/import`;

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function post(chosen: File, mode: "preview" | "confirm", skipErrors = false) {
    const body = new FormData();
    body.set("file", chosen);
    body.set("mode", mode);
    if (skipErrors) body.set("skipErrors", "1");
    const response = await fetch(endpoint, { method: "POST", body });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "The import failed. Please try again.");
    return result;
  }

  async function check(chosen: File) {
    setFile(chosen);
    setPreview(null);
    setError(null);
    setDone(null);
    setBusy("checking");
    try {
      setPreview((await post(chosen, "preview")) as unknown as Preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be checked.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!file || !preview) return;
    setBusy("importing");
    setError(null);
    try {
      const result = await post(file, "confirm", preview.errorCount > 0);
      setDone(
        `${result.created} ${result.created === 1 ? "plot" : "plots"} imported${
          Number(result.skipped) > 0 ? `; ${result.skipped} rows with problems were skipped` : ""
        }.`,
      );
      reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import failed.");
    } finally {
      setBusy(null);
    }
  }

  const problems = preview?.rows.filter((row) => row.errors.length > 0) ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Fill in the template in Excel, then upload it. You will see exactly what will happen before
        anything is saved. Plots that already exist are never overwritten.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a href="/api/plots/template" className={buttonClass("secondary")}>
          <Download className="size-4" aria-hidden="true" />
          Download template
        </a>
        <input
          ref={input}
          id="plot-import-file"
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy !== null}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void check(chosen);
          }}
        />
        <label
          htmlFor="plot-import-file"
          className={`${buttonClass("primary")} ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
        >
          <FileSpreadsheet className="size-4" aria-hidden="true" />
          {busy === "checking" ? "Checking..." : "Choose Excel or CSV file"}
        </label>
      </div>

      {done && (
        <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm font-medium text-teal-700">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {preview && (
        <div
          className="space-y-3 rounded-xl border border-slate-200 p-4"
          data-testid="import-preview"
        >
          <p className="text-sm font-semibold">
            {preview.okCount} {preview.okCount === 1 ? "row is" : "rows are"} ready
            {preview.errorCount > 0 && (
              <span className="text-red-600">
                , {preview.errorCount} {preview.errorCount === 1 ? "has" : "have"} problems
              </span>
            )}
            .
          </p>
          {preview.ignoredColumns.length > 0 && (
            <p className="text-xs text-slate-500">
              Ignored columns: {preview.ignoredColumns.join(", ")}
            </p>
          )}

          {problems.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <caption className="sr-only">Rows with problems</caption>
                <thead className="text-xs text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-3">
                      Row
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Plot
                    </th>
                    <th scope="col" className="py-2">
                      What to fix
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {problems.slice(0, 100).map((row) => (
                    <tr key={row.line}>
                      <td className="py-2 pr-3 font-medium">{row.line}</td>
                      <td className="py-2 pr-3">{row.number || "(blank)"}</td>
                      <td className="py-2 text-red-700">{row.errors.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {problems.length > 100 && (
                <p className="mt-2 text-xs text-slate-500">Showing the first 100 problems.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {preview.okCount > 0 && (
              <button
                type="button"
                onClick={confirm}
                disabled={busy !== null}
                className={buttonClass("accent")}
              >
                {busy === "importing"
                  ? "Importing..."
                  : preview.errorCount > 0
                    ? `Import the ${preview.okCount} valid rows and skip the rest`
                    : `Import ${preview.okCount} ${preview.okCount === 1 ? "plot" : "plots"}`}
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              disabled={busy !== null}
              className={buttonClass("secondary")}
            >
              Choose a different file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
