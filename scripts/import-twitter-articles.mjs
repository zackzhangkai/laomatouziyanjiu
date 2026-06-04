#!/usr/bin/env node
/**
 * 批量从 @LMDFinance 导入 X 投研文章到本地 Markdown（含图片下载）
 *
 * 用法:
 *   node scripts/import-twitter-articles.mjs
 *   node scripts/import-twitter-articles.mjs --url https://x.com/LMDFinance/status/123
 *   node scripts/import-twitter-articles.mjs --limit 10 --dry-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BLOG_DIR = path.join(ROOT, "src/content/blog");
const IMG_DIR = path.join(ROOT, "public/images/blog");
const FX_API = "https://api.fxtwitter.com";
const HANDLE = "LMDFinance";
const RESEARCH_HASHTAG = "老马行业研究";
const UA = "laomatouziyanjiu-import/1.0";

const proxyUrl = process.env.HTTPS_PROXY || process.env.ALL_PROXY;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

async function httpFetch(url, init = {}) {
  return undiciFetch(url, {
    ...init,
    headers: { "User-Agent": UA, ...init.headers },
    dispatcher: proxyAgent,
  });
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fromNav = args.includes("--from-nav");
const urlArg = args.find((a, i) => args[i - 1] === "--url");
const limit = Number(args.find((a, i) => args[i - 1] === "--limit") ?? 50);
const maxPages = Number(args.find((a, i) => args[i - 1] === "--pages") ?? 20);
const NAV_STATUS_ID = "2055284201147215992";

async function fxFetch(pathname) {
  const res = await httpFetch(`${FX_API}${pathname}`);
  if (!res.ok) throw new Error(`FxTwitter ${pathname} → ${res.status}`);
  return res.json();
}

function slugFromTitle(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (ascii && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ascii)) return ascii.slice(0, 80);
  return "";
}

function isResearch(status) {
  if (status.reposted_by) return false;
  if (status.replying_to && !status.article) return false;
  if (status.article?.title) return true;
  const text = status.text ?? "";
  return text.includes(`#${RESEARCH_HASHTAG}`) || text.includes("【#老马行业研究】");
}

function flattenTimeline(items) {
  const out = [];
  for (const item of items) {
    if (item.type === "thread") {
      const root = item.statuses.find((s) => !s.replying_to) ?? item.statuses[0];
      if (root) out.push(root);
    } else if (item.type === "status") {
      out.push(item);
    }
  }
  return out;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!dryRun) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buf);
  }
  return destPath;
}

async function saveImage(url, slug, id, index) {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  let ext = "jpg";
  if (ct.includes("png")) ext = "png";
  else if (ct.includes("webp")) ext = "webp";
  else if (ct.includes("gif")) ext = "gif";
  const safeId = String(id).replace(/\W/g, "").slice(-12) || String(index);
  const filename = `${slug}-${safeId}.${ext}`;
  const publicPath = `/images/blog/${filename}`;
  const diskPath = path.join(IMG_DIR, filename);
  if (!dryRun) {
    await fs.mkdir(IMG_DIR, { recursive: true });
    await fs.writeFile(diskPath, Buffer.from(await res.arrayBuffer()));
  }
  return publicPath;
}

function normalizeEntityMap(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const map = {};
    for (const item of raw) {
      if (item?.key != null && item?.value) map[String(item.key)] = item.value;
    }
    return map;
  }
  return raw;
}

function resolveArticleMediaUrl(entity) {
  const info = entity.media_info;
  if (!info) return null;

  const variants = info.video_info?.variants ?? info.variants ?? [];
  const mp4Variants = variants
    .filter(
      (v) =>
        v.url &&
        (v.content_type?.includes("mp4") || v.container === "mp4" || v.url.includes(".mp4"))
    )
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4Variants[0]?.url) {
    return {
      kind: "video",
      url: mp4Variants[0].url,
      thumbnailUrl: info.original_img_url ?? info.thumbnail_url,
    };
  }

  if (info.original_img_url) {
    return { kind: "image", url: info.original_img_url };
  }

  return null;
}

async function saveVideo(url, slug, id, index) {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`download video ${url} → ${res.status}`);
  const safeId = String(id).replace(/\W/g, "").slice(-12) || String(index);
  const filename = `${slug}-${safeId}.mp4`;
  const publicPath = `/images/blog/${filename}`;
  const diskPath = path.join(IMG_DIR, filename);
  if (!dryRun) {
    await fs.mkdir(IMG_DIR, { recursive: true });
    await fs.writeFile(diskPath, Buffer.from(await res.arrayBuffer()));
  }
  return publicPath;
}

async function articleToMarkdown(article, slug, sourceUrl) {
  const mediaById = new Map();
  let imageIndex = 0;
  const parts = [
    `> **来源声明**：本文由 [@${HANDLE}](${sourceUrl}) 首发于 X，本站转载仅供学习交流，不构成投资建议。`,
    "",
  ];

  const coverUrl = article.cover_media?.media_info?.original_img_url;
  if (coverUrl) {
    const p = await saveImage(coverUrl, slug, "cover", imageIndex++);
    mediaById.set("cover", p);
    parts.push(`![封面](${p})`, "");
  }

  for (const entity of article.media_entities ?? []) {
    if (!entity.media_id) continue;
    const resolved = resolveArticleMediaUrl(entity);
    if (!resolved) continue;

    if (resolved.kind === "image") {
      const p = await saveImage(resolved.url, slug, entity.media_id, imageIndex++);
      mediaById.set(entity.media_id, p);
      continue;
    }

    const videoPath = await saveVideo(resolved.url, slug, entity.media_id, imageIndex++);
    let html = `<video controls preload="metadata" src="${videoPath}"></video>`;
    if (resolved.thumbnailUrl) {
      const thumbPath = await saveImage(
        resolved.thumbnailUrl,
        slug,
        `${entity.media_id}-thumb`,
        imageIndex++
      );
      html = `<video controls preload="metadata" poster="${thumbPath}" src="${videoPath}"></video>`;
    }
    mediaById.set(entity.media_id, html);
  }

  const blocks = article.content?.blocks ?? [];
  const entityMap = normalizeEntityMap(article.content?.entityMap);

  for (const block of blocks) {
    if (block.type === "atomic") {
      for (const range of block.entityRanges ?? []) {
        const entity = entityMap[String(range.key)];
        if (entity?.type !== "MEDIA") continue;
        for (const item of entity.data?.mediaItems ?? []) {
          const p = mediaById.get(item.mediaId);
          if (!p) continue;
          if (String(p).startsWith("<video")) parts.push(p, "");
          else parts.push(`![配图](${p})`, "");
        }
      }
      continue;
    }
    const line = (block.text ?? "").trim();
    if (!line) continue;
    if (block.type === "header-one") parts.push(`# ${line}`, "");
    else if (block.type === "header-two") parts.push(`## ${line}`, "");
    else parts.push(line, "");
  }

  return parts.join("\n").trim() + "\n";
}

async function statusToMarkdown(status, slug) {
  const sourceUrl = status.url ?? `https://x.com/${HANDLE}/status/${status.id}`;
  if (status.article?.content?.blocks?.length) {
    return articleToMarkdown(status.article, slug, sourceUrl);
  }
  const parts = [
    `> **来源声明**：本文由 [@${HANDLE}](${sourceUrl}) 首发于 X，本站转载仅供学习交流，不构成投资建议。`,
    "",
  ];
  if (status.text?.trim()) parts.push(status.text.trim(), "");
  let i = 0;
  for (const photo of status.media?.photos ?? []) {
    const p = await saveImage(photo.url, slug, photo.id, i++);
    parts.push(`![配图 ${i}](${p})`, "");
  }
  for (const video of status.media?.videos ?? []) {
    const videoPath = await saveVideo(video.url, slug, video.id, i++);
    let html = `<video controls preload="metadata" src="${videoPath}"></video>`;
    if (video.thumbnail_url) {
      const thumbPath = await saveImage(video.thumbnail_url, slug, `${video.id}-thumb`, i++);
      html = `<video controls preload="metadata" poster="${thumbPath}" src="${videoPath}"></video>`;
    }
    parts.push(html, "");
  }
  return parts.join("\n").trim() + "\n";
}

async function writePost(status) {
  const full = await fxFetch(`/2/status/${status.id}`);
  status = full.tweet ?? full.status ?? status;

  const sourceUrl = status.url ?? `https://x.com/${HANDLE}/status/${status.id}`;
  const title = status.article?.title?.trim() ||
    (status.text ?? "").split("\n")[0]?.replace(/#\S+/g, "").trim() ||
    `x-${status.id}`;
  let slug = slugFromTitle(title);
  if (!slug) slug = `x-${status.id}`;

  const mdPath = path.join(BLOG_DIR, `${slug}.md`);
  try {
    await fs.access(mdPath);
    console.log(`跳过（已存在）: ${slug}`);
    return null;
  } catch {
    /* new file */
  }

  const pubDate = status.created_timestamp
    ? new Date(status.created_timestamp * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const description = (status.article?.preview_text ?? status.text ?? "").slice(0, 200);
  const body = await statusToMarkdown(status, slug);
  const tags = [...(status.text?.matchAll(/#([\p{L}\p{N}_]+)/gu) ?? [])]
    .map((m) => m[1])
    .slice(0, 8);

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `pubDate: ${JSON.stringify(pubDate)}`,
    `category: ${JSON.stringify(tags.includes(RESEARCH_HASHTAG) ? "行业研究" : "投研")}`,
    `author: "老马投资研究"`,
    `source: ${JSON.stringify(sourceUrl)}`,
  ];
  if (tags.length) {
    frontmatter.push("tags:");
    for (const t of tags) frontmatter.push(`  - ${JSON.stringify(t)}`);
  }
  frontmatter.push("---", "", body);

  const content = frontmatter.join("\n");
  if (dryRun) {
    console.log(`[dry-run] 将写入 ${slug}.md (${body.length} 字符)`);
  } else {
    await fs.mkdir(BLOG_DIR, { recursive: true });
    await fs.writeFile(mdPath, content, "utf8");
    console.log(`已导入: ${slug}.md`);
  }
  return slug;
}

async function importOne(input) {
  const id = input.match(/status\/(\d+)/)?.[1] ?? input;
  const data = await fxFetch(`/2/status/${id}`);
  const status = data.tweet ?? data.status;
  if (!status) throw new Error("推文不存在");
  if (!isResearch(status) && !status.article?.title) {
    throw new Error("不符合投研导入条件");
  }
  return writePost(status);
}

async function importTimeline() {
  const seen = new Set();
  const statuses = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      count: String(Math.min(limit, 50)),
      groupthreads: "1",
    });
    if (cursor) qs.set("cursor", cursor);

    const data = await fxFetch(`/2/profile/${HANDLE}/statuses?${qs}`);
    const batch = flattenTimeline(data.results ?? []).filter(isResearch);
    for (const s of batch) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        statuses.push(s);
      }
    }
    cursor = data.cursor?.bottom;
    if (!cursor || statuses.length >= limit) break;
  }

  console.log(`找到 ${statuses.length} 篇可导入帖子（扫描 ${maxPages} 页时间线）`);
  let count = 0;
  for (const status of statuses.slice(0, limit)) {
    const slug = await writePost(status);
    if (slug) count++;
  }
  console.log(`完成，新导入 ${count} 篇`);
}

function extractStatusIdsFromNav(status) {
  const ids = new Set();
  const text = JSON.stringify(status.article ?? {});
  for (const match of text.matchAll(/LMDFinance\/status\/(\d+)/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

async function importFromNav() {
  const data = await fxFetch(`/2/status/${NAV_STATUS_ID}`);
  const nav = data.tweet ?? data.status;
  if (!nav) throw new Error("无法读取导航长文");

  const ids = extractStatusIdsFromNav(nav);
  console.log(`从导航长文提取 ${ids.length} 个帖子链接`);

  let count = 0;
  for (const id of ids) {
    try {
      const full = await fxFetch(`/2/status/${id}`);
      const status = full.tweet ?? full.status;
      if (!status) continue;
      if (!isResearch(status) && !status.article?.title) {
        console.log(`跳过（非投研）: ${id}`);
        continue;
      }
      const slug = await writePost(status);
      if (slug) count++;
    } catch (e) {
      console.error(`失败 ${id}: ${e.message}`);
    }
  }
  console.log(`完成，新导入 ${count} 篇`);
}

if (fromNav) {
  importFromNav().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
} else if (urlArg) {
  importOne(urlArg).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
} else {
  importTimeline().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
