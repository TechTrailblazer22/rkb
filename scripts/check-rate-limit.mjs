// Checks that the per-address rate limit cannot be dodged by lying in X-Forwarded-For.
//
//   node scripts/check-rate-limit.mjs https://your-site.example
//   node scripts/check-rate-limit.mjs http://localhost:3130 --simulate-proxy
//
// It sends 80 requests to /api/visit (the limit is 60 a minute per address), each with a different
// made-up address in X-Forwarded-For. The beacon is asked to count nothing, so no data is written.
//
// Against the real site, Render's proxy appends the true address after the made-up one. If the
// limiter works, it sees the same true address every time, so a 429 appears after about 60 requests.
// With --simulate-proxy (for a local server, which has no proxy in front) the script appends a fixed
// "real" address itself, the way a proxy would.
//
// Result and what to do:
//   429 appears            the limiter keys on the true address. Good.
//   429 never appears      the made-up value is being used as the address: raise TRUSTED_PROXY_HOPS
//                          by one, redeploy, run again. (docs/OPERATIONS.md)
// This cannot tell "exactly right" from "one proxy too few" (which keys on the proxy's own address
// and so limits many real people together). Check that from a second network, as the doc describes.

const [base, ...flags] = process.argv.slice(2);
if (!base) {
  console.error("Usage: node scripts/check-rate-limit.mjs <base-url> [--simulate-proxy]");
  process.exit(2);
}
const simulateProxy = flags.includes("--simulate-proxy");
const origin = new URL(base).origin;
const TOTAL = 80;

let firstRefused = null;
const statuses = new Map();
for (let i = 1; i <= TOTAL; i++) {
  const fake = `198.51.100.${(i % 250) + 1}`;
  const response = await fetch(`${origin}/api/visit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      // A browser-like agent: crawlers (and curl) are ignored before the limiter is reached.
      "User-Agent": "Mozilla/5.0 (rate-limit check)",
      "X-Forwarded-For": simulateProxy ? `${fake}, 203.0.113.77` : fake,
    },
    body: JSON.stringify({ page: "home", source: "direct", newVisit: false, newPage: false }),
  });
  statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
  if (response.status === 429 && firstRefused === null) firstRefused = i;
}

console.log("Answers:", Object.fromEntries(statuses));
if (firstRefused !== null) {
  console.log(
    `OK: the limit started refusing at request ${firstRefused}, so a changing fake address does not help.`,
  );
} else {
  console.log("PROBLEM: 80 requests with changing fake addresses were never refused.");
  console.log(
    "The limiter is keying on a value the caller controls. Raise TRUSTED_PROXY_HOPS by one.",
  );
  process.exit(1);
}
