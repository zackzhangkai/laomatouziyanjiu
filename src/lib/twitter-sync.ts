import { publishArticleToGitHub } from "./github";
import {
  convertStatusForImport,
  ensureFullStatus,
  previewFromInput,
} from "./twitter-import";
import {
  buildImportPreview,
  fetchTimeline,
  flattenTimeline,
  isResearchContent,
  TWITTER_HANDLE,
  type FxStatus,
} from "./twitter";
import {
  finishSyncRun,
  getImportedTweetIds,
  isTweetImported,
  registerTwitterImport,
  startSyncRun,
} from "./twitter-sync-db";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_TIMELINE_COUNT = 50;
const DEFAULT_MAX_IMPORTS = 3;

export interface ImportTweetOptions {
  slug?: string;
  title?: string;
  description?: string;
  category?: string;
  existingSlugs?: Set<string>;
  skipIfImported?: boolean;
}

export interface ImportTweetResult {
  ok: true;
  slug: string;
  title: string;
  imageCount: number;
  tweetId: string;
  sourceUrl: string;
}

export interface SyncDetail {
  tweetId: string;
  slug?: string;
  title?: string;
  status: "imported" | "skipped" | "failed";
  reason?: string;
}

export interface SyncResult {
  runId: number;
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  details: SyncDetail[];
  error?: string;
}

function syncDisabled(env: Env): boolean {
  return env.TWITTER_SYNC_DISABLED === "1" || env.TWITTER_SYNC_DISABLED === "true";
}

function githubReady(env: Env): boolean {
  return Boolean(env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO);
}

export async function importTweet(
  env: Env,
  input: string,
  options: ImportTweetOptions = {}
): Promise<ImportTweetResult | { ok: false; reason: string }> {
  if (!githubReady(env)) {
    return { ok: false, reason: "未配置 GitHub 环境变量" };
  }

  const existingSlugs = options.existingSlugs ?? new Set<string>();
  const { status: rawStatus, preview } = await previewFromInput(input, existingSlugs);
  if (!preview) {
    return {
      ok: false,
      reason: "该推文不符合投研文章导入条件（需为 X 长文或含 #老马行业研究）",
    };
  }

  if (options.skipIfImported !== false) {
    if (await isTweetImported(env.DB, preview.tweetId)) {
      return { ok: false, reason: "该推文已导入" };
    }
  }

  const status = await ensureFullStatus(rawStatus);
  const slug = (options.slug?.trim().toLowerCase() || preview.slug).toLowerCase();
  const title = options.title?.trim() || preview.title;
  const description = options.description?.trim() ?? preview.description;

  if (!SLUG_RE.test(slug)) {
    return { ok: false, reason: "文章链接名格式不正确" };
  }
  if (!title) {
    return { ok: false, reason: "请填写标题" };
  }

  const { body: markdownBody, imageCount } = await convertStatusForImport(
    env,
    status,
    slug
  );

  await publishArticleToGitHub(env, {
    slug,
    title,
    description,
    body: markdownBody,
    pubDate: preview.pubDate,
    category: options.category?.trim() || preview.category,
    source: preview.sourceUrl,
    tags: preview.tags,
  });

  await registerTwitterImport(env.DB, {
    tweetId: preview.tweetId,
    slug,
    sourceUrl: preview.sourceUrl,
  });

  return {
    ok: true,
    slug,
    title,
    imageCount,
    tweetId: preview.tweetId,
    sourceUrl: preview.sourceUrl,
  };
}

function sortByNewest(statuses: FxStatus[]): FxStatus[] {
  return [...statuses].sort((a, b) => {
    const ta = a.created_timestamp ?? Date.parse(a.created_at) / 1000 ?? 0;
    const tb = b.created_timestamp ?? Date.parse(b.created_at) / 1000 ?? 0;
    return tb - ta;
  });
}

export async function runTwitterSync(
  env: Env,
  options: { timelineCount?: number; maxImports?: number } = {}
): Promise<SyncResult> {
  const runId = await startSyncRun(env.DB);
  const details: SyncDetail[] = [];
  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let fatalError: string | undefined;

  try {
    if (syncDisabled(env)) {
      fatalError = "自动同步已禁用 (TWITTER_SYNC_DISABLED)";
      return finalize();
    }
    if (!githubReady(env)) {
      fatalError = "未配置 GitHub";
      return finalize();
    }

    const timelineCount = options.timelineCount ?? DEFAULT_TIMELINE_COUNT;
    const maxImports = options.maxImports ?? DEFAULT_MAX_IMPORTS;

    const items = await fetchTimeline(TWITTER_HANDLE, timelineCount);
    const candidates = sortByNewest(
      flattenTimeline(items).filter(isResearchContent)
    );
    scanned = candidates.length;

    const importedIds = await getImportedTweetIds(
      env.DB,
      candidates.map((s) => s.id)
    );

    for (const status of candidates) {
      if (imported >= maxImports) break;

      if (importedIds.has(status.id)) {
        skipped++;
        details.push({
          tweetId: status.id,
          status: "skipped",
          reason: "已导入",
        });
        continue;
      }

      const preview = buildImportPreview(status, new Set());
      if (!preview) {
        skipped++;
        details.push({
          tweetId: status.id,
          status: "skipped",
          reason: "不符合导入条件",
        });
        continue;
      }

      try {
        const full = await ensureFullStatus(status);
        const result = await importTweet(env, full.id, {
          skipIfImported: true,
          existingSlugs: new Set(),
        });

        if (!result.ok) {
          if (result.reason === "该推文已导入") {
            skipped++;
            details.push({
              tweetId: status.id,
              status: "skipped",
              reason: result.reason,
            });
          } else {
            failed++;
            details.push({
              tweetId: status.id,
              status: "failed",
              reason: result.reason,
            });
          }
          continue;
        }

        imported++;
        importedIds.add(status.id);
        details.push({
          tweetId: status.id,
          slug: result.slug,
          title: result.title,
          status: "imported",
        });
      } catch (e) {
        failed++;
        details.push({
          tweetId: status.id,
          status: "failed",
          reason: e instanceof Error ? e.message : "导入失败",
        });
      }
    }

    return finalize();
  } catch (e) {
    fatalError = e instanceof Error ? e.message : "同步失败";
    console.error("twitter sync error", e);
    return finalize();
  }

  async function finalize(): Promise<SyncResult> {
    await finishSyncRun(env.DB, runId, {
      scanned,
      imported,
      skipped,
      failed,
      error: fatalError ?? null,
      details,
    });
    return {
      runId,
      scanned,
      imported,
      skipped,
      failed,
      details,
      error: fatalError,
    };
  }
}

export function isCronAuthorized(request: Request, env: Env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const header = request.headers.get("X-Cron-Secret") ?? "";
  return header === secret;
}
