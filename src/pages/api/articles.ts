import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../lib/auth";
import { publishArticleToGitHub } from "../../lib/github";

export const prerender = false;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function toUserFacingPublishError(error: unknown): string {
  if (!(error instanceof Error)) return "发布失败，请稍后再试";
  if (/GITHUB_TOKEN|GITHUB_OWNER|GITHUB_REPO|未配置 GitHub/i.test(error.message)) {
    return "发布功能尚未开通，请联系网站管理员";
  }
  if (/GitHub API/i.test(error.message)) {
    return "发布时遇到网络问题，请稍后再试";
  }
  return "发布失败，请稍后再试";
}

export const POST: APIRoute = async (context) => {
  try {
    const env = getEnv(context);
    requireAdmin(await getSession(context));

    const body = (await context.request.json()) as {
      slug?: string;
      title?: string;
      description?: string;
      body?: string;
      source?: string;
      category?: string;
      tags?: string[];
    };

    const slug = body.slug?.trim().toLowerCase();
    const title = body.title?.trim();
    const description = body.description?.trim() ?? "";
    const markdownBody = body.body?.trim();

    if (!slug || !SLUG_RE.test(slug)) {
      return jsonResponse(
        { error: "文章链接名仅支持英文小写字母、数字和连字符，例如 hangye-yanjiu-2024" },
        400
      );
    }
    if (!title) {
      return jsonResponse({ error: "请填写标题" }, 400);
    }
    if (!markdownBody) {
      return jsonResponse({ error: "请填写正文" }, 400);
    }

    await publishArticleToGitHub(env, {
      slug,
      title,
      description,
      body: markdownBody,
      source: body.source?.trim(),
      category: body.category?.trim(),
      tags: body.tags,
    });

    return jsonResponse({
      ok: true,
      message: "文章已发布成功，通常几分钟内即可在研报栏目看到。",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: toUserFacingPublishError(e) }, 500);
  }
};
