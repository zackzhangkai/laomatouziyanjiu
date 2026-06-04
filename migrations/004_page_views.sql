CREATE TABLE IF NOT EXISTS page_views (
  path TEXT NOT NULL,
  view_date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path, view_date)
);

CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views (view_date);
