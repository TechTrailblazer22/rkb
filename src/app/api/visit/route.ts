import { z } from "zod";
import { isBot } from "@/lib/analytics/stats";
import { readJsonBody } from "@/lib/body";
import { getDb } from "@/lib/db";
import { clientAddress, createLimiter } from "@/lib/rate-limit";
import { parsePageKind, parseSource } from "@/lib/usage/site-kinds";
import { recordSiteStats } from "@/lib/usage/site-visits";

export const dynamic = "force-dynamic";

// The anonymous site-wide visit beacon. It counts; it identifies nobody and stores nothing but
// counters. Like /api/track: browsers on other sites are refused (the Origin must be this site),
// crawlers are ignored, each address is limited, and the body size is capped. The browser sends it at
// most once per kind of page per browser session.
//
// What this does NOT stop: anyone can write a script that sets the Origin header, so these counts
// are a good measure of real traffic, not tamper-proof. The per-address limit (see clientAddress)
// bounds how fast one machine can inflate them.
const body = z.object({
  page: z.string().max(20),
  source: z.string().max(20),
  newVisit: z.boolean(),
  newPage: z.boolean(),
});

const MAX_BODY_BYTES = 1024;
const limiter = createLimiter({ max: 60, windowMs: 60_000 });

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
  if (isBot(request.headers.get("user-agent"))) return quiet();
  // A browser that asks not to be tracked is respected, even though nothing personal is kept.
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return quiet();
  if (limiter.hit(clientAddress(request.headers))) return new Response(null, { status: 429 });

  const raw = await readJsonBody(request, MAX_BODY_BYTES);
  if (raw.status === "too-large") return new Response(null, { status: 413 });
  const parsed = body.safeParse(raw.status === "ok" ? raw.value : null);
  const page = parsed.success ? parsePageKind(parsed.data.page) : null;
  const source = parsed.success ? parseSource(parsed.data.source) : null;
  if (!parsed.success || !page || !source) return new Response(null, { status: 400 });

  await recordSiteStats(getDb(), {
    visit: parsed.data.newVisit,
    page: parsed.data.newPage,
    kind: page,
    source,
  });
  return quiet();
}
