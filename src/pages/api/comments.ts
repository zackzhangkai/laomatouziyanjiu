import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireUser,
} from "../../lib/auth";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    const articleId = new URL(context.request.url).searchParams.get("article_id");

    if (!articleId) {
      return jsonResponse({ error: "无法加载评论" }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT c.id, c.article_id, c.content, c.created_at,
              u.username
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.article_id = ?
       ORDER BY c.created_at ASC`
    )
      .bind(articleId)
      .all<{
        id: number;
        article_id: string;
        content: string;
        created_at: string;
        username: string;
      }>();

    return jsonResponse({ comments: results ?? [] });
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    const user = requireUser(await getSession(context));

    const body = (await context.request.json()) as {
      article_id?: string;
      content?: string;
    };

    const article_id = body.article_id?.trim();
    const content = body.content?.trim();

    if (!article_id) {
      return jsonResponse({ error: "无法发表评论" }, 400);
    }
    if (!content || content.length < 1) {
      return jsonResponse({ error: "评论不能为空" }, 400);
    }
    if (content.length > 2000) {
      return jsonResponse({ error: "评论过长（最多 2000 字）" }, 400);
    }

    const result = await env.DB.prepare(
      `INSERT INTO comments (article_id, user_id, content) VALUES (?, ?, ?)`
    )
      .bind(article_id, user.id, content)
      .run();

    if (!result.success) {
      return jsonResponse({ error: "发表评论失败" }, 500);
    }

    const row = await env.DB.prepare(
      `SELECT c.id, c.article_id, c.content, c.created_at, u.username
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`
    )
      .bind(result.meta.last_row_id)
      .first();

    return jsonResponse({ ok: true, comment: row }, 201);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "服务器错误" }, 500);
  }
};
