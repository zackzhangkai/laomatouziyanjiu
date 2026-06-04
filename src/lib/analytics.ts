export function blogArticlePath(slug: string): string {
  return `/blog/${slug}`;
}

/** Normalize tracked paths so /blog/slug and /blog/slug/ map to the same article. */
export function normalizePageViewPath(pathname: string): string {
  let path = (pathname || "/").split(/[?#]/)[0];
  if (path.startsWith("/blog/")) {
    path = path.replace(/\/index\.html$/i, "");
    path = path.replace(/\/+$/, "");
  }
  return path || "/";
}

export function shouldTrackPageView(pathname: string, method: string): boolean {
  if (method !== "GET") return false;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_astro/")) return false;
  if (/\.[a-z0-9]{2,8}$/i.test(pathname)) return false;
  return true;
}

function viewDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function recordPageView(
  db: D1Database,
  pathname: string
): Promise<void> {
  const path = normalizePageViewPath(pathname);
  const viewDate = viewDateKey();
  await db
    .prepare(
      `INSERT INTO page_views (path, view_date, views)
       VALUES (?, ?, 1)
       ON CONFLICT(path, view_date) DO UPDATE SET views = views + 1`
    )
    .bind(path, viewDate)
    .run();
}

export interface AdminStats {
  users: {
    total: number;
    admins: number;
    regular: number;
    registeredLast7Days: number;
  };
  memberCodes: {
    total: number;
    redeemed: number;
    unused: number;
    active: number;
  };
  comments: { total: number };
  pageViews: {
    today: number;
    total: number;
    last7Days: Array<{ date: string; views: number }>;
    topArticles: Array<{ path: string; views: number; commentCount: number }>;
  };
}

export function articleIdFromBlogPath(path: string): string {
  return normalizePageViewPath(path).replace(/^\/blog\//, "");
}

export function resolveBlogArticleTitle(
  path: string,
  titleBySlug: Map<string, string>
): string {
  const normalized = normalizePageViewPath(path);
  const slug = articleIdFromBlogPath(normalized);
  return titleBySlug.get(slug) ?? slug;
}

export function resolveBlogArticleHref(path: string): string {
  return blogArticlePath(articleIdFromBlogPath(path));
}

export async function getCommentCountsByArticleIds(
  db: D1Database,
  articleIds: string[]
): Promise<Map<string, number>> {
  if (articleIds.length === 0) return new Map();

  const placeholders = articleIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT article_id, COUNT(*) AS count
       FROM comments
       WHERE article_id IN (${placeholders})
       GROUP BY article_id`
    )
    .bind(...articleIds)
    .all<{ article_id: string; count: number }>();

  return new Map((rows.results ?? []).map((row) => [row.article_id, row.count]));
}

export async function getViewCountsByPaths(
  db: D1Database,
  paths: string[]
): Promise<Map<string, number>> {
  if (paths.length === 0) return new Map();

  const placeholders = paths.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT path, COALESCE(SUM(views), 0) AS views
       FROM page_views
       WHERE path IN (${placeholders})
       GROUP BY path`
    )
    .bind(...paths)
    .all<{ path: string; views: number }>();

  return new Map((rows.results ?? []).map((row) => [row.path, row.views]));
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const today = viewDateKey();

  const usersRow = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
         SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS regular,
         SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS registered_last_7
       FROM users`
    )
    .first<{
      total: number;
      admins: number;
      regular: number;
      registered_last_7: number;
    }>();

  const codesRow = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN redeemed_at IS NOT NULL THEN 1 ELSE 0 END) AS redeemed,
         SUM(CASE WHEN redeemed_at IS NULL THEN 1 ELSE 0 END) AS unused,
         SUM(
           CASE
             WHEN redeemed_at IS NOT NULL
               AND access_expires_at IS NOT NULL
               AND access_expires_at > datetime('now')
             THEN 1
             ELSE 0
           END
         ) AS active
       FROM member_codes`
    )
    .first<{
      total: number;
      redeemed: number;
      unused: number;
      active: number;
    }>();

  const commentsRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM comments`)
    .first<{ total: number }>();

  const viewsToday = await db
    .prepare(
      `SELECT COALESCE(SUM(views), 0) AS views
       FROM page_views
       WHERE view_date = ?`
    )
    .bind(today)
    .first<{ views: number }>();

  const viewsTotal = await db
    .prepare(`SELECT COALESCE(SUM(views), 0) AS views FROM page_views`)
    .first<{ views: number }>();

  const last7 = await db
    .prepare(
      `SELECT view_date AS date, SUM(views) AS views
       FROM page_views
       WHERE view_date >= date('now', '-6 days')
       GROUP BY view_date
       ORDER BY view_date ASC`
    )
    .all<{ date: string; views: number }>();

  const topArticlesRows = await db
    .prepare(
      `SELECT path, SUM(views) AS views
       FROM page_views
       WHERE view_date >= date('now', '-6 days')
         AND path LIKE '/blog/%'
       GROUP BY path
       ORDER BY views DESC
       LIMIT 10`
    )
    .all<{ path: string; views: number }>();

  const topArticlePaths = topArticlesRows.results ?? [];
  const articleIds = topArticlePaths.map((row) => articleIdFromBlogPath(row.path));
  const commentCounts = await getCommentCountsByArticleIds(db, articleIds);
  const topArticles = topArticlePaths.map((row) => {
    const path = normalizePageViewPath(row.path);
    const slug = articleIdFromBlogPath(path);
    return {
      path,
      views: row.views,
      commentCount: commentCounts.get(slug) ?? 0,
    };
  });

  return {
    users: {
      total: usersRow?.total ?? 0,
      admins: usersRow?.admins ?? 0,
      regular: usersRow?.regular ?? 0,
      registeredLast7Days: usersRow?.registered_last_7 ?? 0,
    },
    memberCodes: {
      total: codesRow?.total ?? 0,
      redeemed: codesRow?.redeemed ?? 0,
      unused: codesRow?.unused ?? 0,
      active: codesRow?.active ?? 0,
    },
    comments: { total: commentsRow?.total ?? 0 },
    pageViews: {
      today: viewsToday?.views ?? 0,
      total: viewsTotal?.views ?? 0,
      last7Days: last7.results ?? [],
      topArticles,
    },
  };
}

