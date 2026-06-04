export interface TwitterImportRow {
  tweet_id: string;
  slug: string;
  source_url: string;
  imported_at: string;
}

export interface TwitterSyncRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  error: string | null;
  details: string | null;
}

export async function isTweetImported(
  db: D1Database,
  tweetId: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM twitter_imports WHERE tweet_id = ? LIMIT 1`)
    .bind(tweetId)
    .first();
  return row != null;
}

export async function getImportedTweetIds(
  db: D1Database,
  tweetIds: string[]
): Promise<Set<string>> {
  if (!tweetIds.length) return new Set();
  const placeholders = tweetIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT tweet_id FROM twitter_imports WHERE tweet_id IN (${placeholders})`
    )
    .bind(...tweetIds)
    .all<{ tweet_id: string }>();
  return new Set((results ?? []).map((r) => r.tweet_id));
}

export async function registerTwitterImport(
  db: D1Database,
  row: { tweetId: string; slug: string; sourceUrl: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO twitter_imports (tweet_id, slug, source_url)
       VALUES (?, ?, ?)
       ON CONFLICT(tweet_id) DO UPDATE SET
         slug = excluded.slug,
         source_url = excluded.source_url`
    )
    .bind(row.tweetId, row.slug, row.sourceUrl)
    .run();
}

export async function startSyncRun(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO twitter_sync_runs (started_at) VALUES (datetime('now'))`
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function finishSyncRun(
  db: D1Database,
  runId: number,
  summary: {
    scanned: number;
    imported: number;
    skipped: number;
    failed: number;
    error?: string | null;
    details?: unknown;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE twitter_sync_runs SET
         finished_at = datetime('now'),
         scanned = ?,
         imported = ?,
         skipped = ?,
         failed = ?,
         error = ?,
         details = ?
       WHERE id = ?`
    )
    .bind(
      summary.scanned,
      summary.imported,
      summary.skipped,
      summary.failed,
      summary.error ?? null,
      summary.details ? JSON.stringify(summary.details) : null,
      runId
    )
    .run();
}

export async function getLatestSyncRun(
  db: D1Database
): Promise<TwitterSyncRunRow | null> {
  const row = await db
    .prepare(
      `SELECT id, started_at, finished_at, scanned, imported, skipped, failed, error, details
       FROM twitter_sync_runs
       ORDER BY id DESC
       LIMIT 1`
    )
    .first<TwitterSyncRunRow>();
  return row ?? null;
}
