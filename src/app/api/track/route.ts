import { z } from "zod";
import { isBot, parseBrowserEvent, parseSource, recordStat } from "@/lib/analytics/stats";
import { readJsonBody } from "@/lib/body";
import { getDb } from "@/lib/db";
import { clientAddress, createLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The page-analytics beacon. It counts; it identifies nobody. Browsers on other sites are refused
// (the Origin must be this site), crawlers are ignored, each address is limited, and the body size is
// capped, so the numbers cannot be inflated by a page on another site, and a loop on one machine is
// slowed to the per-address limit. A script that sets its own Origin header can still get through up
// to that limit, so treat the numbers as a good measure of real traffic, not as tamper-proof.
const body = z.object({
  slug: z.string().min(1).max(120),
  event: z.string().max(20),
  source: z.string().max(20).optional(),
});

const MAX_BODY_BYTES = 2048;

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

  const raw = await readJsonBody(request, MAX_BODY_BYTES);
  if (raw.status === "too-large") return new Response(null, { status: 413 });
  const parsed = body.safeParse(raw.status === "ok" ? raw.value : null);
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
