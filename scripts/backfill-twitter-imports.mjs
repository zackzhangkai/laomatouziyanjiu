#!/usr/bin/env node
/**
 * 从已有 src/content/blog/x-*.md 生成 D1 回填 SQL
 *
 *   node scripts/backfill-twitter-imports.mjs > migrations/005_twitter_sync_backfill.sql
 *   wrangler d1 execute blog-db --remote --file=./migrations/005_twitter_sync_backfill.sql
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, "../src/content/blog");

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

async function main() {
  const files = await fs.readdir(BLOG_DIR);
  const rows = [];

  for (const file of files) {
    if (!file.startsWith("x-") || !file.endsWith(".md")) continue;
    const tweetId = file.slice(2, -3);
    if (!/^\d+$/.test(tweetId)) continue;

    const content = await fs.readFile(path.join(BLOG_DIR, file), "utf8");
    const sourceMatch = content.match(/^source:\s*(.+)$/m);
    const sourceUrl = sourceMatch
      ? sourceMatch[1].trim().replace(/^"|"$/g, "")
      : `https://x.com/LMDFinance/status/${tweetId}`;
    const slug = file.slice(0, -3);

    rows.push({ tweetId, slug, sourceUrl });
  }

  console.log("-- Auto-generated twitter_imports backfill");
  console.log(`-- ${rows.length} rows\n`);

  for (const { tweetId, slug, sourceUrl } of rows) {
    console.log(
      `INSERT OR IGNORE INTO twitter_imports (tweet_id, slug, source_url) VALUES ('${sqlEscape(tweetId)}', '${sqlEscape(slug)}', '${sqlEscape(sourceUrl)}');`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
