import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The database tests share one Postgres and clear its tables before each test. Run in
    // parallel they would wipe each other's rows. The whole suite takes seconds, so run files
    // one after another.
    fileParallelism: false,
  },
});
