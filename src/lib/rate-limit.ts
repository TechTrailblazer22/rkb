// A small fixed-window rate limiter kept in memory. It protects endpoints anyone (or any logged-in
// user) can call in a loop. It lives in one server process, which is right for the single Render
// instance this site runs on; with several instances each would count separately and a shared store
// (a database table or Redis) would be needed. Rows that have expired are swept so it never grows
// without bound.

export type Limiter = {
  /** Records one use of `key`; true means the limit is now exceeded and the call should be refused. */
  hit(key: string, now?: number): boolean;
};

export function createLimiter(options: {
  max: number;
  windowMs: number;
  maxKeys?: number;
}): Limiter {
  const { max, windowMs, maxKeys = 5000 } = options;
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key, now = Date.now()) {
      if (entries.size >= maxKeys) {
        for (const [k, v] of entries) if (v.resetAt <= now) entries.delete(k);
        // Still full of live entries: start over rather than grow. A brief reset is better than a leak.
        if (entries.size >= maxKeys) entries.clear();
      }
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      entry.count++;
      return entry.count > max;
    },
  };
}

/**
 * How many proxies in front of the app add their own entry to X-Forwarded-For (TRUSTED_PROXY_HOPS,
 * default 1: the host's load balancer). A whole number of at least 1; anything else means 1.
 */
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/**
 * The caller's address, or a shared bucket when there is none.
 *
 * X-Forwarded-For is a list that every proxy *appends* to; a client can send its own value, which
 * then sits at the front. So the left-most entry is whatever the caller chose to write, and trusting
 * it lets one machine dodge every limit by changing it on each request. The entries the trusted
 * proxies wrote are at the right-hand end, so count from there: with one trusted proxy the address
 * is the last entry, with two it is the second from last, and so on.
 *
 * If the count is too small the result is a proxy's own address, so people share a bucket and are
 * limited early (annoying, but safe). If it is too large it picks a value the caller wrote, which is
 * the bypass this guards against, so raise TRUSTED_PROXY_HOPS only after checking (docs/OPERATIONS.md).
 */
export function clientAddress(headers: Headers, hops: number = trustedProxyHops()): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return "unknown";
  // Fewer entries than trusted hops means the request did not come through the whole chain; the
  // left-most entry is then the only one there is.
  return entries[Math.max(0, entries.length - hops)].slice(0, 64);
}
