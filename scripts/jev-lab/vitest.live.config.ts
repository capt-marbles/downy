import { defineConfig } from "vitest/config";

// Live checks only: run with the scratch proxy up, from the repo root:
//   JEV_PROXY_LIVE=1 npx vitest run -c scripts/jev-lab/vitest.live.config.ts
export default defineConfig({
  test: { include: ["scripts/jev-lab/*.test.ts"], environment: "node" },
});
