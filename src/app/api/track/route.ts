import { z } from "zod";
import { isBot, parseBrowserEvent, parseSource, recordStat } from "@/lib/analytics/stats";
import { getDb } from "@/lib/db";
import { clientAddress, createLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The page-analytics beacon. It counts; it identifies nobody. Only our own pages may call it
// (the Origin must be this site), crawlers are ignored, and each address is limited, so the numbers
// cannot be inflated by a script on another site or by a loop on one machine.
const body = z.object({
  slug: z.string().min(1).max(120),
  event: z.string().max(20),
  source: z.string().max(20).optional(),
});

// 90 events a minute from one address is far more than a person generates.
const limiter = createLimiter({ max: 90, windowMs: 60_000 });

function fromOurOwnPages(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

const quiet = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return new Response(null, { status: 415 });
  }
  if (!fromOurOwnPages(request)) return new Response(null, { status: 403 });
  // Bots get the same quiet answer as everyone, so the endpoint reveals nothing about them.
  if (isBot(request.headers.get("user-agent"))) return quiet();

  if (limiter.hit(clientAddress(request.headers))) return new Response(null, { status: 429 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  const event = parsed.success ? parseBrowserEvent(parsed.data.event) : null;
  if (!parsed.success || !event) return new Response(null, { status: 400 });

  const db = getDb();
  const project = await db.project.findFirst({
    where: { slug: parsed.data.slug, status: "LIVE", builder: { status: "VERIFIED" } },
    select: { id: true },
  });
  // Counts only for projects the public can see; anything else is silently dropped.
  if (project) {
    await recordStat(db, { projectId: project.id, event, source: parseSource(parsed.data.source) });
  }
  return quiet();
}
