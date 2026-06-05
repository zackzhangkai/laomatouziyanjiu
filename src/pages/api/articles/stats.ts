import type { APIRoute } from "astro";
import { getArticleEngagementByIds } from "../../../lib/analytics";
import { jsonResponse } from "../../../lib/auth";
import { getEnv } from "../../../lib/env";
import {
  getLikedArticleIds,
  getVoterKeyFromRequest,
} from "../../../lib/likes";

export const prerender = false;

function parseArticleIds(url: URL, body: unknown): string[] {
  const fromQuery = url.searchParams.get("ids");
  if (fromQuery) {
    return fromQuery
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (body && typeof body === "object" && "ids" in body) {
    const ids = (body as { ids?: unknown }).ids;
    if (Array.isArray(ids)) {
      return ids.map(String).map((id) => id.trim()).filter(Boolean);
    }
  }

  return [];
}

async function buildStatsResponse(
  context: Parameters<APIRoute>[0],
  articleIds: string[]
): Promise<Response> {
  const uniqueIds = [...new Set(articleIds)].slice(0, 100);
  if (uniqueIds.length === 0) {
    return jsonResponse({ stats: {} });
  }

  const env = getEnv(context);
  const voterKey = getVoterKeyFromRequest(context.request);
  const likedIds = await getLikedArticleIds(env.DB, uniqueIds, voterKey);
  const statsMap = await getArticleEngagementByIds(env.DB, uniqueIds, likedIds);
  const stats = Object.fromEntries(statsMap);

  return jsonResponse({ stats });
}

/** 批量获取文章阅读数与点赞数（首页实时刷新用） */
export const GET: APIRoute = async (context) => {
  try {
    const articleIds = parseArticleIds(new URL(context.request.url), null);
    return await buildStatsResponse(context, articleIds);
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "无法加载文章数据" }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json().catch(() => ({}));
    const articleIds = parseArticleIds(new URL(context.request.url), body);
    return await buildStatsResponse(context, articleIds);
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "无法加载文章数据" }, 500);
  }
};
