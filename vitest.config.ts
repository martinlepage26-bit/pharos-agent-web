import { defineConfig } from "vitest/config";
import path from "node:path";

const REPO = __dirname;
const TEST_DATABASE_URL = `postgresql://pharos_ai@localhost:5433/pharos_agent_test?host=${path.join(REPO, "pgsock")}`;

export default defineConfig({
  resolve: {
    alias: { "@": path.join(REPO, "src") },
  },
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    // The policy engine and the write path are stateful and share one
    // database, so they must not interleave.
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Keep the suite offline: no key means synthesize() returns before
      // any network call, so no test can reach OpenRouter.
      OPENROUTER_API_KEY: "",
      PHAROS_OPENROUTER_KEY_FILE: "/nonexistent/no.key",
    },
  },
});
