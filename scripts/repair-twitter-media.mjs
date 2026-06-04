#!/usr/bin/env node
/**
 * 修复已导入 X 文章的正文配图/视频：从 Twitter 重新拉取原图并更新 Markdown
 *
 * 用法:
 *   node scripts/repair-twitter-media.mjs
 *   node scripts/repair-twitter-media.mjs --slug x-2058025601722949692
 *   node scripts/repair-twitter-media.mjs --dry-run
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
const slugArg = args.find((a, i) => args[i - 1] === "--slug");

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

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return { frontmatter: "", body: content };
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: content };
  return {
    frontmatter: content.slice(0, end + 5),
    body: content.slice(end + 5).replace(/^\n/, ""),
  };
}

function extractStatusId(source, filename) {
  const fromSource = source?.match(/status\/(\d+)/)?.[1];
  if (fromSource) return fromSource;
  const fromName = filename.match(/^x-(\d+)\.md$/)?.[1];
  return fromName ?? null;
}

function countInlineImages(body) {
  return (body.match(/!\[配图\]/g) ?? []).length;
}

async function repairFile(filePath) {
  const filename = path.basename(filePath);
  const slug = filename.replace(/\.md$/, "");
  const raw = await fs.readFile(filePath, "utf8");
  const { frontmatter, body: oldBody } = parseFrontmatter(raw);

  const sourceMatch = frontmatter.match(/^source:\s*(.+)$/m);
  const source = sourceMatch?.[1]?.replace(/^"|"$/g, "").trim();
  const statusId = extractStatusId(source, filename);
  if (!statusId) {
    console.log(`跳过（无推文 ID）: ${filename}`);
    return null;
  }

  const res = await httpFetch(`${FX_API}/2/status/${statusId}`);
  if (!res.ok) throw new Error(`FxTwitter ${statusId} → ${res.status}`);
  const data = await res.json();
  const status = data.tweet ?? data.status;
  if (!status) throw new Error(`推文不存在: ${statusId}`);

  const newBody = await statusToMarkdown(status, slug);
  const oldImages = countInlineImages(oldBody);
  const newImages = countInlineImages(newBody);

  if (oldBody.trim() === newBody.trim()) {
    console.log(`无需更新: ${slug}（正文配图 ${newImages} 张）`);
    return { slug, changed: false, images: newImages };
  }

  const content = `${frontmatter}\n${newBody}`;
  if (dryRun) {
    console.log(`[dry-run] 将更新 ${slug}: 配图 ${oldImages} → ${newImages}`);
  } else {
    await fs.writeFile(filePath, content, "utf8");
    console.log(`已修复: ${slug}（配图 ${oldImages} → ${newImages}）`);
  }
  return { slug, changed: true, images: newImages };
}

async function main() {
  const files = await fs.readdir(BLOG_DIR);
  let targets = files.filter((f) => f.endsWith(".md")).map((f) => path.join(BLOG_DIR, f));

  targets = targets.filter((f) => {
    const base = path.basename(f);
    return base.startsWith("x-") || base.includes("status");
  });

  if (slugArg) {
    const wanted = slugArg.endsWith(".md") ? slugArg : `${slugArg}.md`;
    targets = targets.filter((f) => path.basename(f) === wanted);
    if (!targets.length) {
      throw new Error(`未找到文章: ${wanted}`);
    }
  }

  console.log(`准备修复 ${targets.length} 篇 X 导入文章${dryRun ? "（dry-run）" : ""}`);

  let updated = 0;
  let totalImages = 0;
  for (const filePath of targets) {
    try {
      const result = await repairFile(filePath);
      if (result?.changed) updated++;
      if (result?.images) totalImages += result.images;
    } catch (e) {
      console.error(`失败 ${path.basename(filePath)}: ${e.message}`);
    }
  }

  console.log(`完成：更新 ${updated} 篇，正文配图共 ${totalImages} 处`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
