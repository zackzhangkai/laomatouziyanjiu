import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import { getLatestSyncRun } from "../../../lib/twitter-sync-db";
import {
  isCronAuthorized,
  runTwitterSync,
} from "../../../lib/twitter-sync";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    requireAdmin(await getSession(context));
    const env = getEnv(context);
    const latest = await getLatestSyncRun(env.DB);
    return jsonResponse({
      autoSyncEnabled:
        env.TWITTER_SYNC_DISABLED !== "1" && env.TWITTER_SYNC_DISABLED !== "true",
      latest,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "获取同步状态失败" }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    const cronOk = isCronAuthorized(context.request, env);
    if (!cronOk) {
      requireAdmin(await getSession(context));
    }

    const result = await runTwitterSync(env);
    return jsonResponse({
      ok: !result.error,
      ...result,
      message:
        result.imported > 0
          ? `已自动导入 ${result.imported} 篇新文章`
          : result.error
            ? result.error
            : "暂无新文章需要导入",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "同步失败" }, 500);
  }
};
