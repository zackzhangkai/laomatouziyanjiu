import type { FxArticle, FxMediaPhoto, FxMediaVideo, FxStatus } from "./twitter";
import {
  RESEARCH_HASHTAG,
  TWITTER_HANDLE,
  normalizeEntityMap,
  resolveArticleMediaUrl,
} from "./twitter";

export interface ImageUploadResult {
  /** Public path e.g. /images/blog/foo.jpg */
  publicPath: string;
}

export type UploadImageFn = (
  bytes: Uint8Array,
  filename: string
) => Promise<ImageUploadResult>;

export type UploadMediaFn = (
  bytes: Uint8Array,
  filename: string,
  kind: "image" | "video"
) => Promise<ImageUploadResult>;

export async function statusToMarkdown(
  status: FxStatus,
  slug: string,
  uploadImage: UploadImageFn
): Promise<string> {
  const sourceUrl =
    status.url ?? `https://x.com/${TWITTER_HANDLE}/status/${status.id}`;

  if (status.article?.content?.blocks?.length) {
    return articleToMarkdown(status.article, slug, uploadImage, sourceUrl);
  }

  const parts: string[] = [
    `> **来源声明**：本文由 [@${TWITTER_HANDLE}](${sourceUrl}) 首发于 X，本站转载仅供学习交流，不构成投资建议。`,
    "",
  ];

  const text = (status.text ?? "").trim();
  if (text) {
    parts.push(text, "");
  }

  const photos = status.media?.photos ?? [];
  for (let i = 0; i < photos.length; i++) {
    const path = await savePhoto(photos[i], slug, i, uploadImage);
    parts.push(`![配图 ${i + 1}](${path})`, "");
  }

  const videos = status.media?.videos ?? [];
  for (let i = 0; i < videos.length; i++) {
    const html = await saveVideo(videos[i], slug, i, uploadImage);
    if (html) parts.push(html, "");
  }

  return parts.join("\n").trim() + "\n";
}

async function articleToMarkdown(
  article: FxArticle,
  slug: string,
  uploadImage: UploadImageFn,
  sourceUrl: string
): Promise<string> {
  const mediaById = new Map<string, string>();
  let imageIndex = 0;

  const coverUrl = article.cover_media?.media_info?.original_img_url;
  if (coverUrl) {
    const path = await saveRemoteImage(coverUrl, slug, "cover", imageIndex++, uploadImage);
    mediaById.set("cover", path);
  }

  for (const entity of article.media_entities ?? []) {
    if (!entity.media_id) continue;
    const resolved = resolveArticleMediaUrl(entity);
    if (!resolved) continue;

    if (resolved.kind === "image") {
      const path = await saveRemoteImage(
        resolved.url,
        slug,
        entity.media_id,
        imageIndex++,
        uploadImage
      );
      mediaById.set(entity.media_id, path);
      continue;
    }

    const videoPath = await saveRemoteVideo(
      resolved.url,
      slug,
      entity.media_id,
      imageIndex++,
      uploadImage
    );
    if (videoPath) {
      let html = `<video controls preload="metadata" src="${videoPath}"></video>`;
      if (resolved.thumbnailUrl) {
        const thumbPath = await saveRemoteImage(
          resolved.thumbnailUrl,
          slug,
          `${entity.media_id}-thumb`,
          imageIndex++,
          uploadImage
        );
        html = `<video controls preload="metadata" poster="${thumbPath}" src="${videoPath}"></video>`;
      }
      mediaById.set(entity.media_id, html);
    }
  }

  const parts: string[] = [
    `> **来源声明**：本文由 [@${TWITTER_HANDLE}](${sourceUrl}) 首发于 X，本站转载仅供学习交流，不构成投资建议。`,
    "",
  ];

  if (coverUrl && mediaById.has("cover")) {
    parts.push(`![封面](${mediaById.get("cover")})`, "");
  }

  const blocks = article.content?.blocks ?? [];
  const entityMap = normalizeEntityMap(article.content?.entityMap);

  for (const block of blocks) {
    if (block.type === "atomic") {
      const mediaPath = resolveBlockMedia(block, entityMap, mediaById);
      if (mediaPath) {
        parts.push(mediaPath, "");
      }
      continue;
    }

    const line = renderBlockLine(block, entityMap);
    if (!line.trim()) continue;

    if (block.type === "header-one") {
      parts.push(`# ${line}`, "");
    } else if (block.type === "header-two") {
      parts.push(`## ${line}`, "");
    } else {
      parts.push(line, "");
    }
  }

  return parts.join("\n").trim() + "\n";
}

