CREATE TABLE IF NOT EXISTS article_likes (
  article_id TEXT PRIMARY KEY,
  likes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article_like_voters (
  article_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_article_like_voters_article ON article_like_voters (article_id);
