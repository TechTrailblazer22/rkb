// A small load test with no dependencies: many simultaneous visitors on a few public pages.
//
//   node scripts/load-test.mjs <baseUrl> [concurrency=30] [seconds=10] [path ...]
//
// Run it against a production build (npm run build && npm start), never against a live site you do
// not own. It reports requests per second, the 50th, 95th and 99th percentile response times and
// the share of failures, per page. Nothing here proves how the site behaves on Render's free tier,
// which is far smaller than a developer machine: run it there too, against a staging copy.
const [, , baseUrl, concurrencyArg, secondsArg, ...extraPaths] = process.argv;
if (!baseUrl) {
  console.error("Usage: node scripts/load-test.mjs <baseUrl> [concurrency] [seconds] [path ...]");
  process.exit(2);
}
const concurrency = Number(concurrencyArg ?? 30);
const seconds = Number(secondsArg ?? 10);
const paths = extraPaths.length > 0 ? extraPaths : ["/", "/projects", "/api/health"];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function run(path) {
  const times = [];
  let failures = 0;
  const end = Date.now() + seconds * 1000;
  async function worker() {
    while (Date.now() < end) {
      const start = performance.now();
      try {
        const response = await fetch(baseUrl + path, { redirect: "manual" });
        await response.arrayBuffer();
        if (response.status >= 500) failures++;
        times.push(performance.now() - start);
      } catch {
        failures++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  times.sort((a, b) => a - b);
  const total = times.length + failures;
  return {
    path,
    requests: total,
    perSecond: Math.round(total / seconds),
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    p99: Math.round(percentile(times, 99)),
    failedPercent: ((failures / Math.max(total, 1)) * 100).toFixed(2),
  };
}

console.log(`Load test: ${concurrency} simultaneous visitors for ${seconds}s per page, ${baseUrl}`);
for (const path of paths) {
  const r = await run(path);
  console.log(
    `${r.path.padEnd(28)} ${String(r.perSecond).padStart(5)} req/s   p50 ${String(r.p50).padStart(4)} ms   p95 ${String(r.p95).padStart(4)} ms   p99 ${String(r.p99).padStart(4)} ms   failed ${r.failedPercent}%   (${r.requests} requests)`,
  );
}
