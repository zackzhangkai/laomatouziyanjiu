import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import { runTwitterSync } from "./lib/twitter-sync";

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);

  return {
    default: {
      async fetch(
        request: Request,
        env: Env,
        context: ExecutionContext
      ): Promise<Response> {
        return handle(manifest, app, request, env, context);
      },

      async scheduled(
        _controller: ScheduledController,
        env: Env,
        context: ExecutionContext
      ): Promise<void> {
        if (env.TWITTER_SYNC_DISABLED === "1" || env.TWITTER_SYNC_DISABLED === "true") {
          return;
        }
        context.waitUntil(
          runTwitterSync(env).catch((err) => {
            console.error("scheduled twitter sync failed", err);
          })
        );
      },
    },
  };
}
