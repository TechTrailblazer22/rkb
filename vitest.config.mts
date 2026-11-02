import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The database tests share one Postgres and clear its tables before each test. Run in
    // parallel they would wipe each other's rows. The whole suite takes seconds, so run files
    // one after another.
    fileParallelism: false,
    // The default 5 s is too tight for the database tests when the machine is busy (a lint or a
    // build running alongside made five of them time out without anything being wrong).
    testTimeout: 20_000,
  },
});
