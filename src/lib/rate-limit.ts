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

/** The caller's address as the proxy reports it, or a shared bucket when there is none. */
export function clientAddress(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
