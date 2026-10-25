import { plotTemplateCsv } from "@/lib/plots/import";

// The same sample file for everyone, so it needs no login. Opens directly in Excel.
export function GET() {
  return new Response(plotTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plots-template.csv"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
