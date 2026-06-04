import type { APIRoute } from "astro";
import { recordPageView, shouldTrackPageView } from "../../../lib/analytics";
import { jsonResponse } from "../../../lib/auth";
import { getEnv } from "../../../lib/env";

export const prerender = false;

/** 页面浏览上报（供静态页与客户端使用） */
export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      path?: string;
    };
    const pathname =
      body.path?.trim() ||
      new URL(context.request.url).searchParams.get("path")?.trim() ||
      "/";

    if (!shouldTrackPageView(pathname, "GET")) {
      return jsonResponse({ ok: true, skipped: true });
    }

    const env = getEnv(context);
    await recordPageView(env.DB, pathname);
    return jsonResponse({ ok: true });
  } catch (e) {
    console.error(e);
    return jsonResponse({ ok: false }, 500);
  }
};
