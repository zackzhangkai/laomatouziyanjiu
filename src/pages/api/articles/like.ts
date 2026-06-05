import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/auth";
import { getEnv } from "../../../lib/env";
import {
  createVoterKey,
  getVoterKeyFromRequest,
  likeArticle,
  likeVoterCookieHeader,
} from "../../../lib/likes";

export const prerender = false;

/** 文章点赞（同一浏览器仅计一次） */
export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      articleId?: string;
    };
    const articleId = body.articleId?.trim();
    if (!articleId) {
      return jsonResponse({ error: "缺少文章标识" }, 400);
    }

    let voterKey = getVoterKeyFromRequest(context.request);
    let setCookie: string | undefined;
    if (!voterKey) {
      voterKey = createVoterKey();
      setCookie = likeVoterCookieHeader(voterKey);
    }

    const env = getEnv(context);
    const result = await likeArticle(env.DB, articleId, voterKey);

    return jsonResponse(
      {
        ok: true,
        articleId,
        likes: result.likes,
        liked: result.liked,
        alreadyLiked: result.alreadyLiked,
      },
      200,
      setCookie ? { "Set-Cookie": setCookie } : undefined
    );
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "点赞失败，请稍后再试" }, 500);
  }
};