function resolveBlockMedia(
  block: { entityRanges?: Array<{ key: number }> },
  entityMap: Record<string, { type?: string; data?: { mediaItems?: Array<{ mediaId: string }> } }>,
  mediaById: Map<string, string>
): string | null {
  for (const range of block.entityRanges ?? []) {
    const entity = entityMap[String(range.key)];
    if (entity?.type !== "MEDIA") continue;
    for (const item of entity.data?.mediaItems ?? []) {
      const path = mediaById.get(item.mediaId);
      if (!path) continue;
      if (path.startsWith("<video")) return path;
      return `![配图](${path})`;
    }
  }
  return null;
}

function renderBlockLine(
  block: {
    text: string;
    inlineStyleRanges?: Array<{ offset: number; length: number; style: string }>;
    entityRanges?: Array<{ offset: number; length: number; key: number }>;
    data?: { urls?: Array<{ text: string }> };
  },
  entityMap: Record<string, { type?: string; data?: { url?: string } }>
): string {
  let text = block.text ?? "";

  if (block.data?.urls?.length === 1 && text.trim() === block.data.urls[0].text) {
    return `[${text.trim()}](${block.data.urls[0].text})`;
  }

  const bold = new Set<number>();
  const italic = new Set<number>();
  for (const range of block.inlineStyleRanges ?? []) {
    for (let i = range.offset; i < range.offset + range.length; i++) {
      if (range.style === "Bold") bold.add(i);
      if (range.style === "Italic") italic.add(i);
    }
  }

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const range of block.entityRanges ?? []) {
    const entity = entityMap[String(range.key)];
    if (entity?.type === "LINK" && entity.data?.url) {
      replacements.push({
        start: range.offset,
        end: range.offset + range.length,
        value: `[${text.slice(range.offset, range.offset + range.length)}](${entity.data.url})`,
      });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    text = text.slice(0, r.start) + r.value + text.slice(r.end);
  }

  if (bold.size || italic.size) {
    return applyInlineStyles(text, bold, italic);
  }

  return text;
}

function applyInlineStyles(text: string, bold: Set<number>, italic: Set<number>): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const isBold = bold.has(i);
    const isItalic = italic.has(i);
    if (!isBold && !isItalic) {
      out += text[i];
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && bold.has(j) === isBold && italic.has(j) === isItalic) j++;
    const chunk = text.slice(i, j);
    if (isBold && isItalic) out += `***${chunk}***`;
    else if (isBold) out += `**${chunk}**`;
    else out += `*${chunk}*`;
    i = j;
  }
  return out;
}

async function savePhoto(
  photo: FxMediaPhoto,
  slug: string,
  index: number,
  uploadImage: UploadImageFn
): Promise<string> {
  return saveRemoteImage(photo.url, slug, photo.id, index, uploadImage);
}

async function saveVideo(
  video: FxMediaVideo,
  slug: string,
  index: number,
  uploadImage: UploadImageFn
): Promise<string | null> {
  const videoPath = await saveRemoteVideo(video.url, slug, video.id, index, uploadImage);
  if (!videoPath) return null;

  let posterAttr = "";
  if (video.thumbnail_url) {
    const posterPath = await saveRemoteImage(
      video.thumbnail_url,
      slug,
      `${video.id}-thumb`,
      index,
      uploadImage
    );
    posterAttr = ` poster="${posterPath}"`;
  }

  return `<video controls preload="metadata"${posterAttr} src="${videoPath}"></video>`;
}

async function saveRemoteVideo(
  url: string,
  slug: string,
  id: string,
  index: number,
  uploadImage: UploadImageFn
): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "laomatouziyanjiu-import/1.0" },
  });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const safeId = id.replace(/\W/g, "").slice(-12) || String(index);
  const filename = `${slug}-${safeId}.mp4`;
  const uploaded = await uploadImage(bytes, filename);
  return uploaded.publicPath;
}

async function saveRemoteImage(
  url: string,
  slug: string,
  id: string,
  index: number,
  uploadImage: UploadImageFn
): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "laomatouziyanjiu-import/1.0" },
  });
  if (!res.ok) throw new Error(`下载图片失败: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  let ext = "jpg";
  if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("webp")) ext = "webp";
  else if (contentType.includes("gif")) ext = "gif";

  const safeId = id.replace(/\W/g, "").slice(-12) || String(index);
  const filename = `${slug}-${safeId}.${ext}`;
  const uploaded = await uploadImage(bytes, filename);
  return uploaded.publicPath;
}

export function defaultSourceDisclaimer(sourceUrl: string): string {
  return `> **来源声明**：本文由 [@${TWITTER_HANDLE}](${sourceUrl}) 首发于 X，本站转载仅供学习交流，不构成投资建议。`;
}

export { RESEARCH_HASHTAG };
