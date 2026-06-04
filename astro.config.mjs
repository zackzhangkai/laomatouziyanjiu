import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
    workerEntryPoint: {
      path: "src/worker.ts",
    },
  }),
  markdown: {
    shikiConfig: {
      theme: "github-dark",
    },
  },
});
