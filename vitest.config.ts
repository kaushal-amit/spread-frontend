import { defineConfig } from "vitest/config";

// 4.5 · the contract tests: every fixture under test/fixtures was captured
// from the real backend by scripts/capture-fixtures.js. No fixture is typed
// by hand.
export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: true,
  },
});
