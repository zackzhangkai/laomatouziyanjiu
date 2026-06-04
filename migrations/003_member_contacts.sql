CREATE TABLE IF NOT EXISTS member_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  telegram_handle TEXT NOT NULL DEFAULT '',
  telegram_href TEXT NOT NULL DEFAULT '',
  twitter_handle TEXT,
  twitter_href TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO member_contacts (
  id, name, role, description, telegram_handle, telegram_href, twitter_handle, twitter_href
) VALUES (
  'lmd',
  '老马',
  '主理人',
  '投研观点、行业研究及深度交流，欢迎私信沟通。',
  '@LMDFinance',
  'https://t.me/LMDFinance',
  '@LMDFinance',
  'https://x.com/LMDFinance'
);
