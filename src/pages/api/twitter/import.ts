import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import { importTweet } from "../../../lib/twitter-sync";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const body = (await context.request.json()) as {
      url?: string;
      tweetId?: string;
      slug?: string;
      title?: string;
      description?: string;
      category?: string;
    };

    const input = body.url?.trim() || body.tweetId?.trim();
    if (!input) {
      return jsonResponse({ error: "请提供 X 链接或推文 ID" }, 400);
    }

    const posts = await getCollection("blog");
    const existingSlugs = new Set(posts.map((p) => p.id));

    const result = await importTweet(env, input, {
      slug: body.slug,
      title: body.title,
      description: body.description,
      category: body.category,
      existingSlugs,
      skipIfImported: false,
    });

    if (!result.ok) {
      const status = /不符合|无效|格式/.test(result.reason) ? 400 : 409;
      return jsonResponse({ error: result.reason }, status);
    }

    return jsonResponse({
      ok: true,
      slug: result.slug,
      imageCount: result.imageCount,
      message: `已导入「${result.title}」，含 ${result.imageCount} 张图片，通常几分钟内可见。`,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    if (e instanceof Error && /不符合投研|无效/.test(e.message)) {
      return jsonResponse({ error: e.message }, 400);
    }
    console.error(e);
    return jsonResponse({ error: "导入失败，请稍后再试" }, 500);
  }
};
