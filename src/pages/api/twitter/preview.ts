import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getEnv } from "../../../lib/env";
import {
  AuthError,
  getSession,
  jsonResponse,
  requireAdmin,
} from "../../../lib/auth";
import { isTweetImported } from "../../../lib/twitter-sync-db";
import {
  buildImportPreview,
  fetchTimeline,
  flattenTimeline,
  isResearchContent,
  resolveStatus,
  TWITTER_HANDLE,
} from "../../../lib/twitter";

export const prerender = false;

async function existingSlugs(): Promise<Set<string>> {
  const posts = await getCollection("blog");
  return new Set(posts.map((p) => p.id));
}

async function enrichPreview(
  db: D1Database,
  preview: NonNullable<ReturnType<typeof buildImportPreview>>,
  slugs: Set<string>
) {
  const inDb = await isTweetImported(db, preview.tweetId);
  return {
    ...preview,
    alreadyImported: inDb || preview.alreadyImported || slugs.has(preview.slug),
  };
}

export const GET: APIRoute = async (context) => {
  try {
    requireAdmin(await getSession(context));
    const env = getEnv(context);
    const url = new URL(context.request.url);
    const input = url.searchParams.get("url")?.trim();
    const slugs = await existingSlugs();

    if (input) {
      const status = await resolveStatus(input);
      const preview = buildImportPreview(status, slugs);
      if (!preview) {
        return jsonResponse({ error: "该推文不符合投研文章导入条件" }, 400);
      }
      return jsonResponse({ preview: await enrichPreview(env.DB, preview, slugs) });
    }

    const count = Math.min(Number(url.searchParams.get("count") ?? 40), 80);
    const items = await fetchTimeline(TWITTER_HANDLE, count);
    const statuses = flattenTimeline(items);
    const rawPreviews = statuses
      .filter(isResearchContent)
      .map((s) => buildImportPreview(s, slugs))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const previews = await Promise.all(
      rawPreviews.map((p) => enrichPreview(env.DB, p, slugs))
    );

    return jsonResponse({
      previews,
      handle: TWITTER_HANDLE,
      autoSyncEnabled:
        env.TWITTER_SYNC_DISABLED !== "1" && env.TWITTER_SYNC_DISABLED !== "true",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status);
    }
    console.error(e);
    return jsonResponse({ error: "获取 X 预览失败，请稍后再试" }, 500);
  }
};
