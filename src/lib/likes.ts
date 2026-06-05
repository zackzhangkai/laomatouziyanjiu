export const LIKE_VOTER_COOKIE = "like_vid";
const LIKE_VOTER_MAX_AGE = 60 * 60 * 24 * 365 * 2;

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}

export function getVoterKeyFromRequest(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const key = cookies[LIKE_VOTER_COOKIE]?.trim();
  return key || null;
}

export function createVoterKey(): string {
  return crypto.randomUUID();
}

export function likeVoterCookieHeader(voterKey: string): string {
  return `${LIKE_VOTER_COOKIE}=${voterKey}; Path=/; Max-Age=${LIKE_VOTER_MAX_AGE}; SameSite=Lax; HttpOnly`;
}

export async function getLikeCountsByArticleIds(
  db: D1Database,
  articleIds: string[]
): Promise<Map<string, number>> {
  if (articleIds.length === 0) return new Map();

  const placeholders = articleIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT article_id, likes
       FROM article_likes
       WHERE article_id IN (${placeholders})`
    )
    .bind(...articleIds)
    .all<{ article_id: string; likes: number }>();

  return new Map((rows.results ?? []).map((row) => [row.article_id, row.likes]));
}

export async function getLikedArticleIds(
  db: D1Database,
  articleIds: string[],
  voterKey: string | null
): Promise<Set<string>> {
  if (!voterKey || articleIds.length === 0) return new Set();

  const placeholders = articleIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT article_id
       FROM article_like_voters
       WHERE voter_key = ?
         AND article_id IN (${placeholders})`
    )
    .bind(voterKey, ...articleIds)
    .all<{ article_id: string }>();

  return new Set((rows.results ?? []).map((row) => row.article_id));
}

export async function likeArticle(
  db: D1Database,
  articleId: string,
  voterKey: string
): Promise<{ likes: number; liked: boolean; alreadyLiked: boolean }> {
  const existing = await db
    .prepare(
      `SELECT 1 AS ok
       FROM article_like_voters
       WHERE article_id = ? AND voter_key = ?`
    )
    .bind(articleId, voterKey)
    .first<{ ok: number }>();

  if (existing) {
    const row = await db
      .prepare(`SELECT likes FROM article_likes WHERE article_id = ?`)
      .bind(articleId)
      .first<{ likes: number }>();
    return {
      likes: row?.likes ?? 0,
      liked: true,
      alreadyLiked: true,
    };
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO article_like_voters (article_id, voter_key)
         VALUES (?, ?)`
      )
      .bind(articleId, voterKey),
    db
      .prepare(
        `INSERT INTO article_likes (article_id, likes)
         VALUES (?, 1)
         ON CONFLICT(article_id) DO UPDATE SET likes = likes + 1`
      )
      .bind(articleId),
  ]);

  const row = await db
    .prepare(`SELECT likes FROM article_likes WHERE article_id = ?`)
    .bind(articleId)
    .first<{ likes: number }>();

  return {
    likes: row?.likes ?? 1,
    liked: true,
    alreadyLiked: false,
  };
}

export async function getTotalLikes(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(likes), 0) AS total FROM article_likes`)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
