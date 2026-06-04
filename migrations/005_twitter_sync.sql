CREATE TABLE IF NOT EXISTS twitter_imports (
  tweet_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_twitter_imports_slug ON twitter_imports (slug);

CREATE TABLE IF NOT EXISTS twitter_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  scanned INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details TEXT
);
